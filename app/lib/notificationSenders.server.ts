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

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is missing from the app environment.`);
  }

  return value;
}

function buildTwilioAuthHeader(accountSid: string, authToken: string) {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

export function isTwilioEnabled() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

export function isResendEnabled() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

export async function sendSmsWithTwilio(input: SendSmsInput): Promise<SendResult> {
  const accountSid = requireEnv("TWILIO_ACCOUNT_SID");
  const authToken = requireEnv("TWILIO_AUTH_TOKEN");
  const fromNumber = requireEnv("TWILIO_FROM_NUMBER");

  const body = new URLSearchParams();
  body.set("To", input.to);
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
  const apiKey = requireEnv("RESEND_API_KEY");
  const fromEmail = requireEnv("RESEND_FROM_EMAIL");

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
