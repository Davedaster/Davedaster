import crypto from "node:crypto";

import type { ActionFunctionArgs } from "@remix-run/node";

import prisma from "../db.server";
import { getAppCredentials } from "../lib/appCredentials.server";
import { getPublicAppBaseUrl } from "../lib/customerTracking.server";

const STATUS_RANK: Record<string, number> = {
  CREATED: 0,
  SUBMITTED: 1,
  ACCEPTED: 1,
  QUEUED: 2,
  SENDING: 3,
  SENT: 4,
  DELIVERED: 5,
  UNDELIVERED: 6,
  FAILED: 6,
  CANCELED: 6,
};

function compareText(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stringEntries(formData: FormData) {
  return [...formData.entries()]
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey === rightKey ? compareText(leftValue, rightValue) : compareText(leftKey, rightKey)
    ));
}

function expectedTwilioSignature(url: string, formData: FormData, authToken: string) {
  const signedValue = stringEntries(formData).reduce(
    (value, [key, entryValue]) => `${value}${key}${entryValue}`,
    url,
  );

  return crypto.createHmac("sha1", authToken).update(signedValue).digest("base64");
}

function signaturesMatch(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function callbackUrl(request: Request, publicBaseUrl: string) {
  const requestUrl = new URL(request.url);
  return new URL(`${requestUrl.pathname}${requestUrl.search}`, `${publicBaseUrl}/`).toString();
}

function cleanStatus(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function cleanString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function parseNumSegments(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function errorDescription(errorCode: string) {
  if (errorCode === "30007") {
    return "Message filtered by Twilio or the recipient mobile network.";
  }

  if (errorCode === "21610") {
    return "Recipient has opted out of messages from this sender.";
  }

  return errorCode ? `Twilio delivery error ${errorCode}.` : null;
}

function shouldApplyStatus(currentStatus: string, nextStatus: string) {
  const nextRank = STATUS_RANK[nextStatus];

  if (nextRank === undefined) {
    return false;
  }

  const currentRank = STATUS_RANK[currentStatus] ?? 0;
  return nextRank >= currentRank;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const credentials = await getAppCredentials();
  const receivedSignature = request.headers.get("x-twilio-signature") || "";

  if (!credentials.twilioAuthToken || !receivedSignature) {
    return new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const publicBaseUrl = getPublicAppBaseUrl(credentials.shopPublicUrl);
  const expectedSignature = expectedTwilioSignature(callbackUrl(request, publicBaseUrl), formData, credentials.twilioAuthToken);

  if (!signaturesMatch(expectedSignature, receivedSignature)) {
    return new Response("Forbidden", { status: 403 });
  }

  const accountSid = cleanString(formData.get("AccountSid"));

  if (accountSid && credentials.twilioAccountSid && accountSid !== credentials.twilioAccountSid) {
    return new Response("Forbidden", { status: 403 });
  }

  const twilioSid = cleanString(formData.get("MessageSid")) || cleanString(formData.get("SmsSid"));
  const nextStatus = cleanStatus(formData.get("MessageStatus")) || cleanStatus(formData.get("SmsStatus"));

  if (!twilioSid || !nextStatus) {
    return new Response(null, { status: 200 });
  }

  const deliveryId = new URL(request.url).searchParams.get("deliveryId") || "";
  const existing = deliveryId
    ? await prisma.smsDelivery.findUnique({ where: { id: deliveryId } })
    : await prisma.smsDelivery.findUnique({ where: { twilioSid } });

  if (!existing || !shouldApplyStatus(existing.status, nextStatus)) {
    return new Response(null, { status: 200 });
  }

  const errorCode = cleanString(formData.get("ErrorCode"));
  const numSegments = parseNumSegments(cleanString(formData.get("NumSegments")));

  await prisma.smsDelivery.update({
    where: {
      id: existing.id,
    },
    data: {
      twilioSid,
      status: nextStatus,
      errorCode: errorCode || null,
      errorMessage: errorDescription(errorCode),
      numSegments: numSegments ?? existing.numSegments,
      submittedAt: existing.submittedAt || new Date(),
      deliveredAt: nextStatus === "DELIVERED" ? new Date() : existing.deliveredAt,
    },
  });

  return new Response(null, { status: 200 });
};

export const loader = async () => new Response("Method not allowed", { status: 405 });
