import prisma from "../db.server";
import { getAppCredentials } from "./appCredentials.server";
import { sendEmailWithResend, sendSmsWithTwilio, isResendEnabled, isTwilioEnabled } from "./notificationSenders.server";
import { buildBookedSlotMessage } from "./notificationTemplates.server";

type SendRouteNotificationsResult = {
  smsSent: number;
  emailsSent: number;
  skipped: number;
};

function trackingUrlForRoute(baseUrl: string, routeId: string, orderId: string) {
  const cleanBaseUrl = (baseUrl || "https://www.bathroompanelsdirect.co.uk").replace(/\/+$/, "");

  return `${cleanBaseUrl}/apps/track/${encodeURIComponent(routeId)}?order=${encodeURIComponent(orderId)}`;
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

  return { smsSent, emailsSent, skipped };
}
