import prisma from "../db.server";

const EMAIL_NOTIFICATIONS_ENABLED_KEY = "email_notifications_enabled";

function normaliseEnabled(value: string | null | undefined) {
  if (value === "false") {
    return false;
  }

  return true;
}

export async function getEmailNotificationsEnabled() {
  const record = await prisma.setting.findUnique({
    where: {
      key: EMAIL_NOTIFICATIONS_ENABLED_KEY,
    },
  });

  return normaliseEnabled(record?.value);
}

export async function setEmailNotificationsEnabled(enabled: boolean) {
  await prisma.setting.upsert({
    where: {
      key: EMAIL_NOTIFICATIONS_ENABLED_KEY,
    },
    create: {
      key: EMAIL_NOTIFICATIONS_ENABLED_KEY,
      value: enabled ? "true" : "false",
    },
    update: {
      value: enabled ? "true" : "false",
    },
  });

  return enabled;
}
