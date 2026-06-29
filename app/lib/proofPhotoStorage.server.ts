import crypto from "node:crypto";

import { getAppCredentials, hasProofPhotoStorageCredentials } from "./appCredentials.server";

const MAX_PROOF_PHOTO_BYTES = 10 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

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

function getFileExtension(file: File) {
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

export async function isProofPhotoStorageEnabled() {
  const credentials = await getAppCredentials();

  return hasProofPhotoStorageCredentials(credentials);
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

  const credentials = await getAppCredentials();
  const endpoint = trimTrailingSlash(requireCredential(credentials.proofPhotoStorageEndpoint, "Proof photo storage endpoint"));
  const region = requireCredential(credentials.proofPhotoStorageRegion, "Proof photo storage region");
  const bucket = requireCredential(credentials.proofPhotoStorageBucket, "Proof photo storage bucket");
  const accessKeyId = requireCredential(credentials.proofPhotoStorageAccessKeyId, "Proof photo storage access key ID");
  const secretAccessKey = requireCredential(credentials.proofPhotoStorageSecretAccessKey, "Proof photo storage secret access key");
  const publicBaseUrl = trimTrailingSlash(requireCredential(credentials.proofPhotoPublicBaseUrl, "Proof photo public base URL"));

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
