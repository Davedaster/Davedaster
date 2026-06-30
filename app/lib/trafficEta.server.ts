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

export type TrafficEtaResult = {
  ok: boolean;
  reason?: string;
  nextStopId?: string;
  estimatedArrival?: Date;
  travelMinutes?: number;
  trafficDelayMinutes?: number;
  handlingMinutes?: number;
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
    const nextStop = route.stops.find((stop) => stop.status === "PENDING" && stop.orderIndex > completedStop.orderIndex);

    if (!nextStop?.deliveryGroup) {
      return { ok: true, reason: "No next pending stop." };
    }

    const fromPoint = {
      latitude: completedStop.deliveryGroup.latitude,
      longitude: completedStop.deliveryGroup.longitude,
    };
    const toPoint = {
      latitude: nextStop.deliveryGroup.latitude,
      longitude: nextStop.deliveryGroup.longitude,
    };

    const tomTom = hasCoordinates(fromPoint) && hasCoordinates(toPoint)
      ? await getTomTomTravelTimeMinutes(fromPoint, toPoint)
      : null;
    const travelMinutes = tomTom?.travelMinutes ?? fallbackTravelMinutes(route.timePerDropMinutes);
    const trafficDelayMinutes = tomTom?.trafficDelayMinutes ?? 0;
    const handlingMinutes = Math.max(0, route.timePerDropMinutes);
    const nextEta = addMinutes(completedAt, travelMinutes);

    await prisma.$transaction(async (tx) => {
      await tx.stop.update({
        where: { id: nextStop.id },
        data: { estimatedArrival: nextEta },
      });

      const followingStops = route.stops.filter((stop) => stop.status === "PENDING" && stop.orderIndex > nextStop.orderIndex);

      for (const [index, followingStop] of followingStops.entries()) {
        await tx.stop.update({
          where: { id: followingStop.id },
          data: {
            estimatedArrival: addMinutes(nextEta, (index + 1) * handlingMinutes),
          },
        });
      }

      await tx.route.update({
        where: { id: route.id },
        data: {
          history: {
            create: {
              action: "Traffic ETA recalculated",
              details: `After stop ${completedStop.orderIndex}, next stop ${nextStop.orderIndex} ETA set using ${tomTom ? "TomTom live traffic" : "route timing fallback"}. Travel ${travelMinutes} min, traffic delay ${trafficDelayMinutes} min.`,
            },
          },
        },
      });
    });

    return {
      ok: true,
      nextStopId: nextStop.id,
      estimatedArrival: nextEta,
      travelMinutes,
      trafficDelayMinutes,
      handlingMinutes,
    };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Traffic ETA recalculation failed." };
  }
}
