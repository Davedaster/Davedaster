import prisma from "../db.server";
import { getAppCredentials } from "./appCredentials.server";
import { sendEmailWithResend, sendSmsWithTwilio, isResendEnabled, isTwilioEnabled } from "./notificationSenders.server";
import { buildBookedSlotMessage, buildDelayMessage, buildNextDropTrackingMessage, buildOutForDeliveryMessage, type NotificationChannel, type NotificationMessage } from "./notificationTemplates.server";

type SendRouteNotificationsResult = {
  smsSent: number;
  emailsSent: number;
  skipped: number;
  failed: number;
  errors: string[];
};

export type ManualRouteNotificationTemplateId = "outForDelivery" | "nextDropTracking" | "delayUpdate";

function trackingUrlForRoute(baseUrl: string, routeId: string, orderId: string) {
  const cleanBaseUrl = (baseUrl || "https://www.bathroompanelsdirect.co.uk").replace(/\/+$/, "");

  return `${cleanBaseUrl}/apps/track/${encodeURIComponent(routeId)}?order=${encodeURIComponent(orderId)}`;
}

function manualNotificationLabel(templateId: ManualRouteNotificationTemplateId) {
  if (templateId === "outForDelivery") return "Out for delivery";
  if (templateId === "nextDropTracking") return "You are next";
  return "Delay update";
}

async function buildManualNotificationMessage(templateId: ManualRouteNotificationTemplateId, input: Record<string, unknown>, channel: NotificationChannel): Promise<NotificationMessage> {
  if (templateId === "outForDelivery") {
    return buildOutForDeliveryMessage(input, channel);
  }

  if (templateId === "nextDropTracking") {
    return buildNextDropTrackingMessage(input, channel);
  }

  return buildDelayMessage(input, channel);
}

export async function sendBookedSlotNotifications(routeId: string): Promise<SendRouteNotificationsResult> {
  const [route, credentials, canSendSms, canSendEmail] = await Promise.all([
    prisma.route.findUnique({
      where: { id: routeId },
      include: {
        driver: true,
        stops: {
          include: {
            deliveryGroup: {
              include: {
                orders: true,
              },
            },
          },
          orderBy: {
            orderIndex: "asc",
          },
        },
      },
    }),
    getAppCredentials(),
    isTwilioEnabled(),
    isResendEnabled(),
  ]);

  if (!route) {
    throw new Error("Route not found.");
  }

  if (route.status === "DRAFT") {
    throw new Error("Publish the route before sending customer notifications.");
  }

  if (route.notificationsSent) {
    throw new Error("Customer notifications have already been sent for this route.");
  }

  if (!canSendSms && !canSendEmail) {
    throw new Error("Twilio and Resend are not set up yet. Add them in Settings, API Credentials before sending messages.");
  }

  let smsSent = 0;
  let emailsSent = 0;
  let skipped = 0;

  for (const stop of route.stops) {
    const orders = stop.deliveryGroup?.orders || [];

    for (const order of orders) {
      const messageInput = {
        customerName: order.customerName,
        orderNumber: order.shopifyOrderNumber,
        itemsSummary: order.lineItemSummary,
        routeName: route.name,
        driverName: route.driver?.name,
        driverPhotoUrl: route.driver?.photoUrl,
        driverVehicleName: route.driver?.vehicleName,
        driverVehicleRegistration: route.driver?.vehicleRegistration,
        deliveryDate: route.date,
        estimatedArrival: stop.estimatedArrival,
        slotMinutes: route.customerSlotMinutes,
        trackingUrl: trackingUrlForRoute(credentials.shopPublicUrl, route.id, order.shopifyOrderId),
      };

      let sentAnything = false;

      if (canSendSms && order.customerPhone) {
        await sendSmsWithTwilio({
          to: order.customerPhone,
          message: await buildBookedSlotMessage(messageInput, "sms"),
        });
        smsSent += 1;
        sentAnything = true;
      }

      if (canSendEmail && order.customerEmail) {
        await sendEmailWithResend({
          to: order.customerEmail,
          message: await buildBookedSlotMessage(messageInput, "email"),
        });
        emailsSent += 1;
        sentAnything = true;
      }

      if (!sentAnything) {
        skipped += 1;
      }
    }
  }

  await prisma.route.update({
    where: { id: routeId },
    data: {
      status: "NOTIFICATIONS_SENT",
      notificationsSent: true,
      history: {
        create: {
          action: "Notifications sent",
          details: `${smsSent} SMS sent, ${emailsSent} emails sent, ${skipped} orders skipped`,
        },
      },
    },
  });

  return { smsSent, emailsSent, skipped, failed: 0, errors: [] };
}

