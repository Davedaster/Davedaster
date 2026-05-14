import prisma from "../db.server";

function isValidProofPhotoUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export async function listStopsForProofOfDelivery() {
  return prisma.stop.findMany({
    where: {
      status: {
        not: "DELIVERED",
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
        },
      },
    },
  });
}

export async function saveProofOfDelivery(input: {
  stopId: string;
  proofPhotoUrl: string;
  deliveryNote?: string | null;
  safePlaceNote?: string | null;
  leftInSafePlace?: boolean;
}) {
  const proofPhotoUrl = input.proofPhotoUrl.trim();

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
      deliveryGroup: true,
    },
  });

  if (!stop || !stop.deliveryGroupId) {
    throw new Error("Stop not found.");
  }

  if (stop.status === "DELIVERED") {
    throw new Error("This stop has already been marked delivered.");
  }

  if (!proofPhotoUrl) {
    throw new Error("Proof photo link is required before marking delivered.");
  }

  if (!isValidProofPhotoUrl(proofPhotoUrl)) {
    throw new Error("Proof photo link must be a valid web address.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.deliveryGroup.update({
      where: {
        id: stop.deliveryGroupId!,
      },
      data: {
        proofPhotoUrl,
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
            details: `Stop ${stop.orderIndex} marked delivered with proof photo`,
          },
        },
      },
    });
  });
}
