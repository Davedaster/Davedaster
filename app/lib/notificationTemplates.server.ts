import prisma from "../db.server";
import { formatEtaSlot } from "./etaSlots.server";

export type NotificationChannel = "sms" | "email";
export type NotificationTemplateId = "bookedSlot" | "outForDelivery" | "nextDropTracking" | "delayUpdate" | "deliveryComplete";

export type NotificationTemplateInput = {
  customerName?: string | null;
  orderNumber?: string | null;
  itemsSummary?: string | null;
  routeName?: string | null;
  driverName?: string | null;
  driverPhotoUrl?: string | null;
  driverVehicleName?: string | null;
  driverVehicleRegistration?: string | null;
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
  html?: string;
};

export type EditableNotificationTemplate = {
  id: NotificationTemplateId;
  label: string;
  description: string;
  emailSubject: string;
  emailHtml: string;
  smsBody: string;
};

const SETTING_KEY = "notification_templates";
const COMPANY_NAME = "Bathroom Panels Direct";
const COMPANY_PHONE = "01803 411 234";
const COMPANY_EMAIL = "sales@bathroompanelsdirect.co.uk";
const COMPANY_ACCENT = "#509AE6";

function shell(title: string, intro: string, highlight: string, extra = "") {
  return `<div style="margin:0;background:#f4f7fb;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#323841;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d9e2ec;border-radius:18px;overflow:hidden;">
    <div style="background:#323841;color:#ffffff;padding:26px 30px;">
      <p style="margin:0;color:#d6ecff;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">{{ company.name }}</p>
      <h1 style="margin:8px 0 0;font-size:26px;line-height:1.2;">${title}</h1>
    </div>
    <div style="padding:30px;">
      <p style="font-size:16px;line-height:1.6;margin:0 0 18px;">Hi {{ customer.name }},</p>
      <p style="font-size:16px;line-height:1.6;margin:0 0 22px;">${intro}</p>
      <div style="background:#eef7ff;border:1px solid #c8e4ff;border-radius:16px;padding:20px;margin-bottom:22px;">
        <p style="margin:0 0 6px;color:#509AE6;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Delivery update</p>
        <p style="margin:0;font-size:24px;font-weight:800;line-height:1.25;">${highlight}</p>
        <p style="margin:8px 0 0;color:#667085;font-size:14px;">Order {{ order.number }}</p>
      </div>
      {% if driver.name %}
      <div style="border:1px solid #e4e7ec;border-radius:16px;padding:16px;margin-bottom:22px;">
        {% if driver.photo_url %}<img src="{{ driver.photo_url }}" alt="{{ driver.name }}" width="64" height="64" style="float:left;margin:0 14px 10px 0;border-radius:50%;object-fit:cover;border:3px solid #509AE6;">{% endif %}
        <p style="margin:0 0 4px;color:#667085;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Your driver</p>
        <p style="margin:0;font-size:18px;font-weight:800;">{{ driver.name }}</p>
        {% if driver.vehicle_registration %}<p style="margin:4px 0 0;color:#667085;font-size:14px;">Vehicle registration {{ driver.vehicle_registration }}</p>{% endif %}
        <div style="clear:both;"></div>
      </div>
      {% endif %}
      ${extra}
      {% if tracking.url %}<p style="margin:0 0 24px;"><a href="{{ tracking.url }}" style="display:inline-block;background:#509AE6;color:#ffffff;text-decoration:none;border-radius:999px;padding:14px 22px;font-weight:800;">Track your delivery</a></p>{% endif %}
      <div style="background:#f9fafb;border-radius:14px;padding:16px;margin-bottom:22px;color:#475467;font-size:14px;line-height:1.6;">Our own delivery team will bring your order to a room of your choice where access is safe and practical.</div>
      <p style="margin:0;font-size:15px;line-height:1.6;">Thank you,<br><strong>{{ company.name }}</strong></p>
    </div>
    <div style="background:#f9fafb;border-top:1px solid #e4e7ec;color:#667085;padding:18px 30px;font-size:13px;line-height:1.5;">Need help? Call {{ company.phone }} or email {{ company.email }}</div>
  </div>
</div>`;
}

