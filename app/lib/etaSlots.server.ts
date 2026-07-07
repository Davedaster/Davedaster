import { getAppCredentials } from "./appCredentials.server";

export type EtaSlot = {
  stopId: string;
  estimatedArrival: Date;
  slotStart: Date;
  slotEnd: Date;
};

export type EtaStopInput = {
  id: string;
  orderIndex: number;
  deliveryGroup?: {
    latitude?: number | null;
    longitude?: number | null;
  } | null;
};

export type EtaRouteEndpoint = {
  latitude?: number | null;
  longitude?: number | null;
};

export type TravelEtaResult = {
  slots: EtaSlot[];
  tomTomLegs: number;
  fallbackLegs: number;
  totalTravelMinutes: number;
  totalHandlingMinutes: number;
};

export type TravelOptimisationResult = {
  orderedStopIds: string[];
  tomTomLegs: number;
  fallbackLegs: number;
  totalTravelMinutes: number;
};

type RoutePoint = {
  latitude: number;
  longitude: number;
};

type TomTomRoutePayload = {
  routes?: Array<{
    summary?: {
      travelTimeInSeconds?: number;
      lengthInMeters?: number;
    };
  }>;
};

const ROUTE_TIME_ZONE = "Europe/London";
const FALLBACK_AVERAGE_ROAD_SPEED_KPH = 64;
const FALLBACK_ROAD_DISTANCE_FACTOR = 1.35;
const TOMTOM_OPTIMISATION_CANDIDATES = 8;

function parseTimeToMinutes(value: string) {
  const [hours, minutes = "0"] = value.split(":");
  const parsedHours = Number(hours);
  const parsedMinutes = Number(minutes);

  if (!Number.isFinite(parsedHours) || !Number.isFinite(parsedMinutes)) {
    return 5 * 60;
  }

  return parsedHours * 60 + parsedMinutes;
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function hasCoordinates(value: EtaRouteEndpoint | null | undefined): value is RoutePoint {
  return typeof value?.latitude === "number" &&
    typeof value?.longitude === "number" &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude);
}

function pointForStop(stop: EtaStopInput): RoutePoint | null {
  const point = {
    latitude: stop.deliveryGroup?.latitude,
    longitude: stop.deliveryGroup?.longitude,
  };

  return hasCoordinates(point) ? point : null;
}

function degreesToRadians(value: number) {
  return value * Math.PI / 180;
}

function distanceKm(from: RoutePoint, to: RoutePoint) {
  const earthRadiusKm = 6371;
  const latDifference = degreesToRadians(to.latitude - from.latitude);
  const lngDifference = degreesToRadians(to.longitude - from.longitude);
  const fromLat = degreesToRadians(from.latitude);
  const toLat = degreesToRadians(to.latitude);
  const a = Math.sin(latDifference / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(lngDifference / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fallbackTravelMinutes(from: RoutePoint | null, to: RoutePoint | null, defaultMinutes: number) {
  if (!from || !to) {
    return Math.max(10, defaultMinutes);
  }

  const estimatedRoadKm = distanceKm(from, to) * FALLBACK_ROAD_DISTANCE_FACTOR;
  return Math.max(5, Math.ceil((estimatedRoadKm / FALLBACK_AVERAGE_ROAD_SPEED_KPH) * 60));
}

function londonOffsetMinutes(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: ROUTE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values: Record<string, string> = {};

  for (const part of formatter.formatToParts(date)) {
    values[part.type] = part.value;
  }

  const localAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );

  return Math.round((localAsUtc - date.getTime()) / 60000);
}

function routeDateWithStartTime(routeDate: Date, startTime: string) {
  const startMinutes = parseTimeToMinutes(startTime);
  const hours = Math.floor(startMinutes / 60);
  const minutes = startMinutes % 60;
  const date = new Date(routeDate);
  const localClockTime = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hours,
    minutes,
    0,
    0,
  ));

  return addMinutes(localClockTime, -londonOffsetMinutes(localClockTime));
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

async function tomTomTravelMinutes(from: RoutePoint, to: RoutePoint, apiKey: string) {
  try {
    const response = await fetch(tomTomRouteUrl(from, to, apiKey));

    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as TomTomRoutePayload;
    const travelSeconds = payload.routes?.[0]?.summary?.travelTimeInSeconds;

    if (typeof travelSeconds !== "number" || !Number.isFinite(travelSeconds)) {
      return null;
    }

    return Math.max(1, Math.ceil(travelSeconds / 60));
  } catch {
    return null;
  }
}

async function calculateLeg(from: RoutePoint | null, to: RoutePoint | null, defaultMinutes: number, apiKey: string) {
  const tomTomMinutes = from && to && apiKey ? await tomTomTravelMinutes(from, to, apiKey) : null;

  return {
    travelMinutes: tomTomMinutes ?? fallbackTravelMinutes(from, to, defaultMinutes),
    usedTomTom: typeof tomTomMinutes === "number",
  };
}

export function formatEtaSlot(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: ROUTE_TIME_ZONE,
  });

  return `${formatter.format(start)} to ${formatter.format(end)}`;
}

export function buildEtaSlots(
  stops: Array<{ id: string; orderIndex: number }>,
  routeDate: Date,
  startTime = "05:00",
  stopMinutes = 10,
  slotMinutes = 60,
) {
  const routeStart = routeDateWithStartTime(routeDate, startTime);

  return [...stops]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((stop, index) => {
      const estimatedArrival = addMinutes(routeStart, index * stopMinutes);
      const slotStart = estimatedArrival;
      const slotEnd = addMinutes(slotStart, slotMinutes);

      return {
        stopId: stop.id,
        estimatedArrival,
        slotStart,
        slotEnd,
      };
    });
}

export async function buildTravelEtaSlots(
  stops: EtaStopInput[],
  routeDate: Date,
  startTime = "05:00",
  stopMinutes = 10,
  slotMinutes = 60,
  startPoint?: EtaRouteEndpoint | null,
): Promise<TravelEtaResult> {
  const credentials = await getAppCredentials();
  const apiKey = credentials.tomtomApiKey;
  const routeStart = routeDateWithStartTime(routeDate, startTime);
  const orderedStops = [...stops].sort((a, b) => a.orderIndex - b.orderIndex);
  const slots: EtaSlot[] = [];
  let etaClock = routeStart;
  let previousPoint = hasCoordinates(startPoint) ? startPoint : null;
  let tomTomLegs = 0;
  let fallbackLegs = 0;
  let totalTravelMinutes = 0;
  let totalHandlingMinutes = 0;

  for (const [index, stop] of orderedStops.entries()) {
    if (index > 0) {
      etaClock = addMinutes(etaClock, stopMinutes);
      totalHandlingMinutes += stopMinutes;
    }

    const nextPoint = pointForStop(stop);
    const leg = await calculateLeg(previousPoint, nextPoint, stopMinutes, apiKey);

    etaClock = addMinutes(etaClock, leg.travelMinutes);
    totalTravelMinutes += leg.travelMinutes;

    if (leg.usedTomTom) {
      tomTomLegs += 1;
    } else {
      fallbackLegs += 1;
    }

    slots.push({
      stopId: stop.id,
      estimatedArrival: etaClock,
      slotStart: etaClock,
      slotEnd: addMinutes(etaClock, slotMinutes),
    });

    if (nextPoint) {
      previousPoint = nextPoint;
    }
  }

  return {
    slots,
    tomTomLegs,
    fallbackLegs,
    totalTravelMinutes,
    totalHandlingMinutes,
  };
}

export async function optimiseStopOrderByTravelTime(
  stops: EtaStopInput[],
  startPoint?: EtaRouteEndpoint | null,
  finishPoint?: EtaRouteEndpoint | null,
  stopMinutes = 10,
): Promise<TravelOptimisationResult> {
  const credentials = await getAppCredentials();
  const apiKey = credentials.tomtomApiKey;
  const routeStart = hasCoordinates(startPoint) ? startPoint : null;
  const routeFinish = hasCoordinates(finishPoint) ? finishPoint : routeStart;
  const unvisited = [...stops]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((stop) => ({ stop, point: pointForStop(stop) }));
  const orderedStopIds: string[] = [];
  let currentPoint = routeStart;
  let tomTomLegs = 0;
  let fallbackLegs = 0;
  let totalTravelMinutes = 0;

  if (!currentPoint) {
    throw new Error("The route start needs latitude and longitude before TomTom can optimise the route.");
  }

  if (unvisited.some((entry) => !entry.point)) {
    throw new Error("Every stop needs latitude and longitude before TomTom can optimise the route.");
  }

  while (unvisited.length) {
    const candidates = [...unvisited]
      .sort((a, b) => distanceKm(currentPoint!, a.point!) - distanceKm(currentPoint!, b.point!))
      .slice(0, TOMTOM_OPTIMISATION_CANDIDATES);
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestTravelMinutes = 0;
    let bestUsedTomTom = false;

    for (const candidate of candidates) {
      const candidateIndex = unvisited.findIndex((entry) => entry.stop.id === candidate.stop.id);
      const leg = await calculateLeg(currentPoint, candidate.point, stopMinutes, apiKey);
      const finishBias = routeFinish ? distanceKm(candidate.point!, routeFinish) * 0.8 : 0;
      const score = leg.travelMinutes + finishBias;

      if (score < bestScore) {
        bestScore = score;
        bestIndex = candidateIndex;
        bestTravelMinutes = leg.travelMinutes;
        bestUsedTomTom = leg.usedTomTom;
      }
    }

    const [next] = unvisited.splice(bestIndex, 1);
    orderedStopIds.push(next.stop.id);
    currentPoint = next.point;
    totalTravelMinutes += bestTravelMinutes;

    if (bestUsedTomTom) {
      tomTomLegs += 1;
    } else {
      fallbackLegs += 1;
    }
  }

  if (currentPoint && routeFinish) {
    const finishLeg = await calculateLeg(currentPoint, routeFinish, stopMinutes, apiKey);
    totalTravelMinutes += finishLeg.travelMinutes;
    if (finishLeg.usedTomTom) {
      tomTomLegs += 1;
    } else {
      fallbackLegs += 1;
    }
  }

  return {
    orderedStopIds,
    tomTomLegs,
    fallbackLegs,
    totalTravelMinutes,
  };
}
