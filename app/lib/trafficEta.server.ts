import prisma from "../db.server";
import { getAppCredentials } from "./appCredentials.server";
import { getEtaLearningAdjustmentMinutes } from "./etaLearning.server";

type RoutePoint = {
  latitude: number;
  longitude: number;
};

type TomTomRouteSummary = {
  travelTimeInSeconds?: number;
  trafficDelayInSeconds?: number;
  lengthInMeters?: number;
  noTrafficTravelTimeInSeconds?: number;
};

type TomTomRoutePayload = {
  routes?: Array<{
    summary?: TomTomRouteSummary;
  }>;
};

type StopWithPoint = {
  id: string;
  orderIndex: number;
  deliveryGroup?: {
    latitude: number | null;
    longitude: number | null;
    postcode?: string | null;
    orders?: Array<{
      lineItemSummary?: string | null;
      orderSource?: string | null;
    }>;
  } | null;
};

export type TrafficEtaResult = {
  ok: boolean;
  reason?: string;
  nextStopId?: string;
  estimatedArrival?: Date;
  travelMinutes?: number;
  trafficDelayMinutes?: number;
  handlingMinutes?: number;
  recalculatedStops?: number;
  trafficLegs?: number;
};

function hasCoordinates(value: unknown): value is RoutePoint {
  const point = value as RoutePoint;

  return typeof point?.latitude === "number" &&
    typeof point?.longitude === "number" &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude);
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + Math.max(0, minutes) * 60 * 1000);
}

function pointForStop(stop: StopWithPoint): RoutePoint | null {
  const point = {
    latitude: stop.deliveryGroup?.latitude,
    longitude: stop.deliveryGroup?.longitude,
  };

  return hasCoordinates(point) ? point : null;
}

