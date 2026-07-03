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

type FulfillmentOrderLineItem = {
  id: string;
  remainingQuantity: number;
};

type FulfillmentOrder = {
  id: string;
  status: string;
  lineItems: {
    nodes: FulfillmentOrderLineItem[];
  };
};

type FulfillmentOrdersPayload = {
  data?: {
    order?: {
      fulfillmentOrders: {
        nodes: FulfillmentOrder[];
      };
    } | null;
  };
  errors?: Array<{ message: string }>;
};

type FulfillmentCreatePayload = {
  data?: {
    fulfillmentCreate?: {
      fulfillment?: {
        id: string;
        status: string;
      } | null;
      userErrors?: ShopifyUserError[];
    };
  };
  errors?: Array<{ message: string }>;
};

type TagsAddPayload = {
  data?: {
    tagsAdd?: {
      userErrors?: ShopifyUserError[];
    };
  };
  errors?: Array<{ message: string }>;
};

const GET_FULFILLMENT_ORDERS = `#graphql
  query GetFulfillmentOrders($id: ID!) {
    order(id: $id) {
      fulfillmentOrders(first: 20) {
        nodes {
          id
          status
          lineItems(first: 250) {
            nodes {
              id
              remainingQuantity
            }
          }
        }
      }
    }
  }
`;

const FULFILLMENT_CREATE = `#graphql
  mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

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

function isShopifyOrderId(value: string) {
  return value.startsWith("gid://shopify/Order/");
}

function isBenignSkipReason(reason?: string | null) {
  const value = (reason || "").toLowerCase();
  return (
    value.includes("manual route entry") ||
    value.includes("no remaining items") ||
    value.includes("already fulfilled") ||
    value.includes("shopify statuses: closed") ||
    value.includes("shopify statuses: fulfilled")
  );
}

export async function tagOrderDelivered(admin: ShopifyAdmin, shopifyOrderId: string) {
  const response = await admin.graphql(TAGS_ADD_MUTATION, {
    variables: {
      id: shopifyOrderId,
      tags: ["BPD delivered"],
    },
  });
  const payload = await response.json() as TagsAddPayload;

  throwGraphQLErrors(payload);
  throwUserErrors(payload.data?.tagsAdd?.userErrors);
}

export async function fulfilShopifyOrder(admin: ShopifyAdmin, shopifyOrderId: string) {
  if (!isShopifyOrderId(shopifyOrderId)) {
    return {
      fulfilled: false,
      reason: "Manual route entry, no Shopify order to fulfil",
    };
  }

  const response = await admin.graphql(GET_FULFILLMENT_ORDERS, {
    variables: {
      id: shopifyOrderId,
    },
  });
  const payload = await response.json() as FulfillmentOrdersPayload;

  throwGraphQLErrors(payload);

  const fulfillmentOrders = payload.data?.order?.fulfillmentOrders.nodes || [];
  const fulfillableFulfillmentOrders = fulfillmentOrders.filter((fulfillmentOrder) => fulfillmentOrder.status === "OPEN");

  if (!fulfillableFulfillmentOrders.length) {
    const seenStatuses = fulfillmentOrders.map((fulfillmentOrder) => fulfillmentOrder.status).filter(Boolean).join(", ");

    return {
      fulfilled: false,
      reason: seenStatuses ? `No open fulfilment orders found. Shopify statuses: ${seenStatuses}` : "No fulfilment orders found on Shopify",
    };
  }

  const lineItemsByFulfillmentOrder = fulfillableFulfillmentOrders
    .map((fulfillmentOrder) => ({
      fulfillmentOrderId: fulfillmentOrder.id,
      fulfillmentOrderLineItems: fulfillmentOrder.lineItems.nodes
        .filter((lineItem) => lineItem.remainingQuantity > 0)
        .map((lineItem) => ({
          id: lineItem.id,
          quantity: lineItem.remainingQuantity,
        })),
    }))
    .filter((fulfillmentOrder) => fulfillmentOrder.fulfillmentOrderLineItems.length > 0);

  if (!lineItemsByFulfillmentOrder.length) {
    return {
      fulfilled: false,
      reason: "No remaining items to fulfil",
    };
  }

  const createResponse = await admin.graphql(FULFILLMENT_CREATE, {
    variables: {
      fulfillment: {
        lineItemsByFulfillmentOrder,
        notifyCustomer: false,
      },
    },
  });
  const createPayload = await createResponse.json() as FulfillmentCreatePayload;

  throwGraphQLErrors(createPayload);
  throwUserErrors(createPayload.data?.fulfillmentCreate?.userErrors);

  return {
    fulfilled: true,
    fulfillmentId: createPayload.data?.fulfillmentCreate?.fulfillment?.id || null,
  };
}

export async function markShopifyOrderDelivered(admin: ShopifyAdmin, shopifyOrderId: string) {
  const fulfilmentResult = await fulfilShopifyOrder(admin, shopifyOrderId);

  if (isShopifyOrderId(shopifyOrderId)) {
    await tagOrderDelivered(admin, shopifyOrderId);
  }

  return fulfilmentResult;
}

export async function fulfilRouteOrders(admin: ShopifyAdmin, routeId: string) {
  const route = await prisma.route.findUnique({
    where: {
      id: routeId,
    },
    include: {
      stops: {
        include: {
          deliveryGroup: {
            include: {
              orders: true,
            },
          },
        },
      },
    },
  });

  if (!route) {
    throw new Error("Route not found.");
  }

  let fulfilled = 0;
  let skipped = 0;
  const errors: string[] = [];
  const notes: string[] = [];

  for (const stop of route.stops) {
    for (const order of stop.deliveryGroup?.orders || []) {
      try {
        const result = await markShopifyOrderDelivered(admin, order.shopifyOrderId);

        if (result.fulfilled) {
          fulfilled += 1;
        } else {
          skipped += 1;
          const detail = `${order.shopifyOrderNumber}: ${result.reason || "Shopify order was skipped"}`;
          if (isBenignSkipReason(result.reason)) {
            notes.push(detail);
          } else {
            errors.push(detail);
          }
        }
      } catch (error) {
        errors.push(`${order.shopifyOrderNumber}: ${error instanceof Error ? error.message : "Unknown fulfilment error"}`);
      }
    }
  }

  await prisma.routeHistory.create({
    data: {
      routeId: route.id,
      action: errors.length ? "Route fulfilment checked with errors" : "Route fulfilment checked",
      details: `${fulfilled} Shopify orders fulfilled, ${skipped} skipped${notes.length ? `. Notes: ${notes.join(" | ")}` : ""}${errors.length ? `. Errors: ${errors.join(" | ")}` : ""}`,
    },
  });

  return {
    fulfilled,
    skipped,
    errors,
  };
}
