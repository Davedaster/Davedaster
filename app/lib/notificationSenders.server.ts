import { getAppCredentials, hasResendCredentials, hasTwilioCredentials } from "./appCredentials.server";
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
};

function requireCredential(value: string, name: string) {
  if (!value) {
    throw new Error(`${name} is missing from Settings, API Credentials.`);
  }

  return value;
}

function normaliseSmsNumber(value: string) {
  const trimmed = (value || "").trim();

  if (!trimmed) {
    return "";
  }

  const compact = trimmed.replace(/[^\d+]/g, "");

  if (compact.startsWith("+")) {
    return `+${compact.slice(1).replace(/\D/g, "")}`;
  }

  const digits = compact.replace(/\D/g, "");

  if (digits.startsWith("00")) {
    return `+${digits.slice(2)}`;
  }

  if (digits.startsWith("44")) {
    return `+${digits}`;
  }

  if (digits.startsWith("0")) {
    return `+44${digits.slice(1)}`;
  }

  return digits;
}

function buildTwilioAuthHeader(accountSid: string, authToken: string) {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

export async function isTwilioEnabled() {
  const credentials = await getAppCredentials();

  return hasTwilioCredentials(credentials);
}

export async function isResendEnabled() {
  const credentials = await getAppCredentials();

  return hasResendCredentials(credentials);
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
  body.set("Body", input.message.body);

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: buildTwilioAuthHeader(accountSid, authToken),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json() as TwilioResponse;

  if (!response.ok) {
    throw new Error(payload.message || `Twilio failed with status ${response.status}.`);
  }

  return {
    ok: true,
    provider: "twilio",
    id: payload.sid,
  };
}

export async function sendEmailWithResend(input: SendEmailInput): Promise<SendResult> {
  const credentials = await getAppCredentials();
  const apiKey = requireCredential(credentials.resendApiKey, "Resend API Key");
  const fromEmail = requireCredential(credentials.resendFromEmail, "Resend From Email");

  const response = await fetch("https://api.resend.com/emails", {
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
  });

  const payload = await response.json() as ResendResponse;

  if (!response.ok) {
    throw new Error(payload.message || `Resend failed with status ${response.status}.`);
  }

  return {
    ok: true,
    provider: "resend",
    id: payload.id,
  };
}