function itemCountFromSummary(summary?: string | null) {
  return (summary || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .length;
}

function handlingMinutesForStop(stop: StopWithPoint, defaultMinutes: number) {
  const orders = stop.deliveryGroup?.orders || [];
  const orderCount = orders.length;
  const itemCount = orders.reduce((total, order) => total + itemCountFromSummary(order.lineItemSummary), 0);
  const manualOrderCount = orders.filter((order) => order.orderSource === "manual").length;
  const extraOrderMinutes = Math.max(0, orderCount - 1) * 2;
  const extraItemMinutes = Math.min(8, Math.max(0, itemCount - 6));
  const manualMinutes = manualOrderCount > 0 ? 2 : 0;

  return Math.max(5, defaultMinutes + extraOrderMinutes + extraItemMinutes + manualMinutes);
}

function tomTomRouteUrl(from: RoutePoint, to: RoutePoint, apiKey: string) {
  const locations = `${from.latitude},${from.longitude}:${to.latitude},${to.longitude}`;
  const params = new URLSearchParams({
    key: apiKey,
    traffic: "true",
    travelMode: "van",
    routeType: "fastest",
    computeTravelTimeFor: "all",
  });

  return `https://api.tomtom.com/routing/1/calculateRoute/${locations}/json?${params.toString()}`;
}

async function getTomTomTravelTimeMinutes(from: RoutePoint, to: RoutePoint) {
  try {
    const credentials = await getAppCredentials();

    if (!credentials.tomtomApiKey) {
      return null;
    }

    const response = await fetch(tomTomRouteUrl(from, to, credentials.tomtomApiKey));

    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as TomTomRoutePayload;
    const summary = payload.routes?.[0]?.summary;
    const travelSeconds = summary?.travelTimeInSeconds;

    if (typeof travelSeconds !== "number" || !Number.isFinite(travelSeconds)) {
      return null;
    }

    return {
      travelMinutes: Math.max(1, Math.ceil(travelSeconds / 60)),
      trafficDelayMinutes: typeof summary?.trafficDelayInSeconds === "number"
        ? Math.max(0, Math.ceil(summary.trafficDelayInSeconds / 60))
        : 0,
    };
  } catch {
    return null;
  }
}

function fallbackTravelMinutes(routeTimePerDropMinutes: number) {
  return Math.max(1, routeTimePerDropMinutes);
}

async function calculateLeg(
  fromPoint: RoutePoint | null,
  toPoint: RoutePoint | null,
  fallbackMinutes: number,
) {
  const tomTom = fromPoint && toPoint
    ? await getTomTomTravelTimeMinutes(fromPoint, toPoint)
    : null;

  return {
    travelMinutes: tomTom?.travelMinutes ?? fallbackTravelMinutes(fallbackMinutes),
    trafficDelayMinutes: tomTom?.trafficDelayMinutes ?? 0,
    usedTraffic: Boolean(tomTom),
  };
}

export async function recalculateTrafficEtaAfterStop(stopId: string): Promise<TrafficEtaResult> {
  try {
    const completedAt = new Date();
    const completedStop = await prisma.stop.findUnique({
      where: { id: stopId },
      include: {
        deliveryGroup: {
          include: {
            orders: true,
          },
        },
        route: {
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
          },
        },
      },
    });

    if (!completedStop?.route || !completedStop.deliveryGroup) {
      return { ok: false, reason: "Stop not found." };
    }

    const route = completedStop.route;
    const remainingStops = route.stops.filter((stop) => (
      stop.status === "PENDING" && stop.orderIndex > completedStop.orderIndex
    ));

    if (!remainingStops.length) {
      return { ok: true, reason: "No next pending stop." };
    }

    let etaClock = completedAt;
    let previousPoint = pointForStop(completedStop);
    let previousHandlingMinutes = 0;
    let totalTravelMinutes = 0;
    let totalTrafficDelayMinutes = 0;
    let totalHandlingMinutes = 0;
    let totalLearningAdjustmentMinutes = 0;
    let trafficLegs = 0;

    const etaUpdates: Array<{
      stopId: string;
      estimatedArrival: Date;
    }> = [];

    for (const stop of remainingStops) {
      const nextPoint = pointForStop(stop);
      const leg = await calculateLeg(previousPoint, nextPoint, route.timePerDropMinutes);
      const learningAdjustmentMinutes = await getEtaLearningAdjustmentMinutes({
        postcode: stop.deliveryGroup?.postcode,
        driverId: route.driverId,
      });

      etaClock = addMinutes(etaClock, previousHandlingMinutes + leg.travelMinutes + learningAdjustmentMinutes);

      etaUpdates.push({
        stopId: stop.id,
        estimatedArrival: etaClock,
      });

      totalTravelMinutes += leg.travelMinutes;
      totalTrafficDelayMinutes += leg.trafficDelayMinutes;
      totalHandlingMinutes += previousHandlingMinutes;
      totalLearningAdjustmentMinutes += learningAdjustmentMinutes;

      if (leg.usedTraffic) {
        trafficLegs += 1;
      }

      previousHandlingMinutes = handlingMinutesForStop(stop, route.timePerDropMinutes);

      if (nextPoint) {
        previousPoint = nextPoint;
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const etaUpdate of etaUpdates) {
        await tx.stop.update({
          where: { id: etaUpdate.stopId },
          data: { estimatedArrival: etaUpdate.estimatedArrival },
        });
      }

      await tx.route.update({
        where: { id: route.id },
        data: {
          history: {
            create: {
              action: "Traffic ETAs recalculated",
              details: `After stop ${completedStop.orderIndex}, recalculated ${etaUpdates.length} remaining ETA${etaUpdates.length === 1 ? "" : "s"}. ${trafficLegs} leg${trafficLegs === 1 ? "" : "s"} used TomTom live traffic. Total travel ${totalTravelMinutes} min, traffic delay ${totalTrafficDelayMinutes} min, handling ${totalHandlingMinutes} min, learning adjustment ${totalLearningAdjustmentMinutes} min.`,
            },
          },
        },
      });
    });

    return {
      ok: true,
      nextStopId: remainingStops[0]?.id,
      estimatedArrival: etaUpdates[0]?.estimatedArrival,
      travelMinutes: totalTravelMinutes,
      trafficDelayMinutes: totalTrafficDelayMinutes,
      handlingMinutes: totalHandlingMinutes,
      recalculatedStops: etaUpdates.length,
      trafficLegs,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Traffic ETA recalculation failed.",
    };
  }
}
