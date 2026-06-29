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

type RouteForNotifications = NonNullable<Awaited<ReturnType<typeof getRouteForNotifications>>>;
type StopForNotifications = RouteForNotifications["stops"][number];

type NotificationMarker = {
  stopIds?: string[];
  autoDelay?: boolean;
};

function trackingUrlForRoute(baseUrl: string, routeId: string, orderId: string) {
  const cleanBaseUrl = (baseUrl || "https://www.bathroompanelsdirect.co.uk").replace(/\/+$/, "");

  return `${cleanBaseUrl}/apps/track/${encodeURIComponent(routeId)}?order=${encodeURIComponent(orderId)}`;
}

function manualNotificationLabel(templateId: ManualRouteNotificationTemplateId) {
  if (templateId === "outForDelivery") return "Out for delivery";
  if (templateId === "nextDropTracking") return "You are next";
  return "Delay update";
}

function notificationAction(templateId: ManualRouteNotificationTemplateId) {
  return `${manualNotificationLabel(templateId)} sent`;
}

function notificationMarkerDetails(marker?: NotificationMarker) {
  const parts: string[] = [];

  if (marker?.stopIds?.length) {
    parts.push(marker.stopIds.map((stopId) => `stopId:${stopId}`).join(" "));
  }

  if (marker?.autoDelay) {
    parts.push("autoDelay:true");
  }

  return parts.length ? ` (${parts.join(" ")})` : "";
}

function hasNotificationHistory(route: RouteForNotifications, templateId: ManualRouteNotificationTemplateId, stopId: string, autoDelay = false) {
  const action = notificationAction(templateId);
  const stopMarker = `stopId:${stopId}`;

  return route.history.some((event) => (
    event.action === action &&
    (event.details || "").includes(stopMarker) &&
    (!autoDelay || (event.details || "").includes("autoDelay:true"))
  ));
}

async function getRouteForNotifications(routeId: string) {
  return prisma.route.findUnique({
    where: { id: routeId },
    include: {
      driver: true,
      history: true,
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
  });
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

function buildMessageInput(route: RouteForNotifications, stop: StopForNotifications, order: StopForNotifications["deliveryGroup"]["orders"][number], credentials: Awaited<ReturnType<typeof getAppCredentials>>, delayMinutes?: number | null) {
  return {
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
    delayMinutes,
  };
}

function etaGapMinutes(completedStop: StopForNotifications, nextStop: StopForNotifications, fallbackMinutes: number) {
  if (!completedStop.estimatedArrival || !nextStop.estimatedArrival) {
    return fallbackMinutes;
  }

  const gap = Math.round((new Date(nextStop.estimatedArrival).getTime() - new Date(completedStop.estimatedArrival).getTime()) / 60000);

  return Number.isFinite(gap) && gap > 0 ? gap : fallbackMinutes;
}

export async function sendBookedSlotNotifications(routeId: string): Promise<SendRouteNotificationsResult> {
  const [route, credentials, canSendSms, canSendEmail] = await Promise.all([
    getRouteForNotifications(routeId),
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
      const messageInput = buildMessageInput(route, stop, order, credentials);
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
  marker,
}: {
  routeId: string;
  templateId: ManualRouteNotificationTemplateId;
  stopId?: string | null;
  delayMinutes?: number | null;
  pendingOnly?: boolean;
  marker?: NotificationMarker;
}): Promise<SendRouteNotificationsResult> {
  const [route, credentials, canSendSms, canSendEmail] = await Promise.all([
    getRouteForNotifications(routeId),
    getAppCredentials(),
    isTwilioEnabled(),
    isResendEnabled(),
  ]);

  if (!route) {
    throw new Error("Route not found.");
  }

  if (route.status === "DRAFT") {
    throw new Error("Publish this route before sending this customer update.");
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
      const messageInput = buildMessageInput(route, stop, order, credentials, safeDelayMinutes);
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
  const stopIds = marker?.stopIds?.length ? marker.stopIds : stops.map((stop) => stop.id);

  await prisma.route.update({
    where: { id: routeId },
    data: {
      history: {
        create: {
          action: `${label} sent`,
          details: `${smsSent} SMS sent, ${emailsSent} emails sent, ${skipped} orders skipped${failed ? `, ${failed} failed` : ""}${notificationMarkerDetails({ ...marker, stopIds })}`,
        },
      },
    },
  });

  return { smsSent, emailsSent, skipped, failed, errors };
}

export async function sendFirstOutForDeliveryNotification(routeId: string) {
  const route = await getRouteForNotifications(routeId);

  if (!route) {
    throw new Error("Route not found.");
  }

  const firstPendingStop = route.stops.find((stop) => stop.status === "PENDING");

  if (!firstPendingStop) {
    return { smsSent: 0, emailsSent: 0, skipped: 0, failed: 0, errors: [] };
  }

  if (hasNotificationHistory(route, "outForDelivery", firstPendingStop.id)) {
    return { smsSent: 0, emailsSent: 0, skipped: 0, failed: 0, errors: [] };
  }

  return sendManualRouteNotification({
    routeId,
    templateId: "outForDelivery",
    stopId: firstPendingStop.id,
    pendingOnly: true,
    marker: { stopIds: [firstPendingStop.id] },
  });
}

export async function sendNextPendingStopNotification(routeId: string, completedStopId: string) {
  const route = await getRouteForNotifications(routeId);

  if (!route) {
    throw new Error("Route not found.");
  }

  const completedStop = route.stops.find((stop) => stop.id === completedStopId);

  if (!completedStop) {
    return { smsSent: 0, emailsSent: 0, skipped: 0, failed: 0, errors: [] };
  }

  const nextStop = route.stops.find((stop) => stop.status === "PENDING" && stop.orderIndex > completedStop.orderIndex);

  if (!nextStop) {
    return { smsSent: 0, emailsSent: 0, skipped: 0, failed: 0, errors: [] };
  }

  if (hasNotificationHistory(route, "nextDropTracking", nextStop.id)) {
    return { smsSent: 0, emailsSent: 0, skipped: 0, failed: 0, errors: [] };
  }

  const fallbackGap = Math.max(1, route.timePerDropMinutes || 10);
  const gapMinutes = etaGapMinutes(completedStop, nextStop, fallbackGap);
  const actualCompletion = completedStop.actualArrival ? new Date(completedStop.actualArrival) : new Date();
  const updatedEta = new Date(actualCompletion.getTime() + gapMinutes * 60 * 1000);

  await prisma.stop.update({
    where: { id: nextStop.id },
    data: { estimatedArrival: updatedEta },
  });

  return sendManualRouteNotification({
    routeId,
    templateId: "nextDropTracking",
    stopId: nextStop.id,
    pendingOnly: true,
    marker: { stopIds: [nextStop.id] },
  });
}

export async function sendAutomaticDelayNotifications(routeId: string) {
  const route = await getRouteForNotifications(routeId);

  if (!route || route.status !== "OUT_FOR_DELIVERY") {
    return { smsSent: 0, emailsSent: 0, skipped: 0, failed: 0, errors: [] };
  }

  const now = Date.now();
  const oneHourMs = 60 * 60 * 1000;
  const totals = { smsSent: 0, emailsSent: 0, skipped: 0, failed: 0, errors: [] as string[] };

  for (const stop of route.stops) {
    if (stop.status !== "PENDING" || !stop.estimatedArrival) {
      continue;
    }

    const lateMs = now - new Date(stop.estimatedArrival).getTime();

    if (lateMs < oneHourMs) {
      continue;
    }

    if (hasNotificationHistory(route, "delayUpdate", stop.id, true)) {
      continue;
    }

    const delayMinutes = Math.max(60, Math.round(lateMs / 60000));
    const result = await sendManualRouteNotification({
      routeId,
      templateId: "delayUpdate",
      stopId: stop.id,
      delayMinutes,
      pendingOnly: true,
      marker: { stopIds: [stop.id], autoDelay: true },
    });

    totals.smsSent += result.smsSent;
    totals.emailsSent += result.emailsSent;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
    totals.errors.push(...result.errors);
  }

  return totals;
}
