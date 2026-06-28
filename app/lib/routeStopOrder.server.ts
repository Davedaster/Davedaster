import prisma from "../db.server";

export async function moveDraftRouteStop(routeId: string, stopId: string, direction: "up" | "down") {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: {
      stops: {
        orderBy: { orderIndex: "asc" },
      },
    },
  });

  if (!route) {
    throw new Error("Route not found.");
  }

  if (route.status !== "DRAFT") {
    throw new Error("Stops can only be manually rearranged while the route is still a draft.");
  }

  const currentIndex = route.stops.findIndex((stop) => stop.id === stopId);

  if (currentIndex === -1) {
    throw new Error("Stop not found on this route.");
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (targetIndex < 0 || targetIndex >= route.stops.length) {
    return route;
  }

  const currentStop = route.stops[currentIndex];
  const targetStop = route.stops[targetIndex];

  await prisma.$transaction([
    prisma.stop.update({
      where: { id: currentStop.id },
      data: { orderIndex: targetStop.orderIndex },
    }),
    prisma.stop.update({
      where: { id: targetStop.id },
      data: { orderIndex: currentStop.orderIndex },
    }),
    prisma.route.update({
      where: { id: routeId },
      data: {
        totalMileage: null,
        totalDuration: null,
        history: {
          create: {
            action: "Draft stop order changed",
            details: `${currentStop.id} moved ${direction}`,
          },
        },
      },
    }),
  ]);

  return prisma.route.findUnique({
    where: { id: routeId },
    include: {
      stops: {
        orderBy: { orderIndex: "asc" },
      },
    },
  });
}
