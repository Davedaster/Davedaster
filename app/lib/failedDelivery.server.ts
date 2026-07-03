import prisma from "../db.server";

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
            details: `Stop ${stop.orderIndex} marked failed. Reason: ${reason}. Shopify tagging will run after the failed delivery has been saved.`,
          },
        },
      },
    });
  });

  const shopifyResults: string[] = [];

  for (const order of stop.deliveryGroup.orders) {
    try {
      await tagOrderFailedDelivery(input.admin, order.shopifyOrderId, reason);
      shopifyResults.push(`${order.shopifyOrderNumber}: tagged`);
    } catch (error) {
      shopifyResults.push(`${order.shopifyOrderNumber}: Shopify tag skipped, ${shopifyErrorMessage(error)}`);
    }
  }

  try {
    await prisma.routeHistory.create({
      data: {
        routeId: stop.routeId,
        action: "Failed delivery follow up completed",
        details: `Shopify: ${shopifyResults.join(", ") || "No linked Shopify orders found"}`,
      },
    });
  } catch {
    // Follow up logging must not undo a failed delivery.
  }
}
