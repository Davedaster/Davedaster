import prisma from "../db.server";
import { defaultDepotAddress, formatStructuredAddress, normaliseStructuredAddress, type ResolvedStructuredAddress, type StructuredAddress } from "./addressFields";
import { lookupAddress } from "./getAddress.server";
import { defaultRoutePlanningSettings } from "./routeDrafts.server";

export type RouteSettings = {
  plannedStartTime: string;
  timePerDropMinutes: number;
  customerSlotMinutes: number;
  startAddress: string;
  startStructuredAddress: StructuredAddress;
  startLatitude: number | null;
  startLongitude: number | null;
  finishAddress: string;
  finishLatitude: number | null;
  finishLongitude: number | null;
  returnToBaseDefault: boolean;
};

const ROUTE_SETTINGS_KEY = "route_planning_defaults";

const fallbackRouteSettings: RouteSettings = {
  plannedStartTime: defaultRoutePlanningSettings.plannedStartTime,
  timePerDropMinutes: defaultRoutePlanningSettings.timePerDropMinutes,
  customerSlotMinutes: defaultRoutePlanningSettings.customerSlotMinutes,
  startAddress: defaultDepotAddress.formattedAddress,
  startStructuredAddress: defaultDepotAddress,
  startLatitude: defaultDepotAddress.latitude,
  startLongitude: defaultDepotAddress.longitude,
  finishAddress: defaultDepotAddress.formattedAddress,
  finishLatitude: defaultDepotAddress.latitude,
  finishLongitude: defaultDepotAddress.longitude,
  returnToBaseDefault: true,
};

function normaliseTime(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : fallback;
}

function normalisePositiveNumber(value: unknown, fallback: number) {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(1, Math.round(numericValue));
}

function normaliseAddress(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normaliseBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value === "true";
  }

  return fallback;
}

function normaliseCoordinate(value: unknown, fallback: number | null) {
  if (value === null || typeof value === "undefined") {
    return fallback;
  }

  if (typeof value === "string" && !value.trim()) {
    return fallback;
  }

  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return numericValue;
}

function normaliseRouteSettings(value: Partial<RouteSettings> | null | undefined): RouteSettings {
  const startStructuredAddress = normaliseStructuredAddress(value?.startStructuredAddress, fallbackRouteSettings.startStructuredAddress);
  const startAddress = normaliseAddress(value?.startAddress, formatStructuredAddress(startStructuredAddress) || fallbackRouteSettings.startAddress);
  const finishAddress = normaliseAddress(value?.finishAddress, startAddress || fallbackRouteSettings.finishAddress);

  return {
    plannedStartTime: normaliseTime(value?.plannedStartTime, fallbackRouteSettings.plannedStartTime),
    timePerDropMinutes: normalisePositiveNumber(value?.timePerDropMinutes, fallbackRouteSettings.timePerDropMinutes),
    customerSlotMinutes: normalisePositiveNumber(value?.customerSlotMinutes, fallbackRouteSettings.customerSlotMinutes),
    startAddress,
    startStructuredAddress,
    startLatitude: normaliseCoordinate(value?.startLatitude, fallbackRouteSettings.startLatitude),
    startLongitude: normaliseCoordinate(value?.startLongitude, fallbackRouteSettings.startLongitude),
    finishAddress,
    finishLatitude: normaliseCoordinate(value?.finishLatitude, fallbackRouteSettings.finishLatitude),
    finishLongitude: normaliseCoordinate(value?.finishLongitude, fallbackRouteSettings.finishLongitude),
    returnToBaseDefault: normaliseBoolean(value?.returnToBaseDefault, fallbackRouteSettings.returnToBaseDefault),
  };
}

async function resolveStructuredAddress(input: StructuredAddress, fallback: ResolvedStructuredAddress): Promise<ResolvedStructuredAddress> {
  const structuredAddress = normaliseStructuredAddress(input, fallback);
  const formattedAddress = formatStructuredAddress(structuredAddress) || fallback.formattedAddress;

  if (formattedAddress.toLowerCase() === fallback.formattedAddress.toLowerCase()) {
    return {
      ...structuredAddress,
      formattedAddress: fallback.formattedAddress,
      latitude: fallback.latitude,
      longitude: fallback.longitude,
    };
  }

  const lookup = await lookupAddress(structuredAddress.postcode, formattedAddress);

  return {
    ...structuredAddress,
    formattedAddress: lookup.formattedAddress || formattedAddress,
    latitude: lookup.latitude,
    longitude: lookup.longitude,
  };
}

export async function getRouteSettings(): Promise<RouteSettings> {
  const record = await prisma.setting.findUnique({
    where: {
      key: ROUTE_SETTINGS_KEY,
    },
  });

  if (!record) {
    return fallbackRouteSettings;
  }

  try {
    return normaliseRouteSettings(JSON.parse(record.value) as Partial<RouteSettings>);
  } catch {
    return fallbackRouteSettings;
  }
}

export async function saveRouteSettings(input: Partial<RouteSettings>) {
  const currentSettings = await getRouteSettings();
  const suppliedStart = input.startStructuredAddress
    ? await resolveStructuredAddress(input.startStructuredAddress, defaultDepotAddress)
    : null;
  const settings = normaliseRouteSettings({
    ...currentSettings,
    ...input,
    ...(suppliedStart ? {
      startStructuredAddress: suppliedStart,
      startAddress: suppliedStart.formattedAddress,
      startLatitude: suppliedStart.latitude,
      startLongitude: suppliedStart.longitude,
      finishAddress: input.returnToBaseDefault === false ? input.finishAddress : suppliedStart.formattedAddress,
      finishLatitude: input.returnToBaseDefault === false ? input.finishLatitude : suppliedStart.latitude,
      finishLongitude: input.returnToBaseDefault === false ? input.finishLongitude : suppliedStart.longitude,
    } : {}),
  });

  await prisma.setting.upsert({
    where: {
      key: ROUTE_SETTINGS_KEY,
    },
    create: {
      key: ROUTE_SETTINGS_KEY,
      value: JSON.stringify(settings),
    },
    update: {
      value: JSON.stringify(settings),
    },
  });

  return settings;
}

export async function getRoutePlanningDefaults() {
  const routeSettings = await getRouteSettings();

  return {
    ...defaultRoutePlanningSettings,
    plannedStartTime: routeSettings.plannedStartTime,
    timePerDropMinutes: routeSettings.timePerDropMinutes,
    customerSlotMinutes: routeSettings.customerSlotMinutes,
    startAddress: routeSettings.startAddress,
    startStructuredAddress: routeSettings.startStructuredAddress,
    startLatitude: routeSettings.startLatitude,
    startLongitude: routeSettings.startLongitude,
    finishAddress: routeSettings.finishAddress,
    finishLatitude: routeSettings.finishLatitude,
    finishLongitude: routeSettings.finishLongitude,
    returnToBaseDefault: routeSettings.returnToBaseDefault,
  };
}
