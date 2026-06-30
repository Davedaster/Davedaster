import prisma from "../db.server";

export type CustomerTrackingSettings = {
  companyName: string;
  logoUrl: string;
  primaryColour: string;
  supportPhone: string;
  supportEmail: string;
  heroOutForDeliveryTitle: string;
  heroPlannedTitle: string;
  heroDeliveredTitle: string;
  heroAttemptedTitle: string;
  outForDeliveryMessage: string;
  notNextMessage: string;
  deliveredMessage: string;
  attemptedMessage: string;
  roomOfChoiceText: string;
  customFooterHtml: string;
  customCss: string;
};

const SETTINGS_KEY = "customer_tracking_page_settings";

export const defaultCustomerTrackingSettings: CustomerTrackingSettings = {
  companyName: "Bathroom Panels Direct",
  logoUrl: "",
  primaryColour: "#509AE6",
  supportPhone: "",
  supportEmail: "deliveries@bathroompanelsdirect.co.uk",
  heroOutForDeliveryTitle: "Your panels are out for delivery",
  heroPlannedTitle: "Your panel delivery is planned",
  heroDeliveredTitle: "Your panels have been delivered",
  heroAttemptedTitle: "We attempted your panel delivery",
  outForDeliveryMessage: "Your driver is on the way. Keep this page open for the latest update.",
  notNextMessage: "Your panels are on today’s route. Live progress appears when your delivery is next.",
  deliveredMessage: "Your panel delivery has been completed. Thank you for shopping with us.",
  attemptedMessage: "Our team has recorded an attempted delivery. Please contact us and we will help with the next step.",
  roomOfChoiceText: "Our own team will bring your order to a room of your choice where access allows.",
  customFooterHtml: "",
  customCss: "",
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normaliseColour(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : defaultCustomerTrackingSettings.primaryColour;
}

function normaliseSettings(value: Partial<CustomerTrackingSettings> | null | undefined): CustomerTrackingSettings {
  return {
    companyName: clean(value?.companyName) || defaultCustomerTrackingSettings.companyName,
    logoUrl: clean(value?.logoUrl),
    primaryColour: normaliseColour(clean(value?.primaryColour) || defaultCustomerTrackingSettings.primaryColour),
    supportPhone: clean(value?.supportPhone),
    supportEmail: clean(value?.supportEmail) || defaultCustomerTrackingSettings.supportEmail,
    heroOutForDeliveryTitle: clean(value?.heroOutForDeliveryTitle) || defaultCustomerTrackingSettings.heroOutForDeliveryTitle,
    heroPlannedTitle: clean(value?.heroPlannedTitle) || defaultCustomerTrackingSettings.heroPlannedTitle,
    heroDeliveredTitle: clean(value?.heroDeliveredTitle) || defaultCustomerTrackingSettings.heroDeliveredTitle,
    heroAttemptedTitle: clean(value?.heroAttemptedTitle) || defaultCustomerTrackingSettings.heroAttemptedTitle,
    outForDeliveryMessage: clean(value?.outForDeliveryMessage) || defaultCustomerTrackingSettings.outForDeliveryMessage,
    notNextMessage: clean(value?.notNextMessage) || defaultCustomerTrackingSettings.notNextMessage,
    deliveredMessage: clean(value?.deliveredMessage) || defaultCustomerTrackingSettings.deliveredMessage,
    attemptedMessage: clean(value?.attemptedMessage) || defaultCustomerTrackingSettings.attemptedMessage,
    roomOfChoiceText: clean(value?.roomOfChoiceText) || defaultCustomerTrackingSettings.roomOfChoiceText,
    customFooterHtml: clean(value?.customFooterHtml),
    customCss: clean(value?.customCss),
  };
}

export async function getCustomerTrackingSettings() {
  const record = await prisma.setting.findUnique({
    where: {
      key: SETTINGS_KEY,
    },
  });

  if (!record) {
    return defaultCustomerTrackingSettings;
  }

  try {
    return normaliseSettings(JSON.parse(record.value) as Partial<CustomerTrackingSettings>);
  } catch {
    return defaultCustomerTrackingSettings;
  }
}

export async function saveCustomerTrackingSettings(input: Partial<CustomerTrackingSettings>) {
  const current = await getCustomerTrackingSettings();
  const next = normaliseSettings({
    ...current,
    ...input,
  });

  await prisma.setting.upsert({
    where: {
      key: SETTINGS_KEY,
    },
    create: {
      key: SETTINGS_KEY,
      value: JSON.stringify(next),
    },
    update: {
      value: JSON.stringify(next),
    },
  });

  return next;
}