const defaults: Record<NotificationTemplateId, EditableNotificationTemplate> = {
  bookedSlot: {
    id: "bookedSlot",
    label: "Booked delivery slot",
    description: "Sent when a delivery slot is confirmed for a customer.",
    emailSubject: "Your delivery slot for {{ order.number }}",
    emailHtml: shell("Your delivery slot is booked", "Your Bathroom Panels Direct delivery has been booked for {{ delivery.date }}.", "{{ delivery.eta_slot }}"),
    smsBody: "Hi {{ customer.name }}, your Bathroom Panels Direct delivery for {{ order.number }} is booked for {{ delivery.date }}, {{ delivery.eta_slot }}. Track it here: {{ tracking.url }}",
  },
  outForDelivery: {
    id: "outForDelivery",
    label: "Out for delivery",
    description: "Sent when the route is out for delivery.",
    emailSubject: "Your Bathroom Panels Direct order is out for delivery",
    emailHtml: shell("Your order is out for delivery", "Your order is now with our delivery team and is currently booked for the slot below.", "{{ delivery.eta_slot }}"),
    smsBody: "Hi {{ customer.name }}, your order is out for delivery. {% if driver.name %}Your driver is {{ driver.name }}. {% endif %}Current slot: {{ delivery.eta_slot }}. Track it here: {{ tracking.url }}",
  },
  nextDropTracking: {
    id: "nextDropTracking",
    label: "Next drop tracking",
    description: "Sent when the customer is the next delivery stop.",
    emailSubject: "You are the next delivery",
    emailHtml: shell("You are the next delivery", "Good news, our driver is heading to you next.", "Live tracking is now available", "<p style=\"margin:0 0 22px;font-size:15px;line-height:1.6;color:#475467;\">You will only see live tracking while you are the next drop.</p>"),
    smsBody: "Hi {{ customer.name }}, good news, {% if driver.name %}{{ driver.name }} is{% endif %}{% if driver.name %}{% else %}our driver is{% endif %} heading to you next. Track here: {{ tracking.url }}",
  },
  delayUpdate: {
    id: "delayUpdate",
    label: "Delay update",
    description: "Sent when a route is running behind schedule.",
    emailSubject: "Delivery update for {{ order.number }}",
    emailHtml: shell("Delivery update", "We are sorry, your delivery is currently running around {{ delay.minutes }} minutes later than planned.", "Updated slot: {{ delivery.eta_slot }}"),
    smsBody: "Hi {{ customer.name }}, sorry, your delivery is running around {{ delay.minutes }} minutes later than planned. Updated slot: {{ delivery.eta_slot }}. Track here: {{ tracking.url }}",
  },
  deliveryComplete: {
    id: "deliveryComplete",
    label: "Delivery complete",
    description: "Sent after a stop has been completed.",
    emailSubject: "Delivery complete for {{ order.number }}",
    emailHtml: shell("Delivery complete", "Your Bathroom Panels Direct delivery has been completed. Thank you for your order.", "Completed today", "{% if proof.photo_url %}<p style=\"margin:0 0 22px;font-size:15px;line-height:1.6;\">Proof of delivery photo: <a href=\"{{ proof.photo_url }}\" style=\"color:#509AE6;font-weight:700;\">View photo</a></p>{% endif %}"),
    smsBody: "Hi {{ customer.name }}, your delivery for {{ order.number }} has been completed. Thank you for your order.{% if proof.photo_url %} Proof photo: {{ proof.photo_url }}{% endif %}",
  },
};

export const notificationTemplateDefinitions = Object.values(defaults).map((template) => ({ id: template.id, label: template.label, description: template.description }));
export const notificationTemplateNames = notificationTemplateDefinitions.map((template) => template.label);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normaliseTemplate(id: NotificationTemplateId, value?: Partial<EditableNotificationTemplate> | null): EditableNotificationTemplate {
  const fallback = defaults[id];
  return {
    id,
    label: fallback.label,
    description: fallback.description,
    emailSubject: clean(value?.emailSubject) || fallback.emailSubject,
    emailHtml: clean(value?.emailHtml) || fallback.emailHtml,
    smsBody: clean(value?.smsBody) || fallback.smsBody,
  };
}

function isTemplateId(value: string): value is NotificationTemplateId {
  return Object.prototype.hasOwnProperty.call(defaults, value);
}

export function getDefaultNotificationTemplate(id: NotificationTemplateId) {
  return defaults[id];
}

export async function getNotificationTemplates() {
  const record = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  let stored: Partial<Record<NotificationTemplateId, Partial<EditableNotificationTemplate>>> = {};

  if (record?.value) {
    try {
      stored = JSON.parse(record.value) as Partial<Record<NotificationTemplateId, Partial<EditableNotificationTemplate>>>;
    } catch {
      stored = {};
    }
  }

  return Object.fromEntries(notificationTemplateDefinitions.map((definition) => [definition.id, normaliseTemplate(definition.id, stored[definition.id])])) as Record<NotificationTemplateId, EditableNotificationTemplate>;
}

export async function listNotificationTemplates() {
  const templates = await getNotificationTemplates();
  return notificationTemplateDefinitions.map((definition) => templates[definition.id]);
}

async function saveTemplates(next: Record<NotificationTemplateId, EditableNotificationTemplate>) {
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
}

export async function saveNotificationTemplate(id: string, input: Pick<EditableNotificationTemplate, "emailSubject" | "emailHtml" | "smsBody">) {
  if (!isTemplateId(id)) throw new Error("Notification template could not be found.");
  const current = await getNotificationTemplates();
  const next = { ...current, [id]: normaliseTemplate(id, { ...current[id], ...input }) };
  await saveTemplates(next);
  return next[id];
}

export async function resetNotificationTemplate(id: string) {
  if (!isTemplateId(id)) throw new Error("Notification template could not be found.");
  const current = await getNotificationTemplates();
  const next = { ...current, [id]: defaults[id] };
  await saveTemplates(next);
  return next[id];
}

