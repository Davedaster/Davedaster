import prisma from "../db.server";
import { getAppCredentials } from "./appCredentials.server";
import { buildShortCustomerTrackingUrl, ensureCustomerTrackingCode, getPublicAppBaseUrl } from "./customerTracking.server";
import { sendEmailWithResend, sendSmsWithTwilio, isResendEnabled, isTwilioEnabled } from "./notificationSenders.server";
import { buildBookedSlotMessage, buildDelayMessage, buildNextDropTrackingMessage, buildOutForDeliveryMessage, type NotificationChannel, type NotificationMessage, type NotificationTemplateInput } from "./notificationTemplates.server";
import { calculateEtaSlots } from "./routeDrafts.server";

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
type OrderForNotifications = NonNullable<StopForNotifications["deliveryGroup"]>["orders"][number];

type NotificationMarker = {
  stopIds?: string[];
  autoDelay?: boolean;
};

type BookedSlotChannel = "sms" | "email";

type RouteHistoryCreateInput = {
  action: string;
  details: string;
};

const EARLIEST_OUT_FOR_DELIVERY_HOUR = 7;
const EARLIEST_OUT_FOR_DELIVERY_MINUTE = 30;

function emptyNotificationResult(): SendRouteNotificationsResult {
  return { smsSent: 0, emailsSent: 0, skipped: 0, failed: 0, errors: [] };
}

function ukClockMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
    timeZone: "Europe/London",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);

  return hour * 60 + minute;
}

function canSendOutForDeliveryNow(now = new Date()) {
  return ukClockMinutes(now) >= (EARLIEST_OUT_FOR_DELIVERY_HOUR * 60) + EARLIEST_OUT_FOR_DELIVERY_MINUTE;
}

function manualNotificationLabel(templateId: ManualRouteNotificationTemplateId) {
  if (templateId === "outForDelivery") return "Out for delivery";
  if (templateId === "nextDropTracking") return "You are next";
  return "Delay update";
}

function notificationAction(templateId: ManualRouteNotificationTemplateId) {
  return `${manualNotificationLabel(templateId)} sent`;
}

function shouldSendCustomerEmail(templateId: ManualRouteNotificationTemplateId) {
  return templateId !== "delayUpdate";
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

function bookedSlotRecipientMarker(orderId: string, channel: BookedSlotChannel) {
  return `bookedSlot orderId:${orderId} channel:${channel}`;
}

function hasBookedSlotRecipientHistory(route: RouteForNotifications, orderId: string, channel: BookedSlotChannel) {
  const marker = bookedSlotRecipientMarker(orderId, channel);

  return route.history.some((event) => event.action === "Booked slot recipient notified" && (event.details || "").includes(marker));
}

function notificationErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown notification error";
}

