import { buildShortCustomerTrackingUrl, ensureCustomerTrackingCode, getPublicAppBaseUrl } from "./customerTracking.server";
import { getAppCredentials } from "./appCredentials.server";
import { isResendEnabled, isTwilioEnabled, sendEmailWithResend, sendSmsWithTwilio } from "./notificationSenders.server";
import { buildDeliveryCompleteMessage } from "./notificationTemplates.server";

type DeliveryCompleteOrder = {
  id?: string;
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

async function trackingUrlForOrder(baseUrl: string, order: DeliveryCompleteOrder) {
  if (!order.id) {
    return getPublicAppBaseUrl(baseUrl);
  }

  const trackingCode = await ensureCustomerTrackingCode(order.id);
  return buildShortCustomerTrackingUrl(baseUrl, trackingCode);
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
    const trackingUrl = await trackingUrlForOrder(getPublicAppBaseUrl(credentials.shopPublicUrl), order);
    const baseMessageInput = {
      customerName: order.customerName,
      orderNumber: order.shopifyOrderNumber,
      routeName: input.routeName,
      trackingUrl,
    };

    let sentAnything = false;
    let attemptedAnything = false;

    if (canSendSms && order.customerPhone) {
      attemptedAnything = true;
      try {
        await sendSmsWithTwilio({
          to: order.customerPhone,
          message: await buildDeliveryCompleteMessage({
            ...baseMessageInput,
            proofPhotoUrl: null,
            signaturePhotoUrl: null,
          }, "sms"),
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
          message: await buildDeliveryCompleteMessage({
            ...baseMessageInput,
            proofPhotoUrl: input.proofPhotoUrl,
            signaturePhotoUrl: input.signaturePhotoUrl,
          }, "email"),
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
