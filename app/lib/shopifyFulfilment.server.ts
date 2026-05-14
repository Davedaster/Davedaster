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
    fulfillmentCreateV2?: {
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
  mutation FulfillmentCreate($fulfillment: FulfillmentV2Input!) {
    fulfillmentCreateV2(fulfillment: $fulfillment) {
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
  const response = await admin.graphql(GET_FULFILLMENT_ORDERS, {
    variables: {
      id: shopifyOrderId,
    },
  });
  const payload = await response.json() as FulfillmentOrdersPayload;

  throwGraphQLErrors(payload);

  const fulfillmentOrders = payload.data?.order?.fulfillmentOrders.nodes || [];
  const openFulfillmentOrders = fulfillmentOrders.filter((fulfillmentOrder) => (
    ["OPEN", "IN_PROGRESS"].includes(fulfillmentOrder.status)
  ));

  if (!openFulfillmentOrders.length) {
    return {
      fulfilled: false,
      reason: "No open fulfilment orders found",
    };
  }

  const lineItemsByFulfillmentOrder = openFulfillmentOrders
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
  throwUserErrors(createPayload.data?.fulfillmentCreateV2?.userErrors);

  return {
    fulfilled: true,
    fulfillmentId: createPayload.data?.fulfillmentCreateV2?.fulfillment?.id || null,
  };
}

export async function markShopifyOrderDelivered(admin: ShopifyAdmin, shopifyOrderId: string) {
  const fulfilmentResult = await fulfilShopifyOrder(admin, shopifyOrderId);
  await tagOrderDelivered(admin, shopifyOrderId);

  return fulfilmentResult;
}
