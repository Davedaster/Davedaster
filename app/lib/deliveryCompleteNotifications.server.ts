import { isResendEnabled, isTwilioEnabled, sendEmailWithResend, sendSmsWithTwilio } from "./notificationSenders.server";
import { buildDeliveryCompleteMessage } from "./notificationTemplates.server";

type DeliveryCompleteOrder = {
  shopifyOrderNumber: string;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
};

type DeliveryCompleteInput = {
  routeName: string;
  proofPhotoUrl?: string | null;
  orders: DeliveryCompleteOrder[];
};

type DeliveryCompleteResult = {
  smsSent: number;
  emailsSent: number;
  skipped: number;
};

export async function sendDeliveryCompleteNotifications(input: DeliveryCompleteInput): Promise<DeliveryCompleteResult> {
  const canSendSms = isTwilioEnabled();
  const canSendEmail = isResendEnabled();

  if (!canSendSms && !canSendEmail) {
    return {
      smsSent: 0,
      emailsSent: 0,
      skipped: input.orders.length,
    };
  }

  let smsSent = 0;
  let emailsSent = 0;
  let skipped = 0;

  for (const order of input.orders) {
    const messageInput = {
      customerName: order.customerName,
      orderNumber: order.shopifyOrderNumber,
      routeName: input.routeName,
      proofPhotoUrl: input.proofPhotoUrl,
    };

    let sentAnything = false;

    if (canSendSms && order.customerPhone) {
      await sendSmsWithTwilio({
        to: order.customerPhone,
        message: buildDeliveryCompleteMessage(messageInput, "sms"),
      });
      smsSent += 1;
      sentAnything = true;
    }

    if (canSendEmail && order.customerEmail) {
      await sendEmailWithResend({
        to: order.customerEmail,
        message: buildDeliveryCompleteMessage(messageInput, "email"),
      });
      emailsSent += 1;
      sentAnything = true;
    }

    if (!sentAnything) {
      skipped += 1;
    }
  }

  return {
    smsSent,
    emailsSent,
    skipped,
  };
}
