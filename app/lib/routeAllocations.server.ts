import prisma from "../db.server";

export const activeRouteStatuses = ["PUBLISHED", "NOTIFICATIONS_SENT", "OUT_FOR_DELIVERY"];
const activeStopStatuses = ["PENDING", "ARRIVED"];

export type RouteAllocation = {
  orderId: string;
  orderNumber: string;
  routeId: string;
  routeName: string;
  routeStatus: string;
  routeDate: string;
  driverName: string | null;
  stopId: string;
  stopIndex: number;
};

export async function getActiveRouteAllocations(orderIds?: string[]) {
  const uniqueOrderIds = [...new Set((orderIds || []).filter(Boolean))];

  if (orderIds && uniqueOrderIds.length === 0) {
    return new Map<string, RouteAllocation>();
  }

  const orderStops = await prisma.orderStop.findMany({
    where: {
      ...(uniqueOrderIds.length ? { shopifyOrderId: { in: uniqueOrderIds } } : {}),
      deliveryGroup: {
        stops: {
          some: {
            status: {
              in: activeStopStatuses,
            },
            route: {
              status: {
                in: activeRouteStatuses,
              },
            },
          },
        },
      },
    },
    include: {
      deliveryGroup: {
        include: {
          stops: {
            where: {
              status: {
                in: activeStopStatuses,
              },
              route: {
                status: {
                  in: activeRouteStatuses,
                },
              },
            },
            include: {
              route: {
                include: {
                  driver: true,
                },
              },
            },
            orderBy: {
              orderIndex: "asc",
            },
          },
        },
      },
    },
  });

  const allocations = new Map<string, RouteAllocation>();

  for (const orderStop of orderStops) {
    const stop = orderStop.deliveryGroup?.stops?.[0];
    const route = stop?.route;

    if (!stop || !route) {
      continue;
    }

    allocations.set(orderStop.shopifyOrderId, {
      orderId: orderStop.shopifyOrderId,
      orderNumber: orderStop.shopifyOrderNumber,
      routeId: route.id,
      routeName: route.name,
      routeStatus: route.status,
      routeDate: route.date.toISOString(),
      driverName: route.driver?.name || null,
      stopId: stop.id,
      stopIndex: stop.orderIndex,
    });
  }

  return allocations;
}

export async function assertOrdersAvailableForRoute(orderIds: string[], currentRouteId?: string | null) {
  const allocations = await getActiveRouteAllocations(orderIds);
  const blocked = [...allocations.values()].filter((allocation) => allocation.routeId !== currentRouteId);

  if (!blocked.length) {
    return;
  }

  const details = blocked
    .map((allocation) => `${allocation.orderNumber} is already in ${allocation.routeName}`)
    .join(", ");

  throw new Error(`Some orders are already allocated to active routes. ${details}. Remove them from the existing live route first.`);
}
