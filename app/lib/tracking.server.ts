import prisma from "../db.server";

export async function getCustomerTracking(routeId: string, shopifyOrderId: string) {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: {
      driver: true,
      stops: {
        include: {
          deliveryGroup: {
            include: {
              orders: true,
              proofPhotos: {
                orderBy: {
                  createdAt: "asc",
                },
              },
            },
          },
        },
        orderBy: {
          orderIndex: "asc",
        },
      },
    },
  });

  if (!route) {
    return null;
  }

  const stop = route.stops.find((routeStop) => (
    routeStop.deliveryGroup?.orders.some((order) => order.shopifyOrderId === shopifyOrderId)
  ));

  if (!stop || !stop.deliveryGroup) {
    return null;
  }

  const order = stop.deliveryGroup.orders.find((deliveryOrder) => deliveryOrder.shopifyOrderId === shopifyOrderId);

  if (!order) {
    return null;
  }

  const pendingStops = route.stops.filter((routeStop) => routeStop.status === "PENDING");
  const nextPendingOrderIndex = pendingStops.length
    ? Math.min(...pendingStops.map((routeStop) => routeStop.orderIndex))
    : null;
  const isNextDrop = route.status === "OUT_FOR_DELIVERY" && stop.status === "PENDING" && stop.orderIndex === nextPendingOrderIndex;

  return {
    route: {
      id: route.id,
      name: route.name,
      date: route.date,
      status: route.status,
      driver: route.driver ? {
        name: route.driver.name,
        photoUrl: route.driver.photoUrl,
      } : null,
    },
    stop: {
      id: stop.id,
      orderIndex: stop.orderIndex,
      estimatedArrival: stop.estimatedArrival,
      status: stop.status,
    },
    deliveryGroup: {
      postcode: stop.deliveryGroup.postcode,
      deliveryNote: stop.deliveryGroup.deliveryNote,
      proofPhotoUrl: stop.deliveryGroup.proofPhotoUrl,
      proofPhotos: stop.deliveryGroup.proofPhotos.map((photo) => ({
        id: photo.id,
        url: photo.url,
        label: photo.label,
      })),
    },
    order: {
      shopifyOrderNumber: order.shopifyOrderNumber,
    },
    isNextDrop,
  };
}
