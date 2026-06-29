import prisma from "../db.server";
import { sendFirstOutForDeliveryNotification } from "./routeNotifications.server";

const DRIVER_ROUTE_STATUSES = ["PUBLISHED", "NOTIFICATIONS_SENT", "OUT_FOR_DELIVERY"];

export async function listDriverRoutes() {
  return prisma.route.findMany({
    where: {
      status: {
        in: DRIVER_ROUTE_STATUSES,
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
}

export async function getDriverRoute(routeId: string) {
  return prisma.route.findFirst({
    where: {
      id: routeId,
      status: {
        in: DRIVER_ROUTE_STATUSES,
      },
    },
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
}

export async function startDriverRoute(routeId: string) {
  const route = await getDriverRoute(routeId);

  if (!route) {
    throw new Error("Route not found.");
  }

  if (route.status === "OUT_FOR_DELIVERY") {
    return route;
  }

  const updatedRoute = await prisma.route.update({
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

  await sendFirstOutForDeliveryNotification(routeId);

  return updatedRoute;
}
