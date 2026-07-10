import crypto from "node:crypto";

import prisma from "../db.server";
import { getAppCredentials, hasResendCredentials, hasTwilioCredentials } from "./appCredentials.server";
import { getPublicAppBaseUrl } from "./customerTracking.server";
import { getEmailNotificationsEnabled } from "./notificationSettings.server";
import type { NotificationMessage } from "./notificationTemplates.server";

type SendSmsInput = {
  to: string;
  message: NotificationMessage;
  includeHelpText?: boolean;
};

type SendEmailInput = {
  to: string;
  message: NotificationMessage;
};

type SendResult = {
  ok: boolean;
  provider: "twilio" | "resend";
  id?: string;
};

type TwilioResponse = {
  sid?: string;
  status?: string;
  message?: string;
  code?: string | number;
  error_code?: string | number | null;
  num_segments?: string | number | null;
};

type ResendResponse = {
  id?: string;
  message?: string;
  error?: string;
};

const SMS_BRAND_NAME = "Bathroom Panels Direct";
const SMS_HELP_TEXT = "Need help? Call 01803 222784";
const SMS_OPT_OUT_TEXT = "Reply STOP to unsubscribe.";
const PROVIDER_TIMEOUT_MS = 15000;
const SMS_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const SMS_BODY_PREVIEW_LENGTH = 240;
const SMS_STATUS_RANK: Record<string, number> = {
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

class DuplicateSmsError extends Error {}

function requireCredential(value: string, name: string) {
  if (!value) {
    throw new Error(`${name} is missing from Settings, API Credentials.`);
  }

  return value;
}

function removeUkTrunkZero(digits: string) {
  return digits.startsWith("440") ? `44${digits.slice(3)}` : digits;
}

function normaliseSmsNumber(value: string) {
  const trimmed = (value || "").trim();

  if (!trimmed) {
    return "";
  }

  const compact = trimmed.replace(/[^\d+]/g, "");

  if (compact.startsWith("+")) {
    return `+${removeUkTrunkZero(compact.slice(1).replace(/\D/g, ""))}`;
  }

  const digits = compact.replace(/\D/g, "");

  if (digits.startsWith("00")) {
    return `+${removeUkTrunkZero(digits.slice(2))}`;
  }

  if (digits.startsWith("44")) {
    return `+${removeUkTrunkZero(digits)}`;
  }

  if (digits.startsWith("0")) {
    return `+44${digits.slice(1)}`;
  }

  return digits;
}

function requireValidSmsNumber(value: string) {
  const normalised = normaliseSmsNumber(value);

  if (!normalised) {
    throw new Error("Customer phone number is missing.");
  }

  if (!/^\+[1-9]\d{7,14}$/.test(normalised)) {
    throw new Error("Customer phone number must be a valid international number, for example +447123456789.");
  }

  return normalised;
}

function buildTwilioAuthHeader(accountSid: string, authToken: string) {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

function withSmsHelpText(messageBody: string) {
  let compliantBody = (messageBody || "").trim();

  if (!compliantBody) {
    compliantBody = `${SMS_BRAND_NAME}: Delivery update.`;
  }

  if (!compliantBody.toLowerCase().includes(SMS_BRAND_NAME.toLowerCase())) {
    compliantBody = `${SMS_BRAND_NAME}: ${compliantBody}`;
  }

  if (!compliantBody.toLowerCase().includes(SMS_HELP_TEXT.toLowerCase())) {
    compliantBody = `${compliantBody}\n\n${SMS_HELP_TEXT}`;
  }

  if (!/reply\s+stop\b/i.test(compliantBody)) {
    compliantBody = `${compliantBody}\n${SMS_OPT_OUT_TEXT}`;
  }

  return compliantBody;
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function smsCategory(messageBody: string, bodyHash: string) {
  const body = messageBody.toLowerCase();

  if (body.includes("sms test")) return "test";
  if (body.includes("driver route") || body.includes("open driver pod")) return "driver-route";
  if (body.includes("could not complete") || body.includes("delivery attempted")) return "failed-delivery";
  if (body.includes("running about") || body.includes("later than planned")) return "delay";
  if (body.includes("next delivery stop") || body.includes("next return stop") || body.includes("heading to you next")) return "next-stop";
  if (body.includes("out for delivery") || body.includes("return is scheduled for today") || body.includes("return is out today")) return "out-for-delivery";
  if (body.includes("has been completed") || body.includes("has been delivered") || body.includes("return is complete")) return "complete";
  if (body.includes("planned for") || body.includes("booked for")) return "booked";

  return `message-${bodyHash.slice(0, 16)}`;
}

function prismaErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code || "") : "";
}

async function reserveSmsDelivery(input: { recipient: string; sender: string; messageBody: string }) {
  const now = Date.now();
  const bodyHash = sha256(input.messageBody);
  const category = smsCategory(input.messageBody, bodyHash);
  const duplicatePrefix = sha256(`${input.recipient}|${category}`).slice(0, 32);

  try {
    const recent = await prisma.smsDelivery.findFirst({
      where: {
        recipient: input.recipient,
        duplicateKey: {
          startsWith: duplicatePrefix,
        },
        createdAt: {
          gte: new Date(now - SMS_DUPLICATE_WINDOW_MS),
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (recent) {
      throw new DuplicateSmsError("Duplicate SMS blocked because the same type of message was submitted to this number within the last 10 minutes.");
    }

    const duplicateBucket = Math.floor(now / SMS_DUPLICATE_WINDOW_MS);
    const duplicateKey = `${duplicatePrefix}:${duplicateBucket}`;

    return await prisma.smsDelivery.create({
      data: {
        recipient: input.recipient,
        sender: input.sender,
        bodyHash,
        bodyPreview: input.messageBody.slice(0, SMS_BODY_PREVIEW_LENGTH),
        duplicateKey,
      },
    });
  } catch (error) {
    if (error instanceof DuplicateSmsError) {
      throw error;
    }

    if (prismaErrorCode(error) === "P2002") {
      throw new DuplicateSmsError("Duplicate SMS blocked because the same type of message is already being submitted to this number.");
    }

    return null;
  }
}

async function recordSmsFailure(deliveryId: string, error: unknown, errorCode?: string | null) {
  try {
    await prisma.smsDelivery.update({
      where: {
        id: deliveryId,
      },
      data: {
        status: "FAILED",
        errorCode: errorCode || null,
        errorMessage: error instanceof Error ? error.message : String(error || "Unknown Twilio error"),
      },
    });
  } catch {
    // Logging failures must never hide the original provider error.
  }
}

function parseNumSegments(value: string | number | null | undefined) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function cleanTwilioStatus(value: string | null | undefined) {
  const status = (value || "SUBMITTED").trim().toUpperCase();
  return status || "SUBMITTED";
}

function statusRank(status: string) {
  return SMS_STATUS_RANK[status] ?? 0;
}

function twilioErrorCode(payload: TwilioResponse) {
  const value = payload.error_code ?? payload.code;
  return value === null || value === undefined || value === "" ? null : String(value);
}

async function fetchWithTimeout(url: string, init: RequestInit, providerName: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${providerName} timed out after ${Math.round(PROVIDER_TIMEOUT_MS / 1000)} seconds.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readProviderPayload<T extends { message?: string; error?: string }>(response: Response): Promise<T & { rawText?: string }> {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (_error) {
    return { rawText: text } as T & { rawText: string };
  }
}

function providerErrorMessage(providerName: string, response: Response, payload: { message?: string; error?: string; rawText?: string }) {
  const detail = payload.message || payload.error || payload.rawText;

  return detail
    ? `${providerName} failed with status ${response.status}. ${detail}`.trim()
    : `${providerName} failed with status ${response.status}.`;
}

export async function isTwilioEnabled() {
  const credentials = await getAppCredentials();

  return hasTwilioCredentials(credentials);
}

export async function isResendConfigured() {
  const credentials = await getAppCredentials();

  return hasResendCredentials(credentials);
}

export async function isResendEnabled() {
  const [credentials, emailNotificationsEnabled] = await Promise.all([
    getAppCredentials(),
    getEmailNotificationsEnabled(),
  ]);

  return emailNotificationsEnabled && hasResendCredentials(credentials);
}

export async function sendSmsWithTwilio(input: SendSmsInput): Promise<SendResult> {
  const credentials = await getAppCredentials();
  const accountSid = requireCredential(credentials.twilioAccountSid, "Twilio Account SID");
  const authToken = requireCredential(credentials.twilioAuthToken, "Twilio Auth Token");
  const fromNumber = requireCredential(credentials.twilioFromNumber, "Twilio From Number");
  const toNumber = requireValidSmsNumber(input.to);
  const messageBody = input.includeHelpText === false
    ? (input.message.body || "").trim()
    : withSmsHelpText(input.message.body);
  const delivery = await reserveSmsDelivery({
    recipient: toNumber,
    sender: fromNumber,
    messageBody,
  });
  const statusCallbackUrl = new URL("/api/twilio/status", `${getPublicAppBaseUrl(credentials.shopPublicUrl)}/`);

  if (delivery) {
    statusCallbackUrl.searchParams.set("deliveryId", delivery.id);
  }

  const body = new URLSearchParams();
  body.set("To", toNumber);
  body.set("From", fromNumber);
  body.set("Body", messageBody);
  body.set("StatusCallback", statusCallbackUrl.toString());

  let response: Response;

  try {
    response = await fetchWithTimeout(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: buildTwilioAuthHeader(accountSid, authToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }, "Twilio");
  } catch (error) {
    if (delivery) {
      await recordSmsFailure(delivery.id, error);
    }
    throw error;
  }

  const payload = await readProviderPayload<TwilioResponse>(response);

  if (!response.ok) {
    const providerError = new Error(providerErrorMessage("Twilio", response, payload));
    if (delivery) {
      await recordSmsFailure(delivery.id, providerError, twilioErrorCode(payload));
    }
    throw providerError;
  }

  if (delivery) {
    try {
      const current = await prisma.smsDelivery.findUnique({
        where: {
          id: delivery.id,
        },
      });
      const initialStatus = cleanTwilioStatus(payload.status);
      const nextStatus = current && statusRank(current.status) > statusRank(initialStatus)
        ? current.status
        : initialStatus;

      await prisma.smsDelivery.update({
        where: {
          id: delivery.id,
        },
        data: {
          twilioSid: payload.sid || current?.twilioSid || null,
          status: nextStatus,
          errorCode: twilioErrorCode(payload) || current?.errorCode || null,
          numSegments: parseNumSegments(payload.num_segments) ?? current?.numSegments ?? null,
          submittedAt: current?.submittedAt || new Date(),
        },
      });
    } catch {
      // Twilio accepted the message. A local logging failure must not cause a duplicate resend.
    }
  }

  return {
    ok: true,
    provider: "twilio",
    id: payload.sid,
  };
}

export async function sendEmailWithResend(input: SendEmailInput): Promise<SendResult> {
  const emailNotificationsEnabled = await getEmailNotificationsEnabled();

  if (!emailNotificationsEnabled) {
    throw new Error("Email notifications are turned off in Notifications.");
  }

  const credentials = await getAppCredentials();
  const apiKey = requireCredential(credentials.resendApiKey, "Resend API Key");
  const fromEmail = requireCredential(credentials.resendFromEmail, "Resend From Email");

  const response = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: input.to,
      subject: input.message.subject || "Bathroom Panels Direct delivery update",
      text: input.message.body,
      html: input.message.html || undefined,
    }),
  }, "Resend");

  const payload = await readProviderPayload<ResendResponse>(response);

  if (!response.ok) {
    throw new Error(providerErrorMessage("Resend", response, payload));
  }

  return {
    ok: true,
    provider: "resend",
    id: payload.id,
  };
}