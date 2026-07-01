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
  signaturePhotoUrl?: string | null;
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
const EMAIL_TEMPLATE_VERSION = "clean_logo_delivery_emails_2026_07_01";
const COMPANY_NAME = "Bathroom Panels Direct";
const COMPANY_PHONE = "01803 222784";
const COMPANY_EMAIL = "deliveries@bathroompanelsdirect.co.uk";
const COMPANY_ACCENT = "#509AE6";

export function notificationTemplateSupportsEmail(id: string) {
  return id !== "delayUpdate";
}

function shell(title: string, intro: string, highlight: string, extra = "") {
  return `<div style="margin:0;background:#f7f9fc;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#323841;">
  <div style="max-width:620px;margin:0 auto;">
    {% if company.logo_url %}<div style="text-align:center;margin:0 0 22px;"><img src="{{ company.logo_url }}" alt="{{ company.name }}" style="display:inline-block;max-height:54px;max-width:220px;object-fit:contain;"></div>{% endif %}
    <div style="background:#ffffff;border-radius:26px;padding:30px;box-shadow:0 16px 44px rgba(16,24,40,.07);">
      <p style="margin:0 0 12px;color:{{ company.accent_colour }};font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">Delivery update</p>
      <h1 style="margin:0;color:#323841;font-size:30px;line-height:1.12;letter-spacing:-.35px;font-weight:700;">${title}</h1>
      <p style="margin:18px 0 0;color:#667085;font-size:15px;line-height:1.6;">Hi {{ customer.name }},</p>
      <p style="margin:8px 0 0;color:#667085;font-size:15px;line-height:1.6;">${intro}</p>
      <div style="margin:22px 0 0;padding:16px 0;border-top:1px solid #edf1f5;border-bottom:1px solid #edf1f5;">
        <p style="margin:0 0 5px;color:#7b8794;font-size:12px;text-transform:uppercase;letter-spacing:.45px;font-weight:700;">Estimated arrival</p>
        <p style="margin:0;color:#323841;font-size:25px;line-height:1.18;font-weight:700;">${highlight}</p>
        <p style="margin:7px 0 0;color:#667085;font-size:13px;line-height:1.4;">Order {{ order.number }} · {{ delivery.date }}</p>
      </div>
      {% if driver.name %}
      <div style="margin-top:22px;">
        {% if driver.photo_url %}<img src="{{ driver.photo_url }}" alt="{{ driver.name }}" width="52" height="52" style="float:left;width:52px;height:52px;object-fit:cover;border-radius:50%;margin:0 13px 8px 0;">{% endif %}
        <p style="margin:0 0 4px;color:#7b8794;font-size:12px;text-transform:uppercase;letter-spacing:.45px;font-weight:700;">Your driver today</p>
        <p style="margin:0;color:#323841;font-size:19px;line-height:1.2;font-weight:700;">{{ driver.name }}</p>
        {% if driver.vehicle_registration %}<p style="margin:6px 0 0;color:#667085;font-size:14px;line-height:1.45;">Vehicle registration {{ driver.vehicle_registration }}</p>{% endif %}
        <div style="clear:both;"></div>
      </div>
      {% endif %}
      <div style="margin-top:22px;padding-top:18px;border-top:1px solid #edf1f5;">
        <p style="margin:0 0 4px;color:#7b8794;font-size:12px;text-transform:uppercase;letter-spacing:.45px;font-weight:700;">Order details</p>
        <p style="margin:0;color:#323841;font-size:15px;line-height:1.55;font-weight:600;">{{ order.number }}{% if order.items_summary %} · {{ order.items_summary }}{% endif %}</p>
      </div>
      ${extra}
      {% if tracking.url %}<p style="margin:24px 0 0;"><a href="{{ tracking.url }}" style="display:inline-block;background:{{ company.accent_colour }};color:#ffffff;text-decoration:none;border-radius:999px;padding:13px 20px;font-weight:700;">Track your delivery</a></p>{% endif %}
    </div>
    <p style="margin:18px 0 0;text-align:center;color:#667085;font-size:13px;line-height:1.5;">Need help? Call {{ company.phone }} or email {{ company.email }}.</p>
  </div>
</div>`;
}

const proofImagesHtml = `{% if proof.photo_url %}<div style="margin-top:22px;padding-top:18px;border-top:1px solid #edf1f5;"><p style="margin:0 0 10px;color:#7b8794;font-size:12px;text-transform:uppercase;letter-spacing:.45px;font-weight:700;">Delivery photo</p><img src="{{ proof.photo_url }}" alt="Delivery photo" style="display:block;width:100%;max-width:520px;border-radius:18px;"></div>{% endif %}{% if proof.signature_url %}<div style="margin-top:20px;"><p style="margin:0 0 10px;color:#7b8794;font-size:12px;text-transform:uppercase;letter-spacing:.45px;font-weight:700;">Customer signature</p><img src="{{ proof.signature_url }}" alt="Customer signature" style="display:block;width:100%;max-width:360px;border-radius:14px;background:#ffffff;"></div>{% endif %}`;