export async function sendManualRouteNotification({
  routeId,
  templateId,
  stopId,
  delayMinutes,
  pendingOnly = false,
}: {
  routeId: string;
  templateId: ManualRouteNotificationTemplateId;
  stopId?: string | null;
  delayMinutes?: number | null;
  pendingOnly?: boolean;
}): Promise<SendRouteNotificationsResult> {
  const [route, credentials, canSendSms, canSendEmail] = await Promise.all([
    prisma.route.findUnique({
      where: { id: routeId },
      include: {
        driver: true,
        stops: {
          include: {
            deliveryGroup: {
              include: {
                orders: true,
              },
            },
          },
          orderBy: {
            orderIndex: "asc",
          },
        },
      },
    }),
    getAppCredentials(),
    isTwilioEnabled(),
    isResendEnabled(),
  ]);

  if (!route) {
    throw new Error("Route not found.");
  }

  if (route.status === "DRAFT") {
    throw new Error("Publish the route before sending this customer update.");
  }

  if (!canSendSms && !canSendEmail) {
    throw new Error("Twilio and Resend are not set up yet. Add them in Settings, API Credentials before sending messages.");
  }

  if (templateId === "nextDropTracking" && !stopId) {
    throw new Error("Choose which stop is next before sending this message.");
  }

  let stops = route.stops;

  if (stopId) {
    stops = stops.filter((stop) => stop.id === stopId);
  }

  if (pendingOnly) {
    stops = stops.filter((stop) => stop.status === "PENDING");
  }

  if (templateId === "nextDropTracking" && stops.some((stop) => stop.status !== "PENDING")) {
    throw new Error("The next drop message can only be sent to a pending stop.");
  }

  if (!stops.length) {
    throw new Error("There are no matching stops to message.");
  }

  let smsSent = 0;
  let emailsSent = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  const safeDelayMinutes = Number.isFinite(delayMinutes || 0) && Number(delayMinutes) > 0 ? Number(delayMinutes) : 45;

  for (const stop of stops) {
    const orders = stop.deliveryGroup?.orders || [];

    for (const order of orders) {
      const messageInput = {
        customerName: order.customerName,
        orderNumber: order.shopifyOrderNumber,
        itemsSummary: order.lineItemSummary,
        routeName: route.name,
        driverName: route.driver?.name,
        driverPhotoUrl: route.driver?.photoUrl,
        driverVehicleName: route.driver?.vehicleName,
        driverVehicleRegistration: route.driver?.vehicleRegistration,
        deliveryDate: route.date,
        estimatedArrival: stop.estimatedArrival,
        slotMinutes: route.customerSlotMinutes,
        trackingUrl: trackingUrlForRoute(credentials.shopPublicUrl, route.id, order.shopifyOrderId),
        delayMinutes: safeDelayMinutes,
      };

      let sentAnything = false;
      let attemptedAnything = false;

      if (canSendSms && order.customerPhone) {
        attemptedAnything = true;
        try {
          await sendSmsWithTwilio({
            to: order.customerPhone,
            message: await buildManualNotificationMessage(templateId, messageInput, "sms"),
          });
          smsSent += 1;
          sentAnything = true;
        } catch (error) {
          failed += 1;
          errors.push(`${order.shopifyOrderNumber} SMS failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }

      if (canSendEmail && order.customerEmail) {
        attemptedAnything = true;
        try {
          await sendEmailWithResend({
            to: order.customerEmail,
            message: await buildManualNotificationMessage(templateId, messageInput, "email"),
          });
          emailsSent += 1;
          sentAnything = true;
        } catch (error) {
          failed += 1;
          errors.push(`${order.shopifyOrderNumber} email failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }

      if (!attemptedAnything || (!sentAnything && attemptedAnything)) {
        skipped += 1;
      }
    }
  }

  const label = manualNotificationLabel(templateId);

  await prisma.route.update({
    where: { id: routeId },
    data: {
      history: {
        create: {
          action: `${label} sent`,
          details: `${smsSent} SMS sent, ${emailsSent} emails sent, ${skipped} orders skipped${failed ? `, ${failed} failed` : ""}`,
        },
      },
    },
  });

  return { smsSent, emailsSent, skipped, failed, errors };
}
