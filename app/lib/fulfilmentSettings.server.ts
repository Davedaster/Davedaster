import prisma from "../db.server";

export type RoutePublishFulfilmentMode = "on_publish" | "on_delivery_complete";

export type FulfilmentSettings = {
  routePublishFulfilmentMode: RoutePublishFulfilmentMode;
};

const SETTINGS_KEY = "fulfilment_settings";

export const defaultFulfilmentSettings: FulfilmentSettings = {
  routePublishFulfilmentMode: "on_delivery_complete",
};

function normaliseMode(value: unknown): RoutePublishFulfilmentMode {
  return value === "on_publish" ? "on_publish" : "on_delivery_complete";
}

function normaliseSettings(value: Partial<FulfilmentSettings> | null | undefined): FulfilmentSettings {
  return {
    routePublishFulfilmentMode: normaliseMode(value?.routePublishFulfilmentMode),
  };
}

export async function getFulfilmentSettings() {
  const record = await prisma.setting.findUnique({
    where: {
      key: SETTINGS_KEY,
    },
  });

  if (!record) {
    return defaultFulfilmentSettings;
  }

  try {
    return normaliseSettings(JSON.parse(record.value) as Partial<FulfilmentSettings>);
  } catch {
    return defaultFulfilmentSettings;
  }
}

export async function saveFulfilmentSettings(input: Partial<FulfilmentSettings>) {
  const current = await getFulfilmentSettings();
  const next = normaliseSettings({
    ...current,
    ...input,
  });

  await prisma.setting.upsert({
    where: {
      key: SETTINGS_KEY,
    },
    create: {
      key: SETTINGS_KEY,
      value: JSON.stringify(next),
    },
    update: {
      value: JSON.stringify(next),
    },
  });

  return next;
}
