import prisma from "../db.server";
import { defaultRoutePlanningSettings } from "./routeDrafts.server";

export type RouteSettings = {
  plannedStartTime: string;
  timePerDropMinutes: number;
  customerSlotMinutes: number;
  startAddress: string;
  finishAddress: string;
  returnToBaseDefault: boolean;
};

const ROUTE_SETTINGS_KEY = "route_planning_defaults";

const fallbackRouteSettings: RouteSettings = {
  plannedStartTime: defaultRoutePlanningSettings.plannedStartTime,
  timePerDropMinutes: defaultRoutePlanningSettings.timePerDropMinutes,
  customerSlotMinutes: defaultRoutePlanningSettings.customerSlotMinutes,
  startAddress: defaultRoutePlanningSettings.startAddress,
  finishAddress: defaultRoutePlanningSettings.finishAddress,
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

function normaliseRouteSettings(value: Partial<RouteSettings> | null | undefined): RouteSettings {
  return {
    plannedStartTime: normaliseTime(value?.plannedStartTime, fallbackRouteSettings.plannedStartTime),
    timePerDropMinutes: normalisePositiveNumber(value?.timePerDropMinutes, fallbackRouteSettings.timePerDropMinutes),
    customerSlotMinutes: normalisePositiveNumber(value?.customerSlotMinutes, fallbackRouteSettings.customerSlotMinutes),
    startAddress: normaliseAddress(value?.startAddress, fallbackRouteSettings.startAddress),
    finishAddress: normaliseAddress(value?.finishAddress, fallbackRouteSettings.finishAddress),
    returnToBaseDefault: normaliseBoolean(value?.returnToBaseDefault, fallbackRouteSettings.returnToBaseDefault),
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
  const settings = normaliseRouteSettings(input);

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
    finishAddress: routeSettings.finishAddress,
    returnToBaseDefault: routeSettings.returnToBaseDefault,
  };
}
