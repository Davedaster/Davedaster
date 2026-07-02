import prisma from "../db.server";
import { sendDeliveryCompleteNotifications } from "./deliveryCompleteNotifications.server";
import { recordEtaLearningObservation } from "./etaLearning.server";
import { getFulfilmentSettings } from "./fulfilmentSettings.server";
import { createSignedProofPhotoUrl, isPrivateProofPhotoKey, uploadProofImageDataUrl } from "./proofPhotoStorage.server";
import { sendNextPendingStopNotification } from "./routeNotifications.server";
import { markShopifyOrderDelivered } from "./shopifyFulfilment.server";
import { recalculateTrafficEtaAfterStop } from "./trafficEta.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

function isValidProofPhotoUrl(value: string) {
  if (isPrivateProofPhotoKey(value)) {
    return true;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidPodImage(value: string) {
  return value.startsWith("data:image/") && value.includes(";base64,") && value.length > 500;
}

function normaliseProofPhotoUrls(value: string | string[]) {
  const urls = Array.isArray(value) ? value : [value];

  return urls.map((url) => url.trim()).filter(Boolean);
}

function formatPodLocationNote(latitude?: number | null, longitude?: number | null) {
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    return null;
  }

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return `POD location: ${latitude},${longitude}`;
}

function orderReference(orders: { shopifyOrderNumber: string }[]) {
  return orders.map((order) => order.shopifyOrderNumber).filter(Boolean).join("-") || "order";
}

function customerReference(orders: { customerName?: string | null }[], podName: string) {
  return podName || orders.map((order) => order.customerName).filter(Boolean)[0] || "customer";
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
  admin?: ShopifyAdmin | null;
  stopId: string;
  proofPhotoUrl: string | string[];
  deliveryNote?: string | null;
  safePlaceNote?: string | null;
  leftInSafePlace?: boolean;
  podImage?: string | null;
  podName?: string | null;
  podTicked?: boolean;
  podLat?: number | null;
  podLng?: number | null;
}) {
  const proofPhotoUrls = normaliseProofPhotoUrls(input.proofPhotoUrl);
  const primaryProofPhotoUrl = proofPhotoUrls[0];
  const podImage = input.podImage?.trim() || "";
  const podName = input.podName?.trim() || "";
  const podLocationNote = formatPodLocationNote(input.podLat, input.podLng);
  const leftInSafePlace = Boolean(input.leftInSafePlace);
  const noteParts = [input.deliveryNote?.trim(), podName ? `Receiver: ${podName}` : null, podLocationNote]
    .filter(Boolean)
    .join("\n");

  const [stop, fulfilmentSettings] = await Promise.all([
    prisma.stop.findUnique({
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
    }),
    getFulfilmentSettings(),
  ]);

  if (!stop || !stop.deliveryGroupId || !stop.deliveryGroup) {
    throw new Error("Stop not found.");
  }

  if (stop.status === "DELIVERED") {
    return;
  }

  if (stop.status === "FAILED") {
    throw new Error("This stop has already been marked failed.");
  }

  if (!proofPhotoUrls.length || !primaryProofPhotoUrl) {
    throw new Error("Proof photo is required before marking delivered.");
  }

  if (leftInSafePlace && proofPhotoUrls.length < 2) {
    throw new Error("Safe place deliveries need 2 proof photos before marking delivered.");
  }

  if (proofPhotoUrls.length > 3) {
    throw new Error("A maximum of 3 proof photos can be uploaded for one delivery.");
  }

  for (const proofPhotoUrl of proofPhotoUrls) {
    if (!isValidProofPhotoUrl(proofPhotoUrl)) {
      throw new Error("Every proof photo must be a valid uploaded image or secure web address.");
    }
  }

  if (!leftInSafePlace && (!podName || !isValidPodImage(podImage) || !input.podTicked)) {
    throw new Error("Customer received deliveries need a customer name, signature and confirmation before marking delivered.");
  }

  if (leftInSafePlace && !input.safePlaceNote?.trim()) {
    throw new Error("Add a safe place note before marking delivered.");
  }

  const signaturePhotoUrl = !leftInSafePlace && isValidPodImage(podImage)
    ? await uploadProofImageDataUrl(podImage, {
      stopId: input.stopId,
      orderNumber: orderReference(stop.deliveryGroup.orders),
      customerName: customerReference(stop.deliveryGroup.orders, podName),
      kind: "signature",
    })
    : null;
  const actualArrival = new Date();
  const shopifyResults: string[] = [];

  await prisma.$transaction(async (tx) => {
    await tx.deliveryGroup.update({
      where: {
        id: stop.deliveryGroupId!,
      },
      data: {
        proofPhotoUrl: primaryProofPhotoUrl,
        proofPhotos: {
          create: [
            ...proofPhotoUrls.map((url, index) => ({
              url,
              label: index === 0 ? "Primary proof photo" : `Proof photo ${index + 1}`,
            })),
            ...(!leftInSafePlace && signaturePhotoUrl ? [{
              url: signaturePhotoUrl,
              label: `Customer signature ${podName}`,
            }] : []),
          ],
        },
        deliveryNote: noteParts || null,
        safePlaceNote: leftInSafePlace ? input.safePlaceNote?.trim() || "Left in safe place" : input.safePlaceNote?.trim() || null,
      },
    });

    await tx.stop.update({
      where: {
        id: input.stopId,
      },
      data: {
        status: "DELIVERED",
        actualArrival,
      },
    });

    const otherStops = stop.route.stops.filter((routeStop) => routeStop.id !== input.stopId);
    const allStopsResolved = otherStops.every((routeStop) => ["DELIVERED", "FAILED"].includes(routeStop.status));

    await tx.route.update({
      where: {
        id: stop.routeId,
      },
      data: {
        status: allStopsResolved ? "COMPLETED" : stop.route.status,
        history: {
          create: {
            action: "Stop delivered",
            details: `Stop ${stop.orderIndex} marked delivered with ${proofPhotoUrls.length} proof photo${proofPhotoUrls.length === 1 ? "" : "s"}${leftInSafePlace ? " and safe place confirmation" : ` and customer signature ${podName}`}. Customer and Shopify follow up will run after the delivery has been saved.`,
          },
        },
      },
    });
  });

  if (fulfilmentSettings.routePublishFulfilmentMode === "on_delivery_complete") {
    if (input.admin) {
      for (const order of stop.deliveryGroup.orders) {
        try {
          const result = await markShopifyOrderDelivered(input.admin, order.shopifyOrderId);
          shopifyResults.push(`${order.shopifyOrderNumber}: ${result.fulfilled ? "fulfilled" : result.reason || "tagged"}`);
        } catch (error) {
          shopifyResults.push(`${order.shopifyOrderNumber}: Shopify skipped, ${error instanceof Error ? error.message : "unknown Shopify error"}`);
        }
      }
    } else {
      shopifyResults.push("Shopify fulfilment skipped, app shop domain is not set in Railway");
    }
  } else {
    shopifyResults.push("Shopify fulfilment skipped on delivery completion because fulfilment is set to run when the route is published");
  }

  try {
    const signedPrimaryProofPhotoUrl = await createSignedProofPhotoUrl(primaryProofPhotoUrl);
    const signedSignaturePhotoUrl = await createSignedProofPhotoUrl(signaturePhotoUrl);
    const notificationResult = await sendDeliveryCompleteNotifications({
      routeId: stop.routeId,
      routeName: stop.route.name,
      proofPhotoUrl: signedPrimaryProofPhotoUrl,
      signaturePhotoUrl: signedSignaturePhotoUrl,
      orders: stop.deliveryGroup.orders,
    });
    const notificationErrorDetails = notificationResult.errors.length
      ? `. Notification errors: ${notificationResult.errors.join(" | ")}`
      : "";

    await prisma.routeHistory.create({
      data: {
        routeId: stop.routeId,
        action: "Delivery follow up completed",
        details: `Shopify: ${shopifyResults.join(", ")}. Delivery complete notifications: ${notificationResult.smsSent} SMS sent, ${notificationResult.emailsSent} emails sent, ${notificationResult.skipped} skipped, ${notificationResult.failed} failed${notificationErrorDetails}`,
      },
    });
  } catch (error) {
    await prisma.routeHistory.create({
      data: {
        routeId: stop.routeId,
        action: "Delivery follow up skipped",
        details: error instanceof Error ? error.message : "Delivery follow up failed after stop was saved.",
      },
    });
  }

  try {
    await recordEtaLearningObservation({
      estimatedArrival: stop.estimatedArrival,
      actualArrival,
      deliveryGroup: {
        postcode: stop.deliveryGroup.postcode,
      },
      route: {
        driverId: stop.route.driverId,
      },
    });
  } catch {
    // ETA learning must not undo a completed delivery.
  }

  try {
    await recalculateTrafficEtaAfterStop(input.stopId);
  } catch {
    // Traffic ETA refresh must not undo a completed delivery.
  }

  try {
    await sendNextPendingStopNotification(stop.routeId, input.stopId);
  } catch {
    // Customer update must not undo a completed delivery.
  }
}
