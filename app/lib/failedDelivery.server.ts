import prisma from "../db.server";
import { getAppCredentials } from "./appCredentials.server";
import { buildShortCustomerTrackingUrl, ensureCustomerTrackingCode, getPublicAppBaseUrl } from "./customerTracking.server";
import { sendEmailWithResend, sendSmsWithTwilio, isResendEnabled, isTwilioEnabled } from "./notificationSenders.server";
import { sendNextPendingStopNotification } from "./routeNotifications.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type ShopifyUserError = {
  field?: string[];
  message: string;
};

type TagsAddPayload = {
  data?: {
    tagsAdd?: {
      userErrors?: ShopifyUserError[];
    };
  };
  errors?: Array<{ message: string }>;
};

const TAGS_ADD_MUTATION = `#graphql
  mutation AddOrderTags($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }
`;

function throwGraphQLErrors(payload: { errors?: Array<{ message: string }> }) {
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join(", "));
  }
}

function throwUserErrors(userErrors?: ShopifyUserError[]) {
  if (userErrors?.length) {
    throw new Error(userErrors.map((error) => error.message).join(", "));
  }
}

function tidyReasonForTag(reason: string) {
  return reason.replace(/\s+/g, " ").trim().slice(0, 80);
}

function shopifyErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Shopify error";
}

function notificationErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown notification error";
}

