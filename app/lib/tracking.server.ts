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
            },
          },
        },
        orderBy: {
          orderIndex: "asc",
        },
      },
      history: {
        orderBy: {
          createdAt: "desc",
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

  const isNextDrop = route.status === "OUT_FOR_DELIVERY" && stop.status === "PENDING" && stop.orderIndex === Math.min(
    ...route.stops.filter((routeStop) => routeStop.status === "PENDING").map((routeStop) => routeStop.orderIndex),
  );

  return {
    route,
    stop,
    deliveryGroup: stop.deliveryGroup,
    order,
    isNextDrop,
  };
}
