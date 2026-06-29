import prisma from "../db.server";

export type AppCredentials = {
  routexlUsername: string;
  routexlPassword: string;
  tomtomApiKey: string;
  getAddressApiKey: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
  resendApiKey: string;
  resendFromEmail: string;
  proofPhotoStorageEndpoint: string;
  proofPhotoStorageRegion: string;
  proofPhotoStorageBucket: string;
  proofPhotoStorageAccessKeyId: string;
  proofPhotoStorageSecretAccessKey: string;
  proofPhotoPublicBaseUrl: string;
  shopPublicUrl: string;
};

export type AppCredentialKey = keyof AppCredentials;

const APP_CREDENTIALS_KEY = "api_credentials";

const emptyCredentials: AppCredentials = {
  routexlUsername: "",
  routexlPassword: "",
  tomtomApiKey: "",
  getAddressApiKey: "",
  twilioAccountSid: "",
  twilioAuthToken: "",
  twilioFromNumber: "",
  resendApiKey: "",
  resendFromEmail: "",
  proofPhotoStorageEndpoint: "",
  proofPhotoStorageRegion: "",
  proofPhotoStorageBucket: "",
  proofPhotoStorageAccessKeyId: "",
  proofPhotoStorageSecretAccessKey: "",
  proofPhotoPublicBaseUrl: "",
  shopPublicUrl: "",
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normaliseCredentials(value: Partial<AppCredentials> | null | undefined): AppCredentials {
  return {
    routexlUsername: clean(value?.routexlUsername),
    routexlPassword: clean(value?.routexlPassword),
    tomtomApiKey: clean(value?.tomtomApiKey),
    getAddressApiKey: clean(value?.getAddressApiKey),
    twilioAccountSid: clean(value?.twilioAccountSid),
    twilioAuthToken: clean(value?.twilioAuthToken),
    twilioFromNumber: clean(value?.twilioFromNumber),
    resendApiKey: clean(value?.resendApiKey),
    resendFromEmail: clean(value?.resendFromEmail),
    proofPhotoStorageEndpoint: clean(value?.proofPhotoStorageEndpoint),
    proofPhotoStorageRegion: clean(value?.proofPhotoStorageRegion),
    proofPhotoStorageBucket: clean(value?.proofPhotoStorageBucket),
    proofPhotoStorageAccessKeyId: clean(value?.proofPhotoStorageAccessKeyId),
    proofPhotoStorageSecretAccessKey: clean(value?.proofPhotoStorageSecretAccessKey),
    proofPhotoPublicBaseUrl: clean(value?.proofPhotoPublicBaseUrl),
    shopPublicUrl: clean(value?.shopPublicUrl),
  };
}

function envCredentials(): AppCredentials {
  return {
    routexlUsername: process.env.ROUTEXL_USERNAME || "",
    routexlPassword: process.env.ROUTEXL_PASSWORD || "",
    tomtomApiKey: process.env.TOMTOM_API_KEY || "",
    getAddressApiKey: process.env.GETADDRESS_API_KEY || "",
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
    twilioFromNumber: process.env.TWILIO_FROM_NUMBER || "",
    resendApiKey: process.env.RESEND_API_KEY || "",
    resendFromEmail: process.env.RESEND_FROM_EMAIL || "",
    proofPhotoStorageEndpoint: process.env.PROOF_PHOTO_STORAGE_ENDPOINT || "",
    proofPhotoStorageRegion: process.env.PROOF_PHOTO_STORAGE_REGION || "",
    proofPhotoStorageBucket: process.env.PROOF_PHOTO_STORAGE_BUCKET || "",
    proofPhotoStorageAccessKeyId: process.env.PROOF_PHOTO_STORAGE_ACCESS_KEY_ID || "",
    proofPhotoStorageSecretAccessKey: process.env.PROOF_PHOTO_STORAGE_SECRET_ACCESS_KEY || "",
    proofPhotoPublicBaseUrl: process.env.PROOF_PHOTO_PUBLIC_BASE_URL || "",
    shopPublicUrl: process.env.SHOP_PUBLIC_URL || "",
  };
}

async function readStoredCredentials(): Promise<AppCredentials> {
  const record = await prisma.setting.findUnique({
    where: {
      key: APP_CREDENTIALS_KEY,
    },
  });

  if (!record) {
    return emptyCredentials;
  }

  try {
    return normaliseCredentials(JSON.parse(record.value) as Partial<AppCredentials>);
  } catch {
    return emptyCredentials;
  }
}

export async function getStoredAppCredentials() {
  return readStoredCredentials();
}

export async function getAppCredentials() {
  const stored = await readStoredCredentials();
  const fallback = envCredentials();
  const merged = { ...fallback };

  for (const key of Object.keys(stored) as AppCredentialKey[]) {
    merged[key] = stored[key] || fallback[key] || "";
  }

  return merged;
}

export async function saveAppCredentialsPatch(input: Partial<AppCredentials>) {
  const current = await readStoredCredentials();
  const next = normaliseCredentials({
    ...current,
    ...input,
  });

  await prisma.setting.upsert({
    where: {
      key: APP_CREDENTIALS_KEY,
    },
    create: {
      key: APP_CREDENTIALS_KEY,
      value: JSON.stringify(next),
    },
    update: {
      value: JSON.stringify(next),
    },
  });

  return next;
}

export function hasRouteXLCredentials(credentials: AppCredentials) {
  return Boolean(credentials.routexlUsername && credentials.routexlPassword);
}

export function hasTomTomCredentials(credentials: AppCredentials) {
  return Boolean(credentials.tomtomApiKey);
}

export function hasGetAddressCredentials(credentials: AppCredentials) {
  return Boolean(credentials.getAddressApiKey);
}

export function hasTwilioCredentials(credentials: AppCredentials) {
  return Boolean(credentials.twilioAccountSid && credentials.twilioAuthToken && credentials.twilioFromNumber);
}

export function hasResendCredentials(credentials: AppCredentials) {
  return Boolean(credentials.resendApiKey && credentials.resendFromEmail);
}

export function hasProofPhotoStorageCredentials(credentials: AppCredentials) {
  return Boolean(
    credentials.proofPhotoStorageEndpoint &&
    credentials.proofPhotoStorageRegion &&
    credentials.proofPhotoStorageBucket &&
    credentials.proofPhotoStorageAccessKeyId &&
    credentials.proofPhotoStorageSecretAccessKey &&
    credentials.proofPhotoPublicBaseUrl,
  );
}
