import prisma from "../db.server";
import { getCustomerTrackingSettings } from "./customerTrackingSettings.server";
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
const COMPANY_PHONE = "01803 222784";
const COMPANY_EMAIL = "deliveries@bathroompanelsdirect.co.uk";
const COMPANY_ACCENT = "#509AE6";

export function notificationTemplateSupportsEmail(id: string) {
  return id !== "delayUpdate";
}

function shell(title: string, intro: string, highlight: string, extra = "") {
  return `<div style="margin:0;background:#f6f8fb;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#323841;">
  <div style="max-width:640px;margin:0 auto;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 14px;">
      <div>{% if company.logo_url %}<img src="{{ company.logo_url }}" alt="{{ company.name }}" style="display:block;max-height:48px;max-width:190px;object-fit:contain;">{% else %}<p style="margin:0;color:{{ company.accent_colour }};font-size:16px;font-weight:700;">{{ company.name }}</p>{% endif %}</div>
      <div style="background:#ffffff;border:1px solid #dce5ef;border-radius:999px;padding:9px 13px;color:#323841;font-size:13px;font-weight:700;box-shadow:0 8px 24px rgba(16,24,40,.05);">Delivery update</div>
    </div>
    <div style="background:#ffffff;border:1px solid #e7edf4;border-radius:28px;padding:22px;box-shadow:0 18px 50px rgba(16,24,40,.07);margin:0 0 14px;">
      <h1 style="margin:0;color:#323841;font-size:31px;line-height:1.08;letter-spacing:-.45px;font-weight:700;">${title}</h1>
      <p style="margin:12px 0 0;color:#667085;font-size:15px;line-height:1.55;">Hi {{ customer.name }},</p>
      <p style="margin:8px 0 0;color:#667085;font-size:15px;line-height:1.55;">${intro}</p>
      <div style="margin-top:16px;background:#eef7ff;border:1px solid #c8e4ff;border-radius:21px;padding:15px;">
        <p style="margin:0 0 5px;color:#667085;font-size:12px;text-transform:uppercase;letter-spacing:.45px;font-weight:700;">Estimated arrival</p>
        <p style="margin:0;color:#323841;font-size:25px;line-height:1.12;font-weight:700;">${highlight}</p>
        <p style="margin:8px 0 0;color:#667085;font-size:13px;line-height:1.4;">Order {{ order.number }} · {{ delivery.date }}</p>
      </div>
    </div>
    {% if driver.name %}
    <div style="background:#ffffff;border:1px solid #e7edf4;border-radius:24px;padding:17px;box-shadow:0 14px 44px rgba(16,24,40,.06);margin:0 0 14px;">
      {% if driver.photo_url %}<img src="{{ driver.photo_url }}" alt="{{ driver.name }}" width="54" height="54" style="float:left;width:54px;height:54px;object-fit:cover;border-radius:50%;border:1px solid #e7edf4;margin:0 13px 10px 0;box-shadow:0 8px 18px rgba(16,24,40,.06);">{% endif %}
      <p style="margin:0 0 4px;color:#667085;font-size:12px;text-transform:uppercase;letter-spacing:.45px;font-weight:700;">Your driver today</p>
      <p style="margin:0;color:#323841;font-size:20px;line-height:1.18;font-weight:700;">{{ driver.name }}</p>
      {% if driver.vehicle_registration %}<p style="margin:7px 0 0;color:#667085;font-size:14px;line-height:1.45;">Vehicle registration {{ driver.vehicle_registration }}</p>{% endif %}
      <div style="clear:both;"></div>
    </div>
    {% endif %}
    <div style="background:#ffffff;border:1px solid #e7edf4;border-radius:24px;padding:17px;box-shadow:0 14px 44px rgba(16,24,40,.06);margin:0 0 14px;">
      <h2 style="margin:0;color:#323841;font-size:20px;line-height:1.18;font-weight:700;">Delivery details</h2>
      <div style="background:#f8fafc;border:1px solid #edf1f5;border-radius:16px;padding:11px 12px;margin-top:13px;">
        <p style="margin:0 0 4px;color:#7b8794;font-size:12px;">Status</p>
        <p style="margin:0;color:#323841;font-size:14px;font-weight:700;">${highlight}</p>
      </div>
      <div style="background:#f8fafc;border:1px solid #edf1f5;border-radius:16px;padding:11px 12px;margin-top:9px;">
        <p style="margin:0 0 4px;color:#7b8794;font-size:12px;">Order</p>
        <p style="margin:0;color:#323841;font-size:14px;font-weight:700;">{{ order.number }}{% if order.items_summary %} · {{ order.items_summary }}{% endif %}</p>
      </div>
      ${extra}
      {% if tracking.url %}<p style="margin:16px 0 0;"><a href="{{ tracking.url }}" style="display:inline-block;background:{{ company.accent_colour }};color:#ffffff;text-decoration:none;border-radius:17px;padding:13px 18px;font-weight:700;box-shadow:0 10px 28px rgba(16,24,40,.08);">Track your delivery</a></p>{% endif %}
    </div>
    <div style="background:#ffffff;border:1px solid #e7edf4;border-radius:24px;padding:17px;box-shadow:0 14px 44px rgba(16,24,40,.06);margin:0 0 14px;">
      <p style="margin:0;color:#667085;font-size:14px;line-height:1.55;">Our own team will bring your panel order to a room of your choice where access allows.</p>
    </div>
    <p style="margin:0;padding:8px 2px 0;color:#667085;font-size:13px;line-height:1.5;">Need help? Call {{ company.phone }} or email {{ company.email }}.</p>
  </div>
</div>`;
}

