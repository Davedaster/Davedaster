import prisma from "../db.server";
import { assertOrdersAvailableForRoute } from "./routeAllocations.server";
import { calculateEtaSlots } from "./routeDrafts.server";
import type { DeliveryOrder } from "./shopifyOrders.server";

function shopifyOrderIds(orders: DeliveryOrder[]) {
  return orders
    .filter((order) => order.orderSource !== "manual")
    .map((order) => order.id)
    .filter(Boolean);
}

function routeHistoryDetails(order: DeliveryOrder) {
  return `${order.name} · ${order.customerName} · ${order.postcode || "No postcode"}`;
}

async function assertDraftRoute(routeId: string) {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: {
      stops: {
        orderBy: { orderIndex: "asc" },
        include: {
          deliveryGroup: {
            include: {
              orders: true,
            },
          },
        },
      },
    },
  });

  if (!route) {
    throw new Error("Route not found.");
  }

  if (route.status !== "DRAFT") {
    throw new Error("Draft stops can only be edited before the route is published.");
  }

  return route;
}

export async function addOrderToDraftRoute(routeId: string, order: DeliveryOrder) {
  const route = await assertDraftRoute(routeId);
  const alreadyOnRoute = route.stops.some((stop) =>
    stop.deliveryGroup?.orders.some((routeOrder) => routeOrder.shopifyOrderId === order.id),
  );

  if (alreadyOnRoute) {
    throw new Error(`${order.name} is already on this draft route.`);
  }

  await assertOrdersAvailableForRoute(shopifyOrderIds([order]), routeId);

  const nextOrderIndex = route.stops.reduce((max, stop) => Math.max(max, stop.orderIndex), 0) + 1;

  await prisma.route.update({
    where: {
      id: routeId,
    },
    data: {
      totalMileage: null,
      totalDuration: null,
      stops: {
        create: {
          orderIndex: nextOrderIndex,
          isLocked: false,
          deliveryGroup: {
            create: {
              address: order.formattedAddress || order.addressSummary,
              formattedAddress: order.formattedAddress,
              postcode: order.postcode,
              latitude: order.latitude,
              longitude: order.longitude,
              addressStatus: order.addressStatus,
              addressSource: order.orderSource === "manual" ? "manual" : order.hasManualOverride ? "manual" : "getaddress",
              addressConfidence: order.addressConfidence,
              manualAddress: order.manualAddress,
              useManualAddress: order.hasManualOverride || order.orderSource === "manual",
              orders: {
                create: {
                  shopifyOrderId: order.id,
                  shopifyOrderNumber: order.name,
                  orderSource: order.orderSource || "shopify",
                  customerName: order.customerName,
                  customerEmail: order.email,
                  customerPhone: order.phone,
                  postcode: order.postcode,
                  lineItemSummary: order.lineItemSummary,
                },
              },
            },
          },
        },
      },
      history: {
        create: {
          action: "Draft stop added",
          details: routeHistoryDetails(order),
        },
      },
    },
  });

  return calculateEtaSlots(routeId);
}

export async function removeDraftRouteStop(routeId: string, stopId: string) {
  const route = await assertDraftRoute(routeId);
  const stop = route.stops.find((routeStop) => routeStop.id === stopId);

  if (!stop) {
    throw new Error("Stop not found on this draft route.");
  }

  const deliveryGroupId = stop.deliveryGroupId;
  const orderLabel = stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).filter(Boolean).join(", ") || `Stop ${stop.orderIndex}`;
  const remainingStops = route.stops.filter((routeStop) => routeStop.id !== stopId);

  await prisma.$transaction(async (tx) => {
    await tx.returnTicket.updateMany({
      where: {
        stopId,
      },
      data: {
        stopId: null,
      },
    });

    await tx.stop.delete({
      where: {
        id: stopId,
      },
    });

    for (const [index, remainingStop] of remainingStops.entries()) {
      await tx.stop.update({
        where: {
          id: remainingStop.id,
        },
        data: {
          orderIndex: index + 1,
        },
      });
    }

    if (deliveryGroupId) {
      const linkedStops = await tx.stop.count({
        where: {
          deliveryGroupId,
        },
      });

      if (linkedStops === 0) {
        await tx.orderStop.deleteMany({
          where: {
            deliveryGroupId,
          },
        });
        await tx.proofPhoto.deleteMany({
          where: {
            deliveryGroupId,
          },
        });
        await tx.deliveryGroup.delete({
          where: {
            id: deliveryGroupId,
          },
        }).catch(() => null);
      }
    }

    await tx.route.update({
      where: {
        id: routeId,
      },
      data: {
        totalMileage: null,
        totalDuration: null,
        history: {
          create: {
            action: "Draft stop removed",
            details: orderLabel,
          },
        },
      },
    });
  });

  return calculateEtaSlots(routeId);
}

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

  return calculateEtaSlots(routeId);
}
