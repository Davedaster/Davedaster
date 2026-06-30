import prisma from "../db.server";
import { buildEtaSlots } from "./etaSlots.server";
import { lookupAddress } from "./getAddress.server";
import { assertOrdersAvailableForRoute } from "./routeAllocations.server";
import type { DeliveryOrder } from "./shopifyOrders.server";
import { buildRouteXLLocation, optimiseLocations } from "./routexl.server";

type CreateRouteDraftInput = {
  orders: DeliveryOrder[];
  routeName?: string;
  routeDate?: string;
  plannedStartTime?: string;
  timePerDropMinutes?: number;
  customerSlotMinutes?: number;
  startAddress?: string;
  finishAddress?: string;
  startLatitude?: number | null;
  startLongitude?: number | null;
  finishLatitude?: number | null;
  finishLongitude?: number | null;
};

type RoutePlanningSettingsInput = {
  routeDate?: string;
  plannedStartTime?: string;
  timePerDropMinutes?: number;
  customerSlotMinutes?: number;
  startAddress?: string;
  finishAddress?: string;
  startLatitude?: number | null;
  startLongitude?: number | null;
  finishLatitude?: number | null;
  finishLongitude?: number | null;
};

const DEFAULT_SHOP_LOCATION = {
  name: "Bathroom Panels Direct",
  address: "Unit 1 Olympus Business Park, Newton Abbot, TQ12 2SN, United Kingdom",
  postcode: "TQ12 2SN",
  latitude: 50.5293,
  longitude: -3.6119,
};

export const defaultRoutePlanningSettings = {
  routeDate: getDateInputValue(new Date()),
  plannedStartTime: "05:00",
  timePerDropMinutes: 10,
  customerSlotMinutes: 60,
  startAddress: DEFAULT_SHOP_LOCATION.address,
  finishAddress: DEFAULT_SHOP_LOCATION.address,
};

function getDateInputValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getTodayRouteDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function parseRouteDate(value?: string) {
  if (!value) {
    return getTodayRouteDate();
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return getTodayRouteDate();
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function normaliseTime(value?: string) {
  const trimmed = value?.trim() || defaultRoutePlanningSettings.plannedStartTime;

  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : defaultRoutePlanningSettings.plannedStartTime;
}

function normalisePositiveNumber(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || typeof value !== "number") {
    return fallback;
  }

  return Math.max(1, Math.round(value));
}

function normaliseCoordinate(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildRouteName(orders: DeliveryOrder[], routeName?: string, routeDate?: Date) {
  if (routeName?.trim()) {
    return routeName.trim();
  }

  const date = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(routeDate || new Date());

  return `Draft route ${date} ${orders.length} stops`;
}

function routeXLStopKey(stopId: string) {
  return `STOP_${stopId}`;
}

function extractRouteXLStopKey(waypointName: string) {
  return waypointName.split(",")[0]?.trim() || waypointName.trim();
}

function extractPostcode(value: string) {
  const match = value.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);

  return match?.[0]?.toUpperCase() || "";
}

function isDefaultShopAddress(address: string) {
  const normalisedAddress = address.trim().toLowerCase();

  return normalisedAddress === DEFAULT_SHOP_LOCATION.address.toLowerCase() ||
    (normalisedAddress.includes("olympus") && normalisedAddress.includes("tq12 2sn"));
}

function shopifyOrderIds(orders: DeliveryOrder[]) {
  return orders
    .filter((order) => order.orderSource !== "manual")
    .map((order) => order.id)
    .filter(Boolean);
}

async function resolveRouteEndpoint(address: string | undefined, latitude?: number | null, longitude?: number | null) {
  const trimmedAddress = address?.trim() || DEFAULT_SHOP_LOCATION.address;
  const lockedLatitude = normaliseCoordinate(latitude);
  const lockedLongitude = normaliseCoordinate(longitude);

  if (lockedLatitude !== null && lockedLongitude !== null) {
    return {
      address: trimmedAddress,
      latitude: lockedLatitude,
      longitude: lockedLongitude,
    };
  }

  if (isDefaultShopAddress(trimmedAddress)) {
    return {
      address: DEFAULT_SHOP_LOCATION.address,
      latitude: DEFAULT_SHOP_LOCATION.latitude,
      longitude: DEFAULT_SHOP_LOCATION.longitude,
    };
  }

  const lookup = await lookupAddress(extractPostcode(trimmedAddress), trimmedAddress);

  return {
    address: lookup.formattedAddress || trimmedAddress,
    latitude: lookup.latitude,
    longitude: lookup.longitude,
  };
}

async function buildPlanningData(input: RoutePlanningSettingsInput) {
  const [start, finish] = await Promise.all([
    resolveRouteEndpoint(input.startAddress, input.startLatitude, input.startLongitude),
    resolveRouteEndpoint(input.finishAddress, input.finishLatitude, input.finishLongitude),
  ]);

  return {
    date: parseRouteDate(input.routeDate),
    plannedStartTime: normaliseTime(input.plannedStartTime),
    timePerDropMinutes: normalisePositiveNumber(input.timePerDropMinutes, defaultRoutePlanningSettings.timePerDropMinutes),
    customerSlotMinutes: normalisePositiveNumber(input.customerSlotMinutes, defaultRoutePlanningSettings.customerSlotMinutes),
    startAddress: start.address,
    startLatitude: start.latitude,
    startLongitude: start.longitude,
    finishAddress: finish.address,
    finishLatitude: finish.latitude,
    finishLongitude: finish.longitude,
  };
}

export async function createRouteDraft(input: CreateRouteDraftInput) {
  await assertOrdersAvailableForRoute(shopifyOrderIds(input.orders));

  const planning = await buildPlanningData(input);
  const name = buildRouteName(input.orders, input.routeName, planning.date);

  return prisma.route.create({
    data: {
      name,
      date: planning.date,
      status: "DRAFT",
      plannedStartTime: planning.plannedStartTime,
      timePerDropMinutes: planning.timePerDropMinutes,
      customerSlotMinutes: planning.customerSlotMinutes,
      startAddress: planning.startAddress,
      startLatitude: planning.startLatitude,
      startLongitude: planning.startLongitude,
      finishAddress: planning.finishAddress,
      finishLatitude: planning.finishLatitude,
      finishLongitude: planning.finishLongitude,
      stops: {
        create: input.orders.map((order, index) => ({
          orderIndex: index + 1,
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
        })),
      },
      history: {
        create: {
          action: "Route created",
          details: `Draft route created with ${input.orders.length} stops. Start ${planning.plannedStartTime}, ${planning.timePerDropMinutes} minutes per drop.`,
        },
      },
    },
    include: {
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
      history: true,
    },
  });
}

export async function listRoutes() {
  return prisma.route.findMany({
    orderBy: {
      createdAt: "desc",
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

export async function getRoute(routeId: string) {
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
      history: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });
}

export async function publishRoute(routeId: string) {
  return prisma.route.update({
    where: {
      id: routeId,
    },
    data: {
      status: "PUBLISHED",
      history: {
        create: {
          action: "Route published",
          details: "Route was published from the route details page",
        },
      },
    },
    include: {
      stops: {
        include: {
          deliveryGroup: {
            include: {
              orders: true,
            },
          },
        },
      },
      history: true,
    },
  });
}

export async function renameRoute(routeId: string, name: string) {
  return prisma.route.update({
    where: {
      id: routeId,
    },
    data: {
      name,
      history: {
        create: {
          action: "Route renamed",
          details: `Route renamed to ${name}`,
        },
      },
    },
  });
}

export async function updateRoutePlanningSettings(routeId: string, input: RoutePlanningSettingsInput) {
  const planning = await buildPlanningData(input);

  return prisma.route.update({
    where: {
      id: routeId,
    },
    data: {
      date: planning.date,
      plannedStartTime: planning.plannedStartTime,
      timePerDropMinutes: planning.timePerDropMinutes,
      customerSlotMinutes: planning.customerSlotMinutes,
      startAddress: planning.startAddress,
      startLatitude: planning.startLatitude,
      startLongitude: planning.startLongitude,
      finishAddress: planning.finishAddress,
      finishLatitude: planning.finishLatitude,
      finishLongitude: planning.finishLongitude,
      history: {
        create: {
          action: "Route planning updated",
          details: `Date ${getDateInputValue(planning.date)}, start ${planning.plannedStartTime}, ${planning.timePerDropMinutes} minutes per drop`,
        },
      },
    },
  });
}

export async function assignDriverToRoute(routeId: string, driverId: string | null) {
  const driver = driverId
    ? await prisma.driver.findUnique({ where: { id: driverId } })
    : null;

  return prisma.route.update({
    where: {
      id: routeId,
    },
    data: {
      driverId,
      history: {
        create: {
          action: driver ? "Driver assigned" : "Driver removed",
          details: driver ? `Assigned to ${driver.name}` : "Driver assignment removed",
        },
      },
    },
  });
}

function getRouteEndpoint(route: Awaited<ReturnType<typeof getRoute>>, type: "start" | "finish") {
  if (!route) {
    return DEFAULT_SHOP_LOCATION;
  }

  const address = type === "start" ? route.startAddress : route.finishAddress;
  const latitude = type === "start" ? route.startLatitude : route.finishLatitude;
  const longitude = type === "start" ? route.startLongitude : route.finishLongitude;

  if (typeof latitude === "number" && typeof longitude === "number") {
    return {
      name: type === "start" ? "Route start" : "Route finish",
      address: address || DEFAULT_SHOP_LOCATION.address,
      latitude,
      longitude,
    };
  }

  return DEFAULT_SHOP_LOCATION;
}

export async function optimiseRoute(routeId: string) {
  const route = await getRoute(routeId);

  if (!route) {
    throw new Error("Route not found.");
  }

  const start = getRouteEndpoint(route, "start");
  const finish = getRouteEndpoint(route, "finish");
  const optimisableStops = route.stops.filter((stop) => {
    const group = stop.deliveryGroup;
    return typeof group?.latitude === "number" && typeof group?.longitude === "number";
  });

  if (optimisableStops.length !== route.stops.length) {
    throw new Error("Every stop needs latitude and longitude before RouteXL can optimise the route.");
  }

  const stopByRouteXLKey = new Map(
    optimisableStops.map((stop) => [routeXLStopKey(stop.id), stop]),
  );

  const locations = [
    buildRouteXLLocation(
      start.name,
      start.address,
      start.latitude,
      start.longitude,
      0,
    ),
    ...optimisableStops.map((stop) => {
      const group = stop.deliveryGroup!;
      return buildRouteXLLocation(
        routeXLStopKey(stop.id),
        group.address,
        group.latitude!,
        group.longitude!,
        route.timePerDropMinutes,
      );
    }),
    buildRouteXLLocation(
      finish.name,
      finish.address,
      finish.latitude,
      finish.longitude,
      0,
    ),
  ];

  const optimised = await optimiseLocations(locations);

  if (!optimised.feasible) {
    throw new Error("RouteXL returned an infeasible route. Check the stops and try again.");
  }

  const orderedStopKeys = optimised.waypoints.slice(1, -1).map((waypoint) => extractRouteXLStopKey(waypoint.name));

  await prisma.$transaction(async (tx) => {
    for (const [index, stopKey] of orderedStopKeys.entries()) {
      const matchingStop = stopByRouteXLKey.get(stopKey);

      if (matchingStop) {
        await tx.stop.update({
          where: { id: matchingStop.id },
          data: { orderIndex: index + 1 },
        });
      }
    }

    await tx.route.update({
      where: { id: routeId },
      data: {
        totalMileage: optimised.totalDistanceKm,
        totalDuration: optimised.totalDurationMinutes,
        history: {
          create: {
            action: "RouteXL optimised",
            details: `RouteXL returned ${optimised.totalDistanceKm ?? 0} km and ${optimised.totalDurationMinutes ?? 0} minutes`,
          },
        },
      },
    });
  });

  return getRoute(routeId);
}

export async function calculateEtaSlots(routeId: string, startTime?: string, stopMinutes?: number, slotMinutes?: number) {
  const route = await getRoute(routeId);

  if (!route) {
    throw new Error("Route not found.");
  }

  const etaSlots = buildEtaSlots(
    route.stops,
    route.date,
    startTime || route.plannedStartTime,
    stopMinutes || route.timePerDropMinutes,
    slotMinutes || route.customerSlotMinutes,
  );

  await prisma.$transaction(async (tx) => {
    for (const etaSlot of etaSlots) {
      await tx.stop.update({
        where: { id: etaSlot.stopId },
        data: { estimatedArrival: etaSlot.estimatedArrival },
      });
    }

    await tx.route.update({
      where: { id: routeId },
      data: {
        history: {
          create: {
            action: "ETA slots calculated",
            details: `Start ${startTime || route.plannedStartTime}, ${stopMinutes || route.timePerDropMinutes} minutes per stop, ${slotMinutes || route.customerSlotMinutes} minute customer slots`,
          },
        },
      },
    });
  });

  return getRoute(routeId);
}