const defaults: Record<NotificationTemplateId, EditableNotificationTemplate> = {
  bookedSlot: {
    id: "bookedSlot",
    label: "Booked delivery slot",
    description: "Sent when a delivery slot is confirmed for a customer.",
    emailSubject: "Your delivery slot for {{ order.number }}",
    emailHtml: shell("Your panel delivery is planned", "Your Bathroom Panels Direct delivery has been booked for the slot below.", "{{ delivery.eta_slot }}"),
    smsBody: "Hi {{ customer.name }}, your Bathroom Panels Direct delivery for {{ order.number }} is booked for {{ delivery.date }}, {{ delivery.eta_slot }}. Track it here: {{ tracking.url }}",
  },
  outForDelivery: {
    id: "outForDelivery",
    label: "Out for delivery",
    description: "Sent when the route is out for delivery.",
    emailSubject: "Your Bathroom Panels Direct order is out for delivery",
    emailHtml: shell("Your panels are out for delivery", "Your order is now with our delivery team and is currently booked for the slot below.", "{{ delivery.eta_slot }}"),
    smsBody: "Hi {{ customer.name }}, your order is out for delivery. {% if driver.name %}Your driver is {{ driver.name }}. {% endif %}Current slot: {{ delivery.eta_slot }}. Track it here: {{ tracking.url }}",
  },
  nextDropTracking: {
    id: "nextDropTracking",
    label: "Next drop tracking",
    description: "Sent when the customer is the next delivery stop.",
    emailSubject: "You are the next delivery",
    emailHtml: shell("You are the next delivery", "Good news, {% if driver.name %}{{ driver.name }} is{% else %}our driver is{% endif %} heading to you next.", "Live tracking is ready", "<p style=\"margin:12px 0 0;color:#667085;font-size:14px;line-height:1.55;\">Live tracking is only shown while you are the next drop.</p>"),
    smsBody: "Hi {{ customer.name }}, good news, {% if driver.name %}{{ driver.name }} is{% else %}our driver is{% endif %} heading to you next. Track here: {{ tracking.url }}",
  },
  delayUpdate: {
    id: "delayUpdate",
    label: "Late delivery update",
    description: "SMS only. Sent when a route is running behind schedule.",
    emailSubject: "",
    emailHtml: "",
    smsBody: "Hi {{ customer.name }}, sorry, your delivery is running around {{ delay.minutes }} minutes later than planned. Updated slot: {{ delivery.eta_slot }}. Track here: {{ tracking.url }}",
  },
  deliveryComplete: {
    id: "deliveryComplete",
    label: "Delivery complete",
    description: "Sent after a stop has been completed.",
    emailSubject: "Delivery complete for {{ order.number }}",
    emailHtml: shell("Your panels have been delivered", "Your Bathroom Panels Direct delivery has been completed. Thank you for your order.", "Completed today", "{% if proof.photo_url %}<p style=\"margin:12px 0 0;color:#667085;font-size:14px;line-height:1.55;\">Proof of delivery photo: <a href=\"{{ proof.photo_url }}\" style=\"color:{{ company.accent_colour }};font-weight:700;\">View photo</a></p>{% endif %}"),
    smsBody: "Hi {{ customer.name }}, your delivery for {{ order.number }} has been completed. Thank you for your order.{% if proof.photo_url %} Proof photo: {{ proof.photo_url }}{% endif %}",
  },
};

