import prisma from "../db.server";
import { createSignedProofPhotoUrls } from "./proofPhotoStorage.server";
import { sendFirstOutForDeliveryNotification } from "./routeNotifications.server";

const DRIVER_ROUTE_STATUSES = ["PUBLISHED", "NOTIFICATIONS_SENT", "OUT_FOR_DELIVERY"];

async function withSignedProofPhotos<T extends { stops: Array<{ deliveryGroup?: { proofPhotos?: Array<{ url: string }> } | null }> }>(route: T | null) {
  if (!route) {
    return route;
  }

  return {
    ...route,
    stops: await Promise.all(route.stops.map(async (stop) => ({
      ...stop,
      deliveryGroup: stop.deliveryGroup ? {
        ...stop.deliveryGroup,
        proofPhotos: await createSignedProofPhotoUrls(stop.deliveryGroup.proofPhotos || []),
      } : stop.deliveryGroup,
    }))),
  };
}

export async function listDriverRoutes() {
  const routes = await prisma.route.findMany({
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

  return Promise.all(routes.map((route) => withSignedProofPhotos(route)));
}

export async function getDriverRoute(routeId: string) {
  const route = await prisma.route.findFirst({
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

  return withSignedProofPhotos(route);
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