const defaults: Record<NotificationTemplateId, EditableNotificationTemplate> = {
  bookedSlot: {
    id: "bookedSlot",
    label: "Booked delivery slot",
    description: "Sent when a delivery slot is confirmed for a customer.",
    emailSubject: "Your panel order delivery, {{ order.number }}",
    emailHtml: shell("Your panel delivery is planned", "Your panel order has been booked for the slot below.", "{{ delivery.eta_slot }}"),
    smsBody: "Hi {{ customer.name }}, your Bathroom Panels Direct delivery for {{ order.number }} is booked for {{ delivery.date }}, {{ delivery.eta_slot }}. Track it here: {{ tracking.url }}",
  },
  outForDelivery: {
    id: "outForDelivery",
    label: "Out for delivery",
    description: "Sent when the route is out for delivery.",
    emailSubject: "Your panel order is out for delivery, {{ order.number }}",
    emailHtml: shell("Your panels are out for delivery", "Your order is now with our delivery team and is booked for the slot below.", "{{ delivery.eta_slot }}"),
    smsBody: "Hi {{ customer.name }}, your order is out for delivery. {% if driver.name %}Your driver is {{ driver.name }}. {% endif %}Current slot: {{ delivery.eta_slot }}. Track it here: {{ tracking.url }}",
  },
  nextDropTracking: {
    id: "nextDropTracking",
    label: "Next drop tracking",
    description: "Sent when the customer is the next delivery stop.",
    emailSubject: "You are next for delivery, {{ order.number }}",
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
    emailSubject: "Your panel order has been delivered, {{ order.number }}",
    emailHtml: shell("Your panels have been delivered", "Your panel order has been delivered. Thank you for your order.", "Completed today", proofImagesHtml),
    smsBody: "Hi {{ customer.name }}, your delivery for {{ order.number }} has been completed. Thank you for your order.{% if proof.photo_url %} Proof photo: {{ proof.photo_url }}{% endif %}",
  },
};

export const notificationTemplateDefinitions = Object.values(defaults).map((template) => ({ id: template.id, label: template.label, description: template.description, supportsEmail: notificationTemplateSupportsEmail(template.id) }));
export const notificationTemplateNames = notificationTemplateDefinitions.map((template) => template.label);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normaliseTemplate(id: NotificationTemplateId, value?: Partial<EditableNotificationTemplate> | null, storedEmailVersion = EMAIL_TEMPLATE_VERSION): EditableNotificationTemplate {
  const fallback = defaults[id];
  const supportsEmail = notificationTemplateSupportsEmail(id);
  const canUseStoredEmail = supportsEmail && storedEmailVersion === EMAIL_TEMPLATE_VERSION;
  return {
    id,
    label: fallback.label,
    description: fallback.description,
    emailSubject: supportsEmail ? (canUseStoredEmail ? clean(value?.emailSubject) || fallback.emailSubject : fallback.emailSubject) : "",
    emailHtml: supportsEmail ? (canUseStoredEmail ? clean(value?.emailHtml) || fallback.emailHtml : fallback.emailHtml) : "",
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
  let stored: Partial<Record<NotificationTemplateId, Partial<EditableNotificationTemplate>>> & { __emailTemplateVersion?: string } = {};

  if (record?.value) {
    try {
      stored = JSON.parse(record.value) as Partial<Record<NotificationTemplateId, Partial<EditableNotificationTemplate>>> & { __emailTemplateVersion?: string };
    } catch {
      stored = {};
    }
  }

  const storedEmailVersion = clean(stored.__emailTemplateVersion);
  return Object.fromEntries(notificationTemplateDefinitions.map((definition) => [definition.id, normaliseTemplate(definition.id, stored[definition.id], storedEmailVersion)])) as Record<NotificationTemplateId, EditableNotificationTemplate>;
}

export async function listNotificationTemplates() {
  const templates = await getNotificationTemplates();
  return notificationTemplateDefinitions.map((definition) => templates[definition.id]);
}

async function saveTemplates(next: Record<NotificationTemplateId, EditableNotificationTemplate>) {
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: JSON.stringify({ ...next, __emailTemplateVersion: EMAIL_TEMPLATE_VERSION }) },
    update: { value: JSON.stringify({ ...next, __emailTemplateVersion: EMAIL_TEMPLATE_VERSION }) },
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
    proof: { photo_url: input.proofPhotoUrl || "", signature_url: input.signaturePhotoUrl || "" },
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
    "{{ customer.name }}", "{{ order.number }}", "{{ order.items_summary }}", "{{ route.name }}", "{{ delivery.date }}", "{{ delivery.eta_start }}", "{{ delivery.eta_end }}", "{{ delivery.eta_slot }}", "{{ tracking.url }}", "{{ driver.name }}", "{{ driver.photo_url }}", "{{ driver.vehicle_name }}", "{{ driver.vehicle_registration }}", "{{ company.name }}", "{{ company.phone }}", "{{ company.email }}", "{{ company.logo_url }}", "{{ company.accent_colour }}", "{{ proof.photo_url }}", "{{ proof.signature_url }}", "{{ delay.minutes }}",
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
