import { formatEtaSlot } from "./etaSlots.server";

export type NotificationChannel = "sms" | "email";

export type NotificationTemplateInput = {
  customerName?: string | null;
  orderNumber?: string | null;
  routeName?: string | null;
  driverName?: string | null;
  deliveryDate?: Date | string | null;
  estimatedArrival?: Date | string | null;
  slotMinutes?: number;
  trackingUrl?: string | null;
  proofPhotoUrl?: string | null;
  delayMinutes?: number | null;
};

export type NotificationMessage = {
  subject?: string;
  body: string;
};

function displayName(name?: string | null) {
  return name?.trim() || "there";
}

function formatDate(value?: Date | string | null) {
  if (!value) {
    return "your delivery day";
  }

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(new Date(value));
}

function formatSlot(estimatedArrival?: Date | string | null, slotMinutes = 60) {
  if (!estimatedArrival) {
    return "your booked delivery slot";
  }

  const start = new Date(estimatedArrival);
  const end = new Date(start.getTime() + slotMinutes * 60 * 1000);

  return formatEtaSlot(start, end);
}

function proofPhotoLine(proofPhotoUrl?: string | null) {
  return proofPhotoUrl
    ? `\n\nProof of delivery photo: ${proofPhotoUrl}`
    : "";
}

function trackingLine(trackingUrl?: string | null) {
  return trackingUrl
    ? `\n\nTrack your delivery here: ${trackingUrl}`
    : "";
}

export function buildBookedSlotMessage(input: NotificationTemplateInput, channel: NotificationChannel): NotificationMessage {
  const slot = formatSlot(input.estimatedArrival, input.slotMinutes);
  const date = formatDate(input.deliveryDate);
  const greeting = `Hi ${displayName(input.customerName)},`;
  const body = `${greeting}\n\nYour Bathroom Panels Direct delivery has been booked for ${date}, between ${slot}.\n\nYour order will be delivered by our own team to a room of your choice.${trackingLine(input.trackingUrl)}\n\nBathroom Panels Direct`;

  return {
    subject: channel === "email" ? `Your delivery slot for ${input.orderNumber || "your order"}` : undefined,
    body,
  };
}

export function buildOutForDeliveryMessage(input: NotificationTemplateInput, channel: NotificationChannel): NotificationMessage {
  const slot = formatSlot(input.estimatedArrival, input.slotMinutes);
  const greeting = `Hi ${displayName(input.customerName)},`;
  const driver = input.driverName ? ` Your driver today is ${input.driverName}.` : "";
  const body = `${greeting}\n\nYour Bathroom Panels Direct order is out for delivery and is currently booked between ${slot}.${driver}\n\nOur team will deliver to a room of your choice.${trackingLine(input.trackingUrl)}\n\nBathroom Panels Direct`;

  return {
    subject: channel === "email" ? `Your Bathroom Panels Direct order is out for delivery` : undefined,
    body,
  };
}

export function buildNextDropTrackingMessage(input: NotificationTemplateInput, channel: NotificationChannel): NotificationMessage {
  const greeting = `Hi ${displayName(input.customerName)},`;
  const driver = input.driverName ? `${input.driverName} is` : "Your driver is";
  const body = `${greeting}\n\nGood news, ${driver} heading to you next.${trackingLine(input.trackingUrl)}\n\nYou will only see live tracking while you are the next drop.\n\nBathroom Panels Direct`;

  return {
    subject: channel === "email" ? `You are the next delivery` : undefined,
    body,
  };
}

export function buildDelayMessage(input: NotificationTemplateInput, channel: NotificationChannel): NotificationMessage {
  const delayMinutes = input.delayMinutes || 45;
  const greeting = `Hi ${displayName(input.customerName)},`;
  const body = `${greeting}\n\nWe are sorry, your Bathroom Panels Direct delivery is currently running around ${delayMinutes} minutes later than planned.\n\nWe will keep your tracking page updated.${trackingLine(input.trackingUrl)}\n\nBathroom Panels Direct`;

  return {
    subject: channel === "email" ? `Delivery update for ${input.orderNumber || "your order"}` : undefined,
    body,
  };
}

export function buildDeliveryCompleteMessage(input: NotificationTemplateInput, channel: NotificationChannel): NotificationMessage {
  const greeting = `Hi ${displayName(input.customerName)},`;
  const proofLine = proofPhotoLine(input.proofPhotoUrl);
  const body = `${greeting}\n\nYour Bathroom Panels Direct delivery has been completed.\n\nThank you for your order.${proofLine}\n\nBathroom Panels Direct`;

  return {
    subject: channel === "email" ? `Delivery complete for ${input.orderNumber || "your order"}` : undefined,
    body,
  };
}

export const notificationTemplateNames = [
  "Booked slot",
  "Out for delivery",
  "Next drop tracking",
  "Delay, 45 minutes",
  "Delay, 90 minutes",
  "Delivery complete",
];
