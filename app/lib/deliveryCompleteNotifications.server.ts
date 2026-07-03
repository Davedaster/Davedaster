import { buildShortCustomerTrackingUrl, ensureCustomerTrackingCode, getPublicAppBaseUrl } from "./customerTracking.server";
import { getAppCredentials } from "./appCredentials.server";
import { isResendEnabled, isTwilioEnabled, sendEmailWithResend, sendSmsWithTwilio } from "./notificationSenders.server";
import { buildDeliveryCompleteMessage, buildSafePlaceDeliveryCompleteSms } from "./notificationTemplates.server";

const GOOGLE_REVIEW_URL = "https://g.page/r/CZDHYoyjIf6CEAE/review";
const COMPANY_PHONE = "01803 222784";

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
  leftInSafePlace?: boolean;
  orders: DeliveryCompleteOrder[];
};

type DeliveryCompleteResult = {
  smsSent: number;
  emailsSent: number;
  skipped: number;
  failed: number;
  errors: string[];
};

function customerDisplayName(name?: string | null) {
  return name?.trim() || "there";
}

function buildReceivedDeliveryCompleteSms(order: DeliveryCompleteOrder) {
  return {
    body: `Hi ${customerDisplayName(order.customerName)}, your Bathroom Panels Direct delivery for ${order.shopifyOrderNumber} has been completed. Thank you for your order.\n\nIf you're happy with the service, a quick Google review really helps our family business: ${GOOGLE_REVIEW_URL}\n\nNeed help? Call ${COMPANY_PHONE}`,
  };
}

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
      leftInSafePlace: input.leftInSafePlace,
    };

    let sentAnything = false;
    let attemptedAnything = false;

    if (canSendSms && order.customerPhone) {
      attemptedAnything = true;
      try {
        await sendSmsWithTwilio({
          to: order.customerPhone,
          message: input.leftInSafePlace
            ? await buildSafePlaceDeliveryCompleteSms(baseMessageInput)
            : buildReceivedDeliveryCompleteSms(order),
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
