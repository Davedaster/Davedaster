import crypto from "node:crypto";

import { getAppCredentials, hasProofPhotoStorageCredentials } from "./appCredentials.server";

const MAX_PROOF_PHOTO_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

type ProofImageKind = "image" | "signature";

type ProofImageUploadOptions = {
  stopId: string;
  orderNumber?: string | null;
  customerName?: string | null;
  kind?: ProofImageKind;
  index?: number;
};

function requireCredential(value: string, name: string) {
  if (!value) {
    throw new Error(`${name} is missing from Settings, API Credentials.`);
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

function cleanNamePart(value?: string | null) {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function cleanOrderNumber(value?: string | null) {
  return cleanNamePart(value?.replace(/^#/, "")) || "order";
}

function getFileExtensionFromType(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/heic") return "heic";
  if (contentType === "image/heif") return "heif";
  return "jpg";
}

function buildObjectKey(options: ProofImageUploadOptions, contentType: string) {
  const extension = getFileExtensionFromType(contentType);
  const safeStopId = options.stopId.replace(/[^a-zA-Z0-9_-]/g, "") || "stop";
  const orderNumber = cleanOrderNumber(options.orderNumber);
  const customerName = cleanNamePart(options.customerName) || "customer";
  const kind = options.kind === "signature" ? "signature" : "image";
  const indexSuffix = kind === "image" ? `-${Math.max(1, options.index || 1)}` : "";

  return `proof-of-delivery/${safeStopId}/${orderNumber}-${customerName}-${kind}${indexSuffix}-${Date.now()}-${crypto.randomUUID()}.${extension}`;
}

function getStorageCredentials() {
  return getAppCredentials().then((credentials) => ({
    endpoint: trimTrailingSlash(requireCredential(credentials.proofPhotoStorageEndpoint, "Proof photo storage endpoint")),
    region: requireCredential(credentials.proofPhotoStorageRegion, "Proof photo storage region"),
    bucket: requireCredential(credentials.proofPhotoStorageBucket, "Proof photo storage bucket"),
    accessKeyId: requireCredential(credentials.proofPhotoStorageAccessKeyId, "Proof photo storage access key ID"),
    secretAccessKey: requireCredential(credentials.proofPhotoStorageSecretAccessKey, "Proof photo storage secret access key"),
  }));
}

export async function isProofPhotoStorageEnabled() {
  const credentials = await getAppCredentials();

  return hasProofPhotoStorageCredentials(credentials);
}

export function isPrivateProofPhotoKey(value: string) {
  return value.startsWith("proof-of-delivery/");
}

function buildR2Url(endpoint: string, bucket: string, objectKey: string) {
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
  return new URL(`${endpoint}/${bucket}/${encodedKey}`);
}

async function putProofImage(body: Buffer, contentType: string, objectKey: string) {
  const credentials = await getStorageCredentials();
  const payloadHash = hashHex(body);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const url = buildR2Url(credentials.endpoint, credentials.bucket, objectKey);
  const host = url.host;
  const canonicalUri = url.pathname;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `content-type:${contentType}`,
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
  const credentialScope = `${dateStamp}/${credentials.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hashHex(canonicalRequest),
  ].join("\n");
  const signingKey = getSigningKey(credentials.secretAccessKey, dateStamp, credentials.region);
  const signature = hmacHex(signingKey, stringToSign);
  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Proof image upload failed with status ${response.status}. ${errorText}`.trim());
  }

  return objectKey;
}

export async function uploadProofPhoto(file: File, stopId: string, options: Omit<ProofImageUploadOptions, "stopId" | "kind"> = {}) {
  if (!file || file.size === 0) {
    throw new Error("Proof photo is required before marking delivered.");
  }

  if (file.size > MAX_PROOF_PHOTO_BYTES) {
    throw new Error("Proof photo must be smaller than 10MB.");
  }

  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    throw new Error("Proof photo must be a JPG, PNG, WebP or HEIC image.");
  }

  const body = Buffer.from(await file.arrayBuffer());
  const objectKey = buildObjectKey({ ...options, stopId, kind: "image" }, file.type);

  return putProofImage(body, file.type, objectKey);
}

export async function uploadProofImageDataUrl(dataUrl: string, options: ProofImageUploadOptions) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (!match) {
    throw new Error("Signature image could not be saved.");
  }

  const contentType = match[1];

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error("Signature image must be a JPG, PNG, WebP or HEIC image.");
  }

  const body = Buffer.from(match[2], "base64");

  if (body.length > MAX_PROOF_PHOTO_BYTES) {
    throw new Error("Signature image must be smaller than 10MB.");
  }

  const objectKey = buildObjectKey(options, contentType);

  return putProofImage(body, contentType, objectKey);
}

export async function createSignedProofPhotoUrl(value?: string | null, expiresInSeconds = SIGNED_URL_SECONDS) {
  const objectKey = (value || "").trim();

  if (!objectKey || !isPrivateProofPhotoKey(objectKey)) {
    return objectKey;
  }

  const credentials = await getStorageCredentials();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const url = buildR2Url(credentials.endpoint, credentials.bucket, objectKey);
  const host = url.host;
  const credentialScope = `${dateStamp}/${credentials.region}/s3/aws4_request`;
  const signedHeaders = "host";

  url.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  url.searchParams.set("X-Amz-Credential", `${credentials.accessKeyId}/${credentialScope}`);
  url.searchParams.set("X-Amz-Date", amzDate);
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  url.searchParams.set("X-Amz-SignedHeaders", signedHeaders);

  const canonicalQueryString = Array.from(url.searchParams.entries())
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join("&");
  const canonicalRequest = [
    "GET",
    url.pathname,
    canonicalQueryString,
    `host:${host}\n`,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hashHex(canonicalRequest),
  ].join("\n");
  const signingKey = getSigningKey(credentials.secretAccessKey, dateStamp, credentials.region);
  const signature = hmacHex(signingKey, stringToSign);

  url.searchParams.set("X-Amz-Signature", signature);

  return url.toString();
}

export async function createSignedProofPhotoUrls<T extends { url: string }>(photos: T[]) {
  return Promise.all(photos.map(async (photo) => ({
    ...photo,
    url: await createSignedProofPhotoUrl(photo.url),
  })));
}
