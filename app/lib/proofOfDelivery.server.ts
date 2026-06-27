import prisma from "../db.server";
import { sendDeliveryCompleteNotifications } from "./deliveryCompleteNotifications.server";
import { markShopifyOrderDelivered } from "./shopifyFulfilment.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

function isValidProofPhotoUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isValidPodImage(value: string) {
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length > 500;
}

function normaliseProofPhotoUrls(value: string | string[]) {
  const urls = Array.isArray(value) ? value : [value];

  return urls.map((url) => url.trim()).filter(Boolean);
}

export async function listStopsForProofOfDelivery() {
  return prisma.stop.findMany({
    where: {
      status: {
        notIn: ["DELIVERED", "FAILED"],
      },
      route: {
        status: {
          in: ["PUBLISHED", "NOTIFICATIONS_SENT", "OUT_FOR_DELIVERY"],
        },
      },
    },
    orderBy: [
      { route: { date: "desc" } },
      { orderIndex: "asc" },
    ],
    include: {
      route: {
        include: {
          driver: true,
        },
      },
      deliveryGroup: {
        include: {
          orders: true,
          proofPhotos: true,
        },
      },
    },
  });
}

export async function saveProofOfDelivery(input: {
  admin: ShopifyAdmin;
  stopId: string;
  proofPhotoUrl: string | string[];
  deliveryNote?: string | null;
  safePlaceNote?: string | null;
  leftInSafePlace?: boolean;
  podImage?: string | null;
  podName?: string | null;
  podTicked?: boolean;
}) {
  const proofPhotoUrls = normaliseProofPhotoUrls(input.proofPhotoUrl);
  const primaryProofPhotoUrl = proofPhotoUrls[0];
  const podImage = input.podImage?.trim() || "";
  const podName = input.podName?.trim() || "";

  const stop = await prisma.stop.findUnique({
    where: {
      id: input.stopId,
    },
    include: {
      route: {
        include: {
          stops: true,
        },
      },
      deliveryGroup: {
        include: {
          orders: true,
        },
      },
    },
  });

  if (!stop || !stop.deliveryGroupId || !stop.deliveryGroup) {
    throw new Error("Stop not found.");
  }

  if (stop.status === "DELIVERED") {
    throw new Error("This stop has already been marked delivered.");
  }

  if (stop.status === "FAILED") {
    throw new Error("This stop has already been marked failed.");
  }

  if (!proofPhotoUrls.length || !primaryProofPhotoUrl) {
    throw new Error("Proof photo link is required before marking delivered.");
  }

  for (const proofPhotoUrl of proofPhotoUrls) {
    if (!isValidProofPhotoUrl(proofPhotoUrl)) {
      throw new Error("Every proof photo link must be a valid web address.");
    }
  }

  if (!podName || !isValidPodImage(podImage) || !input.podTicked) {
    throw new Error("Complete the POD fields before marking delivered.");
  }

  const shopifyResults = [];

  for (const order of stop.deliveryGroup.orders) {
    const result = await markShopifyOrderDelivered(input.admin, order.shopifyOrderId);
    shopifyResults.push(`${order.shopifyOrderNumber}: ${result.fulfilled ? "fulfilled" : result.reason || "tagged"}`);
  }

  const notificationResult = await sendDeliveryCompleteNotifications({
    routeName: stop.route.name,
    proofPhotoUrl: primaryProofPhotoUrl,
    orders: stop.deliveryGroup.orders,
  });
  const notificationErrorDetails = notificationResult.errors.length
    ? `. Notification errors: ${notificationResult.errors.join(" | ")}`
    : "";

  await prisma.$transaction(async (tx) => {
    await tx.deliveryGroup.update({
      where: {
        id: stop.deliveryGroupId!,
      },
      data: {
        proofPhotoUrl: primaryProofPhotoUrl,
        proofPhotos: {
          create: proofPhotoUrls.map((url, index) => ({
            url,
            label: index === 0 ? "Primary proof photo" : `Proof photo ${index + 1}`,
          })),
        },
        deliveryNote: input.deliveryNote?.trim() || null,
        safePlaceNote: input.leftInSafePlace ? input.safePlaceNote?.trim() || "Left in safe place" : input.safePlaceNote?.trim() || null,
      },
    });

    await tx.stop.update({
      where: {
        id: input.stopId,
      },
      data: {
        status: "DELIVERED",
        actualArrival: new Date(),
      },
    });

    const otherStops = stop.route.stops.filter((routeStop) => routeStop.id !== input.stopId);
    const allStopsDelivered = otherStops.every((routeStop) => routeStop.status === "DELIVERED");

    await tx.route.update({
      where: {
        id: stop.routeId,
      },
      data: {
        status: allStopsDelivered ? "COMPLETED" : stop.route.status,
        history: {
          create: {
            action: "Stop delivered",
            details: `Stop ${stop.orderIndex} marked delivered with ${proofPhotoUrls.length} proof photo${proofPhotoUrls.length === 1 ? "" : "s"}. Shopify: ${shopifyResults.join(", ")}. Delivery complete notifications: ${notificationResult.smsSent} SMS sent, ${notificationResult.emailsSent} emails sent, ${notificationResult.skipped} skipped, ${notificationResult.failed} failed${notificationErrorDetails}`,
          },
        },
      },
    });
  });
}