function displayName(value?: string | null) {
  return value?.trim() || "there";
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function buildFailedDeliverySms(input: { customerName?: string | null; orderNumber: string; reason: string; trackingUrl: string }) {
  return {
    body: `Hi ${displayName(input.customerName)}, we attempted your Bathroom Panels Direct delivery for ${input.orderNumber} but could not complete it. Reason: ${input.reason}. View the update here: ${input.trackingUrl}`,
  };
}

function buildFailedDeliveryEmail(input: { customerName?: string | null; orderNumber: string; reason: string; trackingUrl: string }) {
  const customerName = escapeHtml(displayName(input.customerName));
  const orderNumber = escapeHtml(input.orderNumber);
  const reason = escapeHtml(input.reason);
  const trackingUrl = escapeHtml(input.trackingUrl);

  return {
    subject: `Delivery attempted, ${orderNumber}`,
    body: `Hi ${displayName(input.customerName)},\n\nWe attempted your Bathroom Panels Direct delivery for ${input.orderNumber}, but could not complete it.\n\nReason: ${input.reason}\n\nYou can view the update here: ${input.trackingUrl}\n\nNeed help? Call 01803 222784.`,
    html: `<div style="margin:0;background:#f7f9fc;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#323841;"><div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:26px;padding:30px;box-shadow:0 16px 44px rgba(16,24,40,.07);"><p style="margin:0 0 12px;color:#d82c0d;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">Delivery attempted</p><h1 style="margin:0;color:#323841;font-size:30px;line-height:1.12;font-weight:700;">We could not complete your delivery</h1><p style="margin:18px 0 0;color:#667085;font-size:15px;line-height:1.6;">Hi ${customerName},</p><p style="margin:8px 0 0;color:#667085;font-size:15px;line-height:1.6;">We attempted your Bathroom Panels Direct delivery for ${orderNumber}, but could not complete it.</p><div style="margin:22px 0 0;padding:16px;border-radius:18px;background:#fff7ed;border:1px solid #fed7aa;"><p style="margin:0 0 5px;color:#9a3412;font-size:12px;text-transform:uppercase;letter-spacing:.45px;font-weight:700;">Reason recorded by driver</p><p style="margin:0;color:#323841;font-size:18px;line-height:1.4;font-weight:700;">${reason}</p></div><p style="margin:24px 0 0;"><a href="${trackingUrl}" style="display:inline-block;background:#509AE6;color:#ffffff;text-decoration:none;border-radius:999px;padding:13px 20px;font-weight:700;">View tracking update</a></p></div><p style="margin:18px 0 0;text-align:center;color:#667085;font-size:13px;line-height:1.5;">Need help? Call 01803 222784.</p></div>`,
  };
}

async function tagOrderFailedDelivery(admin: ShopifyAdmin, shopifyOrderId: string, reason: string) {
  const response = await admin.graphql(TAGS_ADD_MUTATION, {
    variables: {
      id: shopifyOrderId,
      tags: ["BPD failed delivery", `BPD failed delivery reason ${tidyReasonForTag(reason)}`],
    },
  });
  const payload = await response.json() as TagsAddPayload;

  throwGraphQLErrors(payload);
  throwUserErrors(payload.data?.tagsAdd?.userErrors);
}

export async function markStopFailedDelivery(input: {
  admin: ShopifyAdmin;
  stopId: string;
  reason: string;
  note?: string | null;
}) {
  const reason = input.reason.trim();
  const note = input.note?.trim() || null;

  if (!reason) {
    throw new Error("Failed delivery reason is required.");
  }

  const stop = await prisma.stop.findUnique({
    where: {
      id: input.stopId,
    },
    include: {
      route: {
        include: {
          stops: true,
        },
      },
      deliveryGroup: {
        include: {
          orders: true,
        },
      },
    },
  });

  if (!stop || !stop.deliveryGroup || !stop.deliveryGroupId) {
    throw new Error("Stop not found.");
  }

  if (stop.status === "DELIVERED") {
    throw new Error("This stop has already been marked delivered.");
  }

  if (stop.status === "FAILED") {
    throw new Error("This stop has already been marked failed.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.deliveryGroup.update({
      where: {
        id: stop.deliveryGroupId!,
      },
      data: {
        deliveryNote: note ? `Failed delivery, ${reason}. ${note}` : `Failed delivery, ${reason}`,
      },
    });

    await tx.stop.update({
      where: {
        id: input.stopId,
      },
      data: {
        status: "FAILED",
        actualArrival: new Date(),
      },
    });

    const otherStops = stop.route.stops.filter((routeStop) => routeStop.id !== input.stopId);
    const allStopsResolved = otherStops.every((routeStop) => ["DELIVERED", "FAILED"].includes(routeStop.status));

    await tx.route.update({
      where: {
        id: stop.routeId,
      },
      data: {
        status: allStopsResolved ? "COMPLETED" : stop.route.status,
        history: {
          create: {
            action: "Stop failed",
            details: `Stop ${stop.orderIndex} marked failed. Reason: ${reason}. Shopify tagging and customer missed delivery notification will run after the failed delivery has been saved.`,
          },
        },
      },
    });
  });

  const [credentials, canSendSms, canSendEmail] = await Promise.all([
    getAppCredentials(),
    isTwilioEnabled(),
    isResendEnabled(),
  ]);
  const shopifyResults: string[] = [];
  const notificationResults: string[] = [];
  let smsSent = 0;
  let emailsSent = 0;
  let skipped = 0;
  let failed = 0;

  for (const order of stop.deliveryGroup.orders) {
    try {
      await tagOrderFailedDelivery(input.admin, order.shopifyOrderId, reason);
      shopifyResults.push(`${order.shopifyOrderNumber}: tagged`);
    } catch (error) {
      shopifyResults.push(`${order.shopifyOrderNumber}: Shopify tag skipped, ${shopifyErrorMessage(error)}`);
    }

    const trackingCode = await ensureCustomerTrackingCode(order.id);
    const trackingUrl = buildShortCustomerTrackingUrl(getPublicAppBaseUrl(credentials.shopPublicUrl), trackingCode);
    let attempted = false;
    let sent = false;

    if (canSendSms && order.customerPhone) {
      attempted = true;
      try {
        await sendSmsWithTwilio({
          to: order.customerPhone,
          message: buildFailedDeliverySms({ customerName: order.customerName, orderNumber: order.shopifyOrderNumber, reason, trackingUrl }),
        });
        smsSent += 1;
        sent = true;
      } catch (error) {
        failed += 1;
        notificationResults.push(`${order.shopifyOrderNumber}: SMS failed, ${notificationErrorMessage(error)}`);
      }
    }

    if (canSendEmail && order.customerEmail) {
      attempted = true;
      try {
        await sendEmailWithResend({
          to: order.customerEmail,
          message: buildFailedDeliveryEmail({ customerName: order.customerName, orderNumber: order.shopifyOrderNumber, reason, trackingUrl }),
        });
        emailsSent += 1;
        sent = true;
      } catch (error) {
        failed += 1;
        notificationResults.push(`${order.shopifyOrderNumber}: email failed, ${notificationErrorMessage(error)}`);
      }
    }

    if (!attempted || !sent) {
      skipped += 1;
    }

    if (sent) {
      notificationResults.push(`${order.shopifyOrderNumber}: customer notified${trackingUrl ? ` with ${trackingUrl}` : ""}`);
    }
  }

  try {
    const nextResult = await sendNextPendingStopNotification(stop.routeId, input.stopId);
    notificationResults.push(`Next pending stop update: ${nextResult.smsSent} SMS, ${nextResult.emailsSent} emails, ${nextResult.skipped} skipped${nextResult.failed ? `, ${nextResult.failed} failed` : ""}`);
    failed += nextResult.failed;
  } catch (error) {
    notificationResults.push(`Next pending stop update skipped, ${notificationErrorMessage(error)}`);
  }

  try {
    await prisma.routeHistory.create({
      data: {
        routeId: stop.routeId,
        action: "Failed delivery follow up completed",
        details: `Shopify: ${shopifyResults.join(", ") || "No linked Shopify orders found"}. Customer missed delivery notifications: ${smsSent} SMS sent, ${emailsSent} emails sent, ${skipped} skipped, ${failed} failed${notificationResults.length ? `. Details: ${notificationResults.join(" | ")}` : ""}`,
      },
    });
  } catch {
    // Follow up logging must not undo a failed delivery.
  }
}
