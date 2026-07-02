import { getAppCredentials } from "./appCredentials.server";
import { isResendEnabled, isTwilioEnabled, sendEmailWithResend, sendSmsWithTwilio } from "./notificationSenders.server";
import { buildDeliveryCompleteMessage } from "./notificationTemplates.server";

type DeliveryCompleteOrder = {
  shopifyOrderId: string;
  shopifyOrderNumber: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
};

type DeliveryCompleteInput = {
  routeId: string;
  routeName: string;
  proofPhotoUrl?: string | null;
  signaturePhotoUrl?: string | null;
  orders: DeliveryCompleteOrder[];
};

type DeliveryCompleteResult = {
  smsSent: number;
  emailsSent: number;
  skipped: number;
  failed: number;
  errors: string[];
};

function trackingUrlForRoute(baseUrl: string, routeId: string, orderId: string) {
  const cleanBaseUrl = (baseUrl || "https://www.bathroompanelsdirect.co.uk").replace(/\/+$/, "");

  return `${cleanBaseUrl}/apps/track/${encodeURIComponent(routeId)}?order=${encodeURIComponent(orderId)}`;
}

function cleanCustomerName(value?: string | null) {
  return value?.trim() || "there";
}

function buildDeliveryCompleteSmsBody(input: { customerName?: string | null; orderNumber: string; trackingUrl: string }) {
  return `Hi ${cleanCustomerName(input.customerName)}, your delivery for ${input.orderNumber} has been completed. Thank you for your order. View delivery details here: ${input.trackingUrl}`;
}

export async function sendDeliveryCompleteNotifications(input: DeliveryCompleteInput): Promise<DeliveryCompleteResult> {
  const [canSendSms, canSendEmail, credentials] = await Promise.all([
    isTwilioEnabled(),
    isResendEnabled(),
    getAppCredentials(),
  ]);

  if (!canSendSms && !canSendEmail) {
    return {
      smsSent: 0,
      emailsSent: 0,
      skipped: input.orders.length,
      failed: 0,
      errors: [],
    };
  }

  let smsSent = 0;
  let emailsSent = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const order of input.orders) {
    const trackingUrl = trackingUrlForRoute(credentials.shopPublicUrl, input.routeId, order.shopifyOrderId);
    const messageInput = {
      customerName: order.customerName,
      orderNumber: order.shopifyOrderNumber,
      routeName: input.routeName,
      proofPhotoUrl: input.proofPhotoUrl,
      signaturePhotoUrl: input.signaturePhotoUrl,
      trackingUrl,
    };

    let sentAnything = false;
    let attemptedAnything = false;

    if (canSendSms && order.customerPhone) {
      attemptedAnything = true;
      try {
        const smsMessage = await buildDeliveryCompleteMessage(messageInput, "sms");
        smsMessage.body = buildDeliveryCompleteSmsBody({
          customerName: order.customerName,
          orderNumber: order.shopifyOrderNumber,
          trackingUrl,
        });

        await sendSmsWithTwilio({
          to: order.customerPhone,
          message: smsMessage,
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
          message: await buildDeliveryCompleteMessage(messageInput, "email"),
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

  return {
    smsSent,
    emailsSent,
    skipped,
    failed,
    errors,
  };
}