export const notificationTemplateDefinitions = Object.values(defaults).map((template) => ({ id: template.id, label: template.label, description: template.description, supportsEmail: notificationTemplateSupportsEmail(template.id) }));
export const notificationTemplateNames = notificationTemplateDefinitions.map((template) => template.label);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normaliseTemplate(id: NotificationTemplateId, value?: Partial<EditableNotificationTemplate> | null): EditableNotificationTemplate {
  const fallback = defaults[id];
  const supportsEmail = notificationTemplateSupportsEmail(id);
  return {
    id,
    label: fallback.label,
    description: fallback.description,
    emailSubject: supportsEmail ? clean(value?.emailSubject) || fallback.emailSubject : "",
    emailHtml: supportsEmail ? clean(value?.emailHtml) || fallback.emailHtml : "",
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
  const ifPattern = /\{%\s*if\s+([a-zA-Z0-9_.]+)\s*%\}([\s\S]*?)(?:\{%\s*else\s*%\}([\s\S]*?))?\{%\s*endif\s*%\}/g;

  for (let index = 0; index < 8; index += 1) {
    const nextOutput = output.replace(ifPattern, (_match, path: string, truthyContent: string, falseyContent: string = "") => valueAtPath(context, path) ? truthyContent : falseyContent);
    if (nextOutput === output) break;
    output = nextOutput;
  }

  return output.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, path: string) => {
    const value = valueAtPath(context, path);
    const stringValue = value === null || typeof value === "undefined" ? "" : String(value);
    return mode === "html" ? escapeHtml(stringValue) : stringValue;
  }).replace(/\n{3,}/g, "\n\n").trim();
}

function companyContext(settings?: Awaited<ReturnType<typeof getCustomerTrackingSettings>> | null) {
  return {
    name: clean(settings?.companyName) || COMPANY_NAME,
    phone: clean(settings?.supportPhone) || COMPANY_PHONE,
    email: clean(settings?.supportEmail) || COMPANY_EMAIL,
    logo_url: clean(settings?.logoUrl),
    accent_colour: clean(settings?.primaryColour) || COMPANY_ACCENT,
  };
}

function buildTemplateContext(input: NotificationTemplateInput, settings?: Awaited<ReturnType<typeof getCustomerTrackingSettings>> | null) {
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
    company: companyContext(settings),
    proof: { photo_url: input.proofPhotoUrl || "" },
    delay: { minutes: input.delayMinutes || 45 },
  };
}

function renderTemplate(template: EditableNotificationTemplate, input: NotificationTemplateInput, channel: NotificationChannel, settings?: Awaited<ReturnType<typeof getCustomerTrackingSettings>> | null): NotificationMessage {
  const context = buildTemplateContext(input, settings);
  const body = renderLiquid(template.smsBody, context, "text");
  if (channel === "sms" || !notificationTemplateSupportsEmail(template.id)) return { body };
  return { subject: renderLiquid(template.emailSubject, context, "text"), body, html: renderLiquid(template.emailHtml, context, "html") };
}

async function buildNotificationMessage(templateId: NotificationTemplateId, input: NotificationTemplateInput, channel: NotificationChannel) {
  const [templates, trackingSettings] = await Promise.all([
    getNotificationTemplates(),
    getCustomerTrackingSettings(),
  ]);

  return renderTemplate(templates[templateId] || defaults[templateId], input, channel, trackingSettings);
}

export function buildNotificationTemplatePreview(input: NotificationTemplateInput, template: EditableNotificationTemplate, channel: NotificationChannel) {
  return renderTemplate(template, input, channel);
}

export function availableNotificationVariables() {
  return [
    "{{ customer.name }}", "{{ order.number }}", "{{ order.items_summary }}", "{{ route.name }}", "{{ delivery.date }}", "{{ delivery.eta_start }}", "{{ delivery.eta_end }}", "{{ delivery.eta_slot }}", "{{ tracking.url }}", "{{ driver.name }}", "{{ driver.photo_url }}", "{{ driver.vehicle_name }}", "{{ driver.vehicle_registration }}", "{{ company.name }}", "{{ company.phone }}", "{{ company.email }}", "{{ company.logo_url }}", "{{ company.accent_colour }}", "{{ proof.photo_url }}", "{{ delay.minutes }}",
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
