import prisma from "../db.server";

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

export async function deleteDraftRoute(routeId: string) {
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
    throw new Error("Draft route could not be found.");
  }

  if (route.status !== "DRAFT") {
    throw new Error("Only draft routes can be deleted from this page.");
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
}
