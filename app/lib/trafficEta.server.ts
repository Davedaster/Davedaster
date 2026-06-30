import prisma from "../db.server";
import { getAppCredentials } from "./appCredentials.server";

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
        deliveryGroup: true,
        route: {
          include: {
            stops: {
              include: {
                deliveryGroup: true,
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
    const handlingMinutes = Math.max(0, route.timePerDropMinutes);
    const remainingStops = route.stops.filter((stop) => (
      stop.status === "PENDING" && stop.orderIndex > completedStop.orderIndex
    ));

    if (!remainingStops.length) {
      return { ok: true, reason: "No next pending stop." };
    }

    let etaClock = completedAt;
    let previousPoint = pointForStop(completedStop);
    let totalTravelMinutes = 0;
    let totalTrafficDelayMinutes = 0;
    let trafficLegs = 0;

    const etaUpdates: Array<{
      stopId: string;
      estimatedArrival: Date;
    }> = [];

    for (const [index, stop] of remainingStops.entries()) {
      const nextPoint = pointForStop(stop);
      const leg = await calculateLeg(previousPoint, nextPoint, route.timePerDropMinutes);

      etaClock = addMinutes(
        etaClock,
        index === 0 ? leg.travelMinutes : handlingMinutes + leg.travelMinutes,
      );

      etaUpdates.push({
        stopId: stop.id,
        estimatedArrival: etaClock,
      });

      totalTravelMinutes += leg.travelMinutes;
      totalTrafficDelayMinutes += leg.trafficDelayMinutes;

      if (leg.usedTraffic) {
        trafficLegs += 1;
      }

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
              details: `After stop ${completedStop.orderIndex}, recalculated ${etaUpdates.length} remaining ETA${etaUpdates.length === 1 ? "" : "s"}. ${trafficLegs} leg${trafficLegs === 1 ? "" : "s"} used TomTom live traffic. Total travel ${totalTravelMinutes} min, traffic delay ${totalTrafficDelayMinutes} min.`,
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
      handlingMinutes,
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