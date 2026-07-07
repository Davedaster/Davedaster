import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { getAppCredentials } from "../lib/appCredentials.server";
import { buildTravelEtaSlots } from "../lib/etaSlots.server";
import { lookupAddress } from "../lib/getAddress.server";
import { listOpenReturnPlanningOrders } from "../lib/returns.server";
import { authenticate } from "../shopify.server";
import { getDeliveryOrders, toManualDeliveryOrder, type DeliveryOrder, type ManualDeliveryOrderInput } from "../lib/shopifyOrders.server";

type ManualPlanningOrder = ManualDeliveryOrderInput & {
  id: string;
};

type StopEtaPreview = {
  id: string;
  eta: string;
  arrivalMinutes: number;
};

type PlanningEtaPreviewResult = {
  ok: true;
  stopEtas: StopEtaPreview[];
  totalTravelMinutes: number;
  totalHandlingMinutes: number;
  totalRouteMinutes: number;
  finishTravelMinutes: number;
  routeFinishEta: string | null;
  tomTomLegs: number;
  fallbackLegs: number;
  returnToBase: boolean;
} | {
  ok: false;
  error: string;
};

type RoutePoint = {
  latitude: number;
  longitude: number;
};

type RoutePayload = {
  routes?: Array<{
    summary?: {
      travelTimeInSeconds?: number;
    };
  }>;
};

const ROUTE_TIME_ZONE = "Europe/London";
const FALLBACK_AVERAGE_ROAD_SPEED_KPH = 64;
const FALLBACK_ROAD_DISTANCE_FACTOR = 1.35;

const fallbackRoutePlanningSettings = {
  routeDate: new Date().toISOString().slice(0, 10),
  plannedStartTime: "05:00",
  timePerDropMinutes: 10,
  customerSlotMinutes: 60,
  startAddress: "Unit 1 Olympus Business Park, Kingsteignton Road, Newton Abbot, Devon, TQ12 2SN, United Kingdom",
  startLatitude: 50.5293,
  startLongitude: -3.6119,
};

function parseManualOrders(value: FormDataEntryValue | null): ManualPlanningOrder[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as ManualPlanningOrder[];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((order) => ({
        id: String(order.id || "").trim(),
        customerName: String(order.customerName || "").trim(),
        address: String(order.address || "").trim(),
        email: String(order.email || "").trim(),
        phone: String(order.phone || "").trim(),
        lineItemSummary: String(order.lineItemSummary || "").trim(),
      }))
      .filter((order) => order.id && order.customerName && order.address && order.lineItemSummary);
  } catch {
    return [];
  }
}

function extractPostcode(value: string) {
  const match = value.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);

  return match?.[0]?.toUpperCase() || "";
}

function formCoordinate(formData: FormData, name: string) {
  const rawValue = String(formData.get(name) || "").trim();

  if (!rawValue) {
    return null;
  }

  const value = Number(rawValue);

  return Number.isFinite(value) ? value : null;
}

