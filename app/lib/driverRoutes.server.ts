import prisma from "../db.server";

export async function listDriverRoutes() {
  return prisma.route.findMany({
    where: {
      status: {
        in: ["PUBLISHED", "NOTIFICATIONS_SENT", "OUT_FOR_DELIVERY"],
      },
    },
    orderBy: [
      { date: "desc" },
      { createdAt: "desc" },
    ],
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
    },
  });
}

export async function getDriverRoute(routeId: string) {
  return prisma.route.findUnique({
    where: {
      id: routeId,
    },
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
    },
  });
}

export async function startDriverRoute(routeId: string) {
  return prisma.route.update({
    where: {
      id: routeId,
    },
    data: {
      status: "OUT_FOR_DELIVERY",
      history: {
        create: {
          action: "Driver started route",
          details: "Route marked out for delivery from the driver route view",
        },
      },
    },
  });
}
