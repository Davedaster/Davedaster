import prisma from "../db.server";

const ETA_LEARNING_SETTING_KEY = "eta_learning_v1";

type LearningBucket = {
  samples: number;
  averageErrorMinutes: number;
  lastUpdated: string;
};

type EtaLearningData = {
  version: 1;
  global: LearningBucket;
  postcodeAreas: Record<string, LearningBucket>;
  drivers: Record<string, LearningBucket>;
};

type LearningStop = {
  estimatedArrival?: Date | null;
  actualArrival?: Date | null;
  deliveryGroup?: {
    postcode?: string | null;
  } | null;
  route?: {
    driverId?: string | null;
  } | null;
};

const EMPTY_BUCKET: LearningBucket = {
  samples: 0,
  averageErrorMinutes: 0,
  lastUpdated: new Date(0).toISOString(),
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function freshLearningData(): EtaLearningData {
  return {
    version: 1,
    global: { ...EMPTY_BUCKET },
    postcodeAreas: {},
    drivers: {},
  };
}

function parseLearningData(value?: string | null): EtaLearningData {
  if (!value) {
    return freshLearningData();
  }

  try {
    const parsed = JSON.parse(value) as EtaLearningData;

    if (parsed?.version !== 1) {
      return freshLearningData();
    }

    return {
      version: 1,
      global: parsed.global || { ...EMPTY_BUCKET },
      postcodeAreas: parsed.postcodeAreas || {},
      drivers: parsed.drivers || {},
    };
  } catch {
    return freshLearningData();
  }
}

function postcodeArea(postcode?: string | null) {
  const compact = (postcode || "").trim().toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^[A-Z]+/);

  return match?.[0] || null;
}

function updateBucket(bucket: LearningBucket | undefined, errorMinutes: number): LearningBucket {
  const current = bucket || { ...EMPTY_BUCKET };
  const samples = Math.min(250, current.samples + 1);
  const previousWeight = Math.min(current.samples, 39);
  const averageErrorMinutes = ((current.averageErrorMinutes * previousWeight) + errorMinutes) / (previousWeight + 1);

  return {
    samples,
    averageErrorMinutes: Number(averageErrorMinutes.toFixed(2)),
    lastUpdated: new Date().toISOString(),
  };
}

async function readLearningData() {
  const setting = await prisma.setting.findUnique({
    where: {
      key: ETA_LEARNING_SETTING_KEY,
    },
  });

  return parseLearningData(setting?.value);
}

async function writeLearningData(data: EtaLearningData) {
  await prisma.setting.upsert({
    where: {
      key: ETA_LEARNING_SETTING_KEY,
    },
    create: {
      key: ETA_LEARNING_SETTING_KEY,
      value: JSON.stringify(data),
    },
    update: {
      value: JSON.stringify(data),
    },
  });
}

export async function recordEtaLearningObservation(stop: LearningStop) {
  if (!stop.estimatedArrival || !stop.actualArrival) {
    return;
  }

  const rawErrorMinutes = Math.round((stop.actualArrival.getTime() - stop.estimatedArrival.getTime()) / 60000);

  if (!Number.isFinite(rawErrorMinutes) || rawErrorMinutes < -60 || rawErrorMinutes > 180) {
    return;
  }

  const errorMinutes = clamp(rawErrorMinutes, -30, 90);
  const data = await readLearningData();
  const area = postcodeArea(stop.deliveryGroup?.postcode);
  const driverId = stop.route?.driverId;

  data.global = updateBucket(data.global, errorMinutes);

  if (area) {
    data.postcodeAreas[area] = updateBucket(data.postcodeAreas[area], errorMinutes);
  }

  if (driverId) {
    data.drivers[driverId] = updateBucket(data.drivers[driverId], errorMinutes);
  }

  await writeLearningData(data);
}

function bucketAdjustment(bucket?: LearningBucket, minimumSamples = 4) {
  if (!bucket || bucket.samples < minimumSamples) {
    return 0;
  }

  const confidence = clamp(bucket.samples / 30, 0.2, 1);

  return bucket.averageErrorMinutes * confidence;
}

export async function getEtaLearningAdjustmentMinutes(input: {
  postcode?: string | null;
  driverId?: string | null;
}) {
  const data = await readLearningData();
  const area = postcodeArea(input.postcode);
  const globalAdjustment = bucketAdjustment(data.global, 8) * 0.4;
  const areaAdjustment = area ? bucketAdjustment(data.postcodeAreas[area], 4) * 0.4 : 0;
  const driverAdjustment = input.driverId ? bucketAdjustment(data.drivers[input.driverId], 4) * 0.2 : 0;
  const combinedAdjustment = globalAdjustment + areaAdjustment + driverAdjustment;

  return Math.round(clamp(combinedAdjustment, -10, 20));
}
