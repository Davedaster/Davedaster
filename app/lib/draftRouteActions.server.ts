import prisma from "../db.server";

const TEST_DELETE_ALLOWED_STATUSES = ["DRAFT", "PUBLISHED", "NOTIFICATIONS_SENT", "COMPLETED", "CANCELLED"];

export async function getRouteActionSummary(routeId: string) {
  return prisma.route.findUnique({
    where: {
      id: routeId,
    },
    select: {
      id: true,
      name: true,
      status: true,
      driverId: true,
    },
  });
}

async function deleteRouteAndUnusedDeliveryGroups(routeId: string) {
  const route = await prisma.route.findUnique({
    where: {
      id: routeId,
    },
    select: {
      id: true,
      status: true,
      stops: {
        select: {
          deliveryGroupId: true,
        },
      },
    },
  });

  if (!route) {
    throw new Error("Route could not be found.");
  }

  const deliveryGroupIds = [...new Set(route.stops.map((stop) => stop.deliveryGroupId).filter(Boolean))] as string[];

  await prisma.$transaction(async (tx) => {
    await tx.route.delete({
      where: {
        id: routeId,
      },
    });

    for (const deliveryGroupId of deliveryGroupIds) {
      const remainingStops = await tx.stop.count({
        where: {
          deliveryGroupId,
        },
      });

      if (remainingStops === 0) {
        await tx.deliveryGroup.delete({
          where: {
            id: deliveryGroupId,
          },
        }).catch(() => null);
      }
    }
  });

  return route;
}

export async function deleteDraftRoute(routeId: string) {
  const route = await prisma.route.findUnique({
    where: {
      id: routeId,
    },
    select: {
      status: true,
    },
  });

  if (!route) {
    throw new Error("Draft route could not be found.");
  }

  if (route.status !== "DRAFT") {
    throw new Error("Only draft routes can be deleted from this button.");
  }

  return deleteRouteAndUnusedDeliveryGroups(routeId);
}

export async function deleteTestRoute(routeId: string) {
  const route = await prisma.route.findUnique({
    where: {
      id: routeId,
    },
    select: {
      status: true,
    },
  });

  if (!route) {
    throw new Error("Route could not be found.");
  }

  if (!TEST_DELETE_ALLOWED_STATUSES.includes(route.status)) {
    throw new Error("This route cannot be deleted while it is out for delivery. Stop testing on the driver phone first, or delete a route that has not started.");
  }

  return deleteRouteAndUnusedDeliveryGroups(routeId);
}