function displayName(name?: string | null) {
  return name?.trim() || "there";
}

function formatDate(value?: Date | string | null) {
  if (!value) return "your delivery day";
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long" }).format(new Date(value));
}

function formatTime(value?: Date | string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(value));
}

function formatSlot(estimatedArrival?: Date | string | null, slotMinutes = 60) {
  if (!estimatedArrival) return "your booked delivery slot";
  const start = new Date(estimatedArrival);
  const end = new Date(start.getTime() + slotMinutes * 60 * 1000);
  return formatEtaSlot(start, end);
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce((current: unknown, key) => {
    if (!current || typeof current !== "object") return "";
    return (current as Record<string, unknown>)[key];
  }, value);
}

function renderLiquid(template: string, context: Record<string, unknown>, mode: "html" | "text") {
  let output = template;
  const ifPattern = /\{%\s*if\s+([a-zA-Z0-9_.]+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;

  for (let index = 0; index < 8; index += 1) {
    const nextOutput = output.replace(ifPattern, (_match, path: string, content: string) => valueAtPath(context, path) ? content : "");
    if (nextOutput === output) break;
    output = nextOutput;
  }

  return output.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, path: string) => {
    const value = valueAtPath(context, path);
    const stringValue = value === null || typeof value === "undefined" ? "" : String(value);
    return mode === "html" ? escapeHtml(stringValue) : stringValue;
  }).replace(/\n{3,}/g, "\n\n").trim();
}

function buildTemplateContext(input: NotificationTemplateInput) {
  const slotMinutes = input.slotMinutes || 60;
  const start = input.estimatedArrival ? new Date(input.estimatedArrival) : null;
  const end = start ? new Date(start.getTime() + slotMinutes * 60 * 1000) : null;

  return {
    customer: { name: displayName(input.customerName) },
    order: { number: input.orderNumber || "your order", items_summary: input.itemsSummary || "" },
    route: { name: input.routeName || "your delivery route" },
    delivery: { date: formatDate(input.deliveryDate), eta_start: formatTime(start), eta_end: formatTime(end), eta_slot: formatSlot(input.estimatedArrival, slotMinutes) },
    tracking: { url: input.trackingUrl || "" },
    driver: { name: input.driverName || "", photo_url: input.driverPhotoUrl || "", vehicle_name: input.driverVehicleName || "", vehicle_registration: input.driverVehicleRegistration || "" },
    company: { name: COMPANY_NAME, phone: COMPANY_PHONE, email: COMPANY_EMAIL, accent_colour: COMPANY_ACCENT },
    proof: { photo_url: input.proofPhotoUrl || "" },
    delay: { minutes: input.delayMinutes || 45 },
  };
}

function renderTemplate(template: EditableNotificationTemplate, input: NotificationTemplateInput, channel: NotificationChannel): NotificationMessage {
  const context = buildTemplateContext(input);
  const body = renderLiquid(template.smsBody, context, "text");
  if (channel === "sms") return { body };
  return { subject: renderLiquid(template.emailSubject, context, "text"), body, html: renderLiquid(template.emailHtml, context, "html") };
}

async function buildNotificationMessage(templateId: NotificationTemplateId, input: NotificationTemplateInput, channel: NotificationChannel) {
  const templates = await getNotificationTemplates();
  return renderTemplate(templates[templateId] || defaults[templateId], input, channel);
}

export function buildNotificationTemplatePreview(input: NotificationTemplateInput, template: EditableNotificationTemplate, channel: NotificationChannel) {
  return renderTemplate(template, input, channel);
}

export function availableNotificationVariables() {
  return [
    "{{ customer.name }}", "{{ order.number }}", "{{ order.items_summary }}", "{{ route.name }}", "{{ delivery.date }}", "{{ delivery.eta_start }}", "{{ delivery.eta_end }}", "{{ delivery.eta_slot }}", "{{ tracking.url }}", "{{ driver.name }}", "{{ driver.photo_url }}", "{{ driver.vehicle_name }}", "{{ driver.vehicle_registration }}", "{{ company.name }}", "{{ company.phone }}", "{{ company.email }}", "{{ proof.photo_url }}", "{{ delay.minutes }}",
  ];
}

export async function buildBookedSlotMessage(input: NotificationTemplateInput, channel: NotificationChannel) {
  return buildNotificationMessage("bookedSlot", input, channel);
}

export async function buildOutForDeliveryMessage(input: NotificationTemplateInput, channel: NotificationChannel) {
  return buildNotificationMessage("outForDelivery", input, channel);
}

export async function buildNextDropTrackingMessage(input: NotificationTemplateInput, channel: NotificationChannel) {
  return buildNotificationMessage("nextDropTracking", input, channel);
}

export async function buildDelayMessage(input: NotificationTemplateInput, channel: NotificationChannel) {
  return buildNotificationMessage("delayUpdate", input, channel);
}

export async function buildDeliveryCompleteMessage(input: NotificationTemplateInput, channel: NotificationChannel) {
  return buildNotificationMessage("deliveryComplete", input, channel);
}
