import prisma from "../db.server";
import { sendEmailWithResend, sendSmsWithTwilio, isResendEnabled, isTwilioEnabled } from "./notificationSenders.server";
import { buildBookedSlotMessage } from "./notificationTemplates.server";

type SendRouteNotificationsResult = {
  smsSent: number;
  emailsSent: number;
  skipped: number;
};

function trackingUrlForRoute(routeId: string, orderId: string) {
  const baseUrl = process.env.SHOP_PUBLIC_URL || "https://www.bathroompanelsdirect.co.uk";
  return `${baseUrl}/apps/track/${encodeURIComponent(routeId)}?order=${encodeURIComponent(orderId)}`;
}

export async function sendBookedSlotNotifications(routeId: string): Promise<SendRouteNotificationsResult> {
  const route = await prisma.route.findUnique({
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
  });

  if (!route) {
    throw new Error("Route not found.");
  }

  const canSendSms = isTwilioEnabled();
  const canSendEmail = isResendEnabled();

  if (!canSendSms && !canSendEmail) {
    throw new Error("Twilio and Resend are not set up yet. Add the notification environment variables before sending messages.");
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
        routeName: route.name,
        driverName: route.driver?.name,
        deliveryDate: route.date,
        estimatedArrival: stop.estimatedArrival,
        slotMinutes: 60,
        trackingUrl: trackingUrlForRoute(route.id, order.shopifyOrderId),
      };

      let sentAnything = false;

      if (canSendSms && order.customerPhone) {
        await sendSmsWithTwilio({
          to: order.customerPhone,
          message: buildBookedSlotMessage(messageInput, "sms"),
        });
        smsSent += 1;
        sentAnything = true;
      }

      if (canSendEmail && order.customerEmail) {
        await sendEmailWithResend({
          to: order.customerEmail,
          message: buildBookedSlotMessage(messageInput, "email"),
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

  return { smsSent, emailsSent, skipped };
}