function parseRouteDate(value: string) {
  const date = new Date(`${value || fallbackRoutePlanningSettings.routeDate}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? new Date(`${fallbackRoutePlanningSettings.routeDate}T00:00:00.000Z`) : date;
}

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

function formatEtaTime(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: ROUTE_TIME_ZONE,
  }).format(value);
}

function finiteNumber(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function hasCoordinates(value: { latitude?: number | null; longitude?: number | null } | null | undefined): value is RoutePoint {
  return typeof value?.latitude === "number" &&
    typeof value?.longitude === "number" &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude);
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

function routeApiUrl(from: RoutePoint, to: RoutePoint, apiKey: string) {
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

async function routeTravelMinutes(from: RoutePoint | null, to: RoutePoint | null, defaultMinutes: number) {
  if (!from || !to) {
    return {
      travelMinutes: fallbackTravelMinutes(from, to, defaultMinutes),
      usedTomTom: false,
    };
  }

  const credentials = await getAppCredentials();

  if (!credentials.tomtomApiKey) {
    return {
      travelMinutes: fallbackTravelMinutes(from, to, defaultMinutes),
      usedTomTom: false,
    };
  }

  try {
    const response = await fetch(routeApiUrl(from, to, credentials.tomtomApiKey));

    if (!response.ok) {
      return {
        travelMinutes: fallbackTravelMinutes(from, to, defaultMinutes),
        usedTomTom: false,
      };
    }

    const payload = await response.json() as RoutePayload;
    const travelSeconds = payload.routes?.[0]?.summary?.travelTimeInSeconds;

    if (typeof travelSeconds !== "number" || !Number.isFinite(travelSeconds)) {
      return {
        travelMinutes: fallbackTravelMinutes(from, to, defaultMinutes),
        usedTomTom: false,
      };
    }

    return {
      travelMinutes: Math.max(1, Math.ceil(travelSeconds / 60)),
      usedTomTom: true,
    };
  } catch {
    return {
      travelMinutes: fallbackTravelMinutes(from, to, defaultMinutes),
      usedTomTom: false,
    };
  }
}

async function resolvePlanningEndpoint(address: string | null | undefined, latitude?: number | null, longitude?: number | null) {
  const trimmedAddress = address?.trim() || fallbackRoutePlanningSettings.startAddress;

  if (typeof latitude === "number" && Number.isFinite(latitude) && typeof longitude === "number" && Number.isFinite(longitude)) {
    return {
      address: trimmedAddress,
      latitude,
      longitude,
    };
  }

  const lookup = await lookupAddress(extractPostcode(trimmedAddress), trimmedAddress);

  if (typeof lookup.latitude !== "number" || typeof lookup.longitude !== "number") {
    throw new Error(`Could not find coordinates for ${trimmedAddress}.`);
  }

  return {
    address: lookup.formattedAddress || trimmedAddress,
    latitude: lookup.latitude,
    longitude: lookup.longitude,
  };
}

async function listReturnPlanningOrdersSafely() {
  try {
    return await listOpenReturnPlanningOrders();
  } catch (error) {
    console.warn("Return planning orders could not be loaded", error);
    return [];
  }
}

async function getSelectedPlanningOrders(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  selectedOrderIds: string[],
  manualOrders: ManualPlanningOrder[],
) {
  const [shopifyOrders, returnPlanningOrders, manualDeliveryOrders] = await Promise.all([
    getDeliveryOrders(admin),
    listReturnPlanningOrdersSafely(),
    Promise.all(manualOrders.map((order) => toManualDeliveryOrder(order))),
  ]);
  const ordersById = new Map([...shopifyOrders, ...returnPlanningOrders, ...manualDeliveryOrders].map((order) => [order.id, order]));

  return selectedOrderIds
    .map((id) => ordersById.get(id))
    .filter((order): order is DeliveryOrder => Boolean(order));
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const selectedOrderIds = String(formData.get("selectedOrderIds") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!selectedOrderIds.length) {
    return json<PlanningEtaPreviewResult>({ ok: false, error: "Select at least one order before previewing route ETAs." }, { status: 400 });
  }

  try {
    const routeDate = parseRouteDate(String(formData.get("routeDate") || fallbackRoutePlanningSettings.routeDate).trim());
    const plannedStartTime = String(formData.get("plannedStartTime") || fallbackRoutePlanningSettings.plannedStartTime).trim();
    const timePerDropMinutes = finiteNumber(Number(formData.get("timePerDropMinutes") || fallbackRoutePlanningSettings.timePerDropMinutes), fallbackRoutePlanningSettings.timePerDropMinutes);
    const customerSlotMinutes = finiteNumber(Number(formData.get("customerSlotMinutes") || fallbackRoutePlanningSettings.customerSlotMinutes), fallbackRoutePlanningSettings.customerSlotMinutes);
    const startAddress = String(formData.get("startAddress") || fallbackRoutePlanningSettings.startAddress).trim();
    const finishAddress = String(formData.get("finishAddress") || startAddress).trim();
    const startLatitude = formCoordinate(formData, "startLatitude") ?? fallbackRoutePlanningSettings.startLatitude;
    const startLongitude = formCoordinate(formData, "startLongitude") ?? fallbackRoutePlanningSettings.startLongitude;
    const rawFinishLatitude = formCoordinate(formData, "finishLatitude");
    const rawFinishLongitude = formCoordinate(formData, "finishLongitude");
    const returnToBase = String(formData.get("returnToBase") || "") === "true";
    const manualOrders = parseManualOrders(formData.get("manualOrdersJson"));
    const selectedOrders = await getSelectedPlanningOrders(admin, selectedOrderIds, manualOrders);

    if (selectedOrders.length !== selectedOrderIds.length) {
      return json<PlanningEtaPreviewResult>({ ok: false, error: "Selected orders could not all be found for the ETA preview." }, { status: 400 });
    }

    const start = await resolvePlanningEndpoint(startAddress, startLatitude, startLongitude);
    const finish = returnToBase
      ? start
      : await resolvePlanningEndpoint(finishAddress || startAddress, rawFinishLatitude, rawFinishLongitude);
    const etaStops = selectedOrders.map((order, index) => ({
      id: order.id,
      orderIndex: index + 1,
      deliveryGroup: {
        latitude: order.latitude,
        longitude: order.longitude,
      },
    }));
    const etaResult = await buildTravelEtaSlots(
      etaStops,
      routeDate,
      plannedStartTime,
      timePerDropMinutes,
      customerSlotMinutes,
      start,
    );
    const routeStart = routeDateWithStartTime(routeDate, plannedStartTime);
    const stopEtas = etaResult.slots.map((slot) => ({
      id: slot.stopId,
      eta: formatEtaTime(slot.estimatedArrival),
      arrivalMinutes: Math.max(0, Math.round((slot.estimatedArrival.getTime() - routeStart.getTime()) / 60000)),
    }));
    const lastSelectedOrder = selectedOrders[selectedOrders.length - 1];
    const lastStopPoint = lastSelectedOrder && hasCoordinates({
      latitude: lastSelectedOrder.latitude,
      longitude: lastSelectedOrder.longitude,
    })
      ? {
        latitude: lastSelectedOrder.latitude,
        longitude: lastSelectedOrder.longitude,
      }
      : null;
    const finishLeg = await routeTravelMinutes(lastStopPoint, finish, timePerDropMinutes);
    const finalDropHandlingMinutes = selectedOrders.length ? timePerDropMinutes : 0;
    const totalHandlingMinutes = etaResult.totalHandlingMinutes + finalDropHandlingMinutes;
    const totalTravelMinutes = etaResult.totalTravelMinutes + finishLeg.travelMinutes;
    const totalRouteMinutes = totalTravelMinutes + totalHandlingMinutes;
    const routeFinishEta = addMinutes(routeStart, totalRouteMinutes);

    return json<PlanningEtaPreviewResult>({
      ok: true,
      stopEtas,
      totalTravelMinutes,
      totalHandlingMinutes,
      totalRouteMinutes,
      finishTravelMinutes: finishLeg.travelMinutes,
      routeFinishEta: formatEtaTime(routeFinishEta),
      tomTomLegs: etaResult.tomTomLegs + (finishLeg.usedTomTom ? 1 : 0),
      fallbackLegs: etaResult.fallbackLegs + (finishLeg.usedTomTom ? 0 : 1),
      returnToBase,
    });
  } catch (error) {
    return json<PlanningEtaPreviewResult>({ ok: false, error: error instanceof Error ? error.message : "Planning ETA preview failed." }, { status: 400 });
  }
};
