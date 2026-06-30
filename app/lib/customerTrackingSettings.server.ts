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
  progressLineColour: string;
  vanLabel: string;
  vanBackgroundColour: string;
  vanTextColour: string;
  homeLabel: string;
  homeBackgroundColour: string;
  homeBorderColour: string;
  homeTextColour: string;
  previewItemOne: string;
  previewItemTwo: string;
  previewItemThree: string;
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
  progressLineColour: "#509AE6",
  vanLabel: "VAN",
  vanBackgroundColour: "#509AE6",
  vanTextColour: "#ffffff",
  homeLabel: "HOME",
  homeBackgroundColour: "#ffffff",
  homeBorderColour: "#16a34a",
  homeTextColour: "#16a34a",
  previewItemOne: "2 × White Marble Gloss Panels",
  previewItemTwo: "1 × Chrome End Cap Trim",
  previewItemThree: "2 × Soudal Grip All Adhesive",
  customFooterHtml: "",
  customCss: "",
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normaliseColour(value: string, fallback = defaultCustomerTrackingSettings.primaryColour) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
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
    progressLineColour: normaliseColour(clean(value?.progressLineColour), defaultCustomerTrackingSettings.progressLineColour),
    vanLabel: clean(value?.vanLabel) || defaultCustomerTrackingSettings.vanLabel,
    vanBackgroundColour: normaliseColour(clean(value?.vanBackgroundColour), defaultCustomerTrackingSettings.vanBackgroundColour),
    vanTextColour: normaliseColour(clean(value?.vanTextColour), defaultCustomerTrackingSettings.vanTextColour),
    homeLabel: clean(value?.homeLabel) || defaultCustomerTrackingSettings.homeLabel,
    homeBackgroundColour: normaliseColour(clean(value?.homeBackgroundColour), defaultCustomerTrackingSettings.homeBackgroundColour),
    homeBorderColour: normaliseColour(clean(value?.homeBorderColour), defaultCustomerTrackingSettings.homeBorderColour),
    homeTextColour: normaliseColour(clean(value?.homeTextColour), defaultCustomerTrackingSettings.homeTextColour),
    previewItemOne: clean(value?.previewItemOne) || defaultCustomerTrackingSettings.previewItemOne,
    previewItemTwo: clean(value?.previewItemTwo) || defaultCustomerTrackingSettings.previewItemTwo,
    previewItemThree: clean(value?.previewItemThree) || defaultCustomerTrackingSettings.previewItemThree,
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
