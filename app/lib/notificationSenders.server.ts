import { getAppCredentials, hasResendCredentials, hasTwilioCredentials } from "./appCredentials.server";
import { getEmailNotificationsEnabled } from "./notificationSettings.server";
import type { NotificationMessage } from "./notificationTemplates.server";

type SendSmsInput = {
  to: string;
  message: NotificationMessage;
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
  message?: string;
};

type ResendResponse = {
  id?: string;
  message?: string;
  error?: string;
};

const SMS_HELP_TEXT = "Need help? Call 01803 222784";
const PROVIDER_TIMEOUT_MS = 15000;

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

function buildTwilioAuthHeader(accountSid: string, authToken: string) {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

function withSmsHelpText(messageBody: string) {
  const cleanBody = (messageBody || "").trim();

  if (!cleanBody) {
    return SMS_HELP_TEXT;
  }

  if (cleanBody.toLowerCase().includes(SMS_HELP_TEXT.toLowerCase())) {
    return cleanBody;
  }

  return `${cleanBody}\n\n${SMS_HELP_TEXT}`;
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
  const toNumber = normaliseSmsNumber(input.to);

  if (!toNumber) {
    throw new Error("Customer phone number is missing.");
  }

  const body = new URLSearchParams();
  body.set("To", toNumber);
  body.set("From", fromNumber);
  body.set("Body", withSmsHelpText(input.message.body));

  const response = await fetchWithTimeout(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: buildTwilioAuthHeader(accountSid, authToken),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  }, "Twilio");

  const payload = await readProviderPayload<TwilioResponse>(response);

  if (!response.ok) {
    throw new Error(providerErrorMessage("Twilio", response, payload));
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