async function getRouteForNotifications(routeId: string) {
  return prisma.route.findUnique({
    where: { id: routeId },
    include: {
      driver: true,
      history: true,
      stops: {
        include: {
          returnTickets: {
            include: {
              lines: {
                orderBy: {
                  createdAt: "asc",
                },
              },
            },
            orderBy: {
              createdAt: "asc",
            },
          },
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

async function buildManualNotificationMessage(templateId: ManualRouteNotificationTemplateId, input: NotificationTemplateInput, channel: NotificationChannel): Promise<NotificationMessage> {
  if (templateId === "outForDelivery") {
    return buildOutForDeliveryMessage(input, channel);
  }

  if (templateId === "nextDropTracking") {
    return buildNextDropTrackingMessage(input, channel);
  }

  return buildDelayMessage(input, channel);
}

function isCollectionStop(stop: StopForNotifications) {
  return Boolean(stop.returnTickets?.length);
}

function collectionItemsSummary(stop: StopForNotifications) {
  const itemLines = (stop.returnTickets || []).flatMap((ticket) => ticket.lines.map((line) => {
    const quantity = Number(line.quantityExpected || 1);
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1;
    return `${safeQuantity} × ${line.itemName}`;
  }));

  return itemLines.join(", ");
}

async function buildMessageInput(route: RouteForNotifications, stop: StopForNotifications, order: OrderForNotifications, credentials: Awaited<ReturnType<typeof getAppCredentials>>, delayMinutes?: number | null): Promise<NotificationTemplateInput> {
  const trackingCode = await ensureCustomerTrackingCode(order.id);
  const isCollection = isCollectionStop(stop);

  return {
    customerName: order.customerName,
    orderNumber: order.shopifyOrderNumber,
    itemsSummary: isCollection ? collectionItemsSummary(stop) || order.lineItemSummary : order.lineItemSummary,
    routeName: route.name,
    driverName: route.driver?.name,
    driverPhotoUrl: route.driver?.photoUrl,
    driverVehicleName: route.driver?.vehicleName,
    driverVehicleRegistration: route.driver?.vehicleRegistration,
    deliveryDate: route.date,
    estimatedArrival: stop.estimatedArrival,
    slotMinutes: route.customerSlotMinutes,
    trackingUrl: buildShortCustomerTrackingUrl(getPublicAppBaseUrl(credentials.shopPublicUrl), trackingCode),
    delayMinutes,
    serviceType: isCollection ? "collection" : "delivery",
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
  const [credentials, canSendSms, canSendEmail] = await Promise.all([
    getAppCredentials(),
    isTwilioEnabled(),
    isResendEnabled(),
  ]);
  let route = await getRouteForNotifications(routeId);

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

  await calculateEtaSlots(routeId);
  route = await getRouteForNotifications(routeId);

  if (!route) {
    throw new Error("Route not found after recalculating customer ETAs.");
  }

  if (route.notificationsSent) {
    throw new Error("Customer notifications have already been sent for this route.");
  }

  let smsSent = 0;
  let emailsSent = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  const successfulRecipientLogs: RouteHistoryCreateInput[] = [];

  for (const stop of route.stops) {
    const orders = stop.deliveryGroup?.orders || [];

    for (const order of orders) {
      const messageInput = await buildMessageInput(route, stop, order, credentials);
      let hasAvailableChannel = false;
      let attemptedAnything = false;
      let sentAnything = false;

      if (canSendSms && order.customerPhone) {
        hasAvailableChannel = true;

        if (!hasBookedSlotRecipientHistory(route, order.id, "sms")) {
          attemptedAnything = true;

          try {
            await sendSmsWithTwilio({
              to: order.customerPhone,
              message: await buildBookedSlotMessage(messageInput, "sms"),
            });
            smsSent += 1;
            sentAnything = true;
            successfulRecipientLogs.push({
              action: "Booked slot recipient notified",
              details: `${bookedSlotRecipientMarker(order.id, "sms")} order:${order.shopifyOrderNumber} to:${order.customerPhone}`,
            });
          } catch (error) {
            failed += 1;
            errors.push(`${order.shopifyOrderNumber} SMS failed: ${notificationErrorMessage(error)}`);
          }
        }
      }

      if (canSendEmail && order.customerEmail) {
        hasAvailableChannel = true;

        if (!hasBookedSlotRecipientHistory(route, order.id, "email")) {
          attemptedAnything = true;

          try {
            await sendEmailWithResend({
              to: order.customerEmail,
              message: await buildBookedSlotMessage(messageInput, "email"),
            });
            emailsSent += 1;
            sentAnything = true;
            successfulRecipientLogs.push({
              action: "Booked slot recipient notified",
              details: `${bookedSlotRecipientMarker(order.id, "email")} order:${order.shopifyOrderNumber} to:${order.customerEmail}`,
            });
          } catch (error) {
            failed += 1;
            errors.push(`${order.shopifyOrderNumber} email failed: ${notificationErrorMessage(error)}`);
          }
        }
      }

      if (!hasAvailableChannel || (!attemptedAnything && !sentAnything)) {
        skipped += 1;
      }
    }
  }

  const summaryAction = failed ? "Notifications partially sent" : "Notifications sent";
  const summaryDetails = `${smsSent} SMS sent, ${emailsSent} emails sent, ${skipped} orders skipped${failed ? `, ${failed} failed. Errors: ${errors.join(" | ")}` : ""}`;

  await prisma.route.update({
    where: { id: routeId },
    data: {
      ...(failed ? {} : { status: "NOTIFICATIONS_SENT", notificationsSent: true }),
      history: {
        create: [
          ...successfulRecipientLogs,
          {
            action: summaryAction,
            details: summaryDetails,
          },
        ],
      },
    },
  });

  return { smsSent, emailsSent, skipped, failed, errors };
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
  const sendCustomerEmail = shouldSendCustomerEmail(templateId);

  if (!route) {
    throw new Error("Route not found.");
  }

  if (route.status === "DRAFT") {
    throw new Error("Publish this route before sending this customer update.");
  }

  if (!canSendSms && (!canSendEmail || !sendCustomerEmail)) {
    throw new Error("Twilio SMS is not set up yet. Add it in Settings, Notifications before sending this update.");
  }

  if (!canSendSms && !canSendEmail) {
    throw new Error("Twilio and Resend are not set up yet. Add them in Settings, Notifications before sending messages.");
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
      const messageInput = await buildMessageInput(route, stop, order, credentials, safeDelayMinutes);
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

      if (sendCustomerEmail && canSendEmail && order.customerEmail) {
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

  if (route.status !== "OUT_FOR_DELIVERY") {
    return emptyNotificationResult();
  }

  const firstPendingStop = route.stops.find((stop) => stop.status === "PENDING");

  if (!firstPendingStop) {
    return emptyNotificationResult();
  }

  if (hasNotificationHistory(route, "outForDelivery", firstPendingStop.id)) {
    return emptyNotificationResult();
  }

  if (!canSendOutForDeliveryNow()) {
    return emptyNotificationResult();
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

  if (!nextStop.estimatedArrival) {
    const fallbackGap = Math.max(1, route.timePerDropMinutes || 10);
    const gapMinutes = etaGapMinutes(completedStop, nextStop, fallbackGap);
    const actualCompletion = completedStop.actualArrival ? new Date(completedStop.actualArrival) : new Date();
    const updatedEta = new Date(actualCompletion.getTime() + gapMinutes * 60 * 1000);

    await prisma.stop.update({
      where: { id: nextStop.id },
      data: { estimatedArrival: updatedEta },
    });
  }

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
