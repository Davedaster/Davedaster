import crypto from "node:crypto";

const MAX_PROOF_PHOTO_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing from the app environment.`);
  }

  return value;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function hashHex(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer | string, value: string) {
  return crypto.createHmac("sha256", key).update(value).digest("hex");
}

function getSigningKey(secretAccessKey: string, dateStamp: string, region: string) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function getFileExtension(file: File) {
  const nameExtension = file.name.split(".").pop()?.toLowerCase();

  if (nameExtension && /^[a-z0-9]+$/.test(nameExtension)) {
    return nameExtension;
  }

  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/heic") return "heic";
  if (file.type === "image/heif") return "heif";
  return "jpg";
}

function buildObjectKey(stopId: string, file: File) {
  const extension = getFileExtension(file);
  const safeStopId = stopId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `proof-of-delivery/${safeStopId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
}

export function isProofPhotoStorageEnabled() {
  return Boolean(
    process.env.PROOF_PHOTO_STORAGE_ENDPOINT &&
    process.env.PROOF_PHOTO_STORAGE_REGION &&
    process.env.PROOF_PHOTO_STORAGE_BUCKET &&
    process.env.PROOF_PHOTO_STORAGE_ACCESS_KEY_ID &&
    process.env.PROOF_PHOTO_STORAGE_SECRET_ACCESS_KEY &&
    process.env.PROOF_PHOTO_PUBLIC_BASE_URL,
  );
}

export async function uploadProofPhoto(file: File, stopId: string) {
  if (!file || file.size === 0) {
    throw new Error("Proof photo is required before marking delivered.");
  }

  if (file.size > MAX_PROOF_PHOTO_BYTES) {
    throw new Error("Proof photo must be smaller than 10MB.");
  }

  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    throw new Error("Proof photo must be a JPG, PNG, WebP or HEIC image.");
  }

  const endpoint = trimTrailingSlash(requireEnv("PROOF_PHOTO_STORAGE_ENDPOINT"));
  const region = requireEnv("PROOF_PHOTO_STORAGE_REGION");
  const bucket = requireEnv("PROOF_PHOTO_STORAGE_BUCKET");
  const accessKeyId = requireEnv("PROOF_PHOTO_STORAGE_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("PROOF_PHOTO_STORAGE_SECRET_ACCESS_KEY");
  const publicBaseUrl = trimTrailingSlash(requireEnv("PROOF_PHOTO_PUBLIC_BASE_URL"));

  const body = Buffer.from(await file.arrayBuffer());
  const payloadHash = hashHex(body);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const objectKey = buildObjectKey(stopId, file);
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`${endpoint}/${bucket}/${encodedKey}`);
  const host = url.host;
  const canonicalUri = url.pathname;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `content-type:${file.type}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
  ].join("\n");
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hashHex(canonicalRequest),
  ].join("\n");
  const signingKey = getSigningKey(secretAccessKey, dateStamp, region);
  const signature = hmacHex(signingKey, stringToSign);
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": file.type,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Proof photo upload failed with status ${response.status}. ${errorText}`.trim());
  }

  return `${publicBaseUrl}/${objectKey}`;
}
