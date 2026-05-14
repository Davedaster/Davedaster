import { lookupAddress } from "./getAddress.server";
import { getLastWorkingDaysStart } from "./workingDays.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type ShopifyLineItem = {
  title: string;
  sku: string | null;
  product: {
    productType: string | null;
    tags: string[];
  } | null;
};

type ShopifyOrderNode = {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string;
  email: string | null;
  phone: string | null;
  customer: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  shippingAddress: {
    name: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    zip: string | null;
    country: string | null;
    phone: string | null;
  } | null;
  shippingLines: {
    edges: Array<{
      node: {
        title: string;
      };
    }>;
  };
  lineItems: {
    edges: Array<{
      node: ShopifyLineItem;
    }>;
  };
};

type DeliveryOrdersPayload = {
  data?: {
    orders?: {
      edges: Array<{ node: ShopifyOrderNode }>;
    };
  };
  errors?: Array<{ message: string }>;
};

export type DeliveryOrder = {
  id: string;
  name: string;
  createdAt: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  shippingMethod: string;
  fulfilmentStatus: string;
  financialStatus: string;
  postcode: string | null;
  addressSummary: string;
  formattedAddress: string | null;
  hasDeliveryAddress: boolean;
  hasPanel: boolean;
  isSampleOnly: boolean;
  addressStatus: "READY" | "NEEDS_ADDRESS" | "NEEDS_LOCATION_CHECK";
  addressConfidence: "HIGH" | "LOW";
  latitude: number | null;
  longitude: number | null;
  lineItemSummary: string;
};

const INCLUDED_SHIPPING_TERMS = [
  "free rapid delivery",
  "rapid delivery",
  "local delivery",
];

const EXCLUDED_SHIPPING_TERMS = [
  "yodel",
  "royal mail",
  "pickup",
  "pick up",
  "store pickup",
  "store collection",
  "collection",
  "local pickup",
];

function normalise(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function shippingTitle(order: ShopifyOrderNode) {
  return order.shippingLines.edges.map((edge) => edge.node.title).join(", ");
}

function includesAny(value: string, terms: string[]) {
  const normalised = normalise(value);
  return terms.some((term) => normalised.includes(term));
}

function isFulfilled(order: ShopifyOrderNode) {
  return normalise(order.displayFulfillmentStatus) === "fulfilled";
}

function isFullyRefunded(order: ShopifyOrderNode) {
  return normalise(order.displayFinancialStatus) === "refunded";
}

function isPanelLineItem(item: ShopifyLineItem) {
  return normalise(item.product?.productType) === "pvc panel";
}

function isSampleLineItem(item: ShopifyLineItem) {
  const sku = normalise(item.sku);
  const productType = normalise(item.product?.productType);
  const tags = item.product?.tags.map(normalise) || [];

  return (
    productType === "pvc panel sample" ||
    sku.includes("samp") ||
    tags.includes("sample")
  );
}

function lineItems(order: ShopifyOrderNode) {
  return order.lineItems.edges.map((edge) => edge.node);
}

function getCustomerName(order: ShopifyOrderNode) {
  const firstName = order.customer?.firstName || "";
  const lastName = order.customer?.lastName || "";
  const fromCustomer = `${firstName} ${lastName}`.trim();
  const fromAddress = order.shippingAddress?.name || "";

  return fromCustomer || fromAddress || "Customer";
}

function formatAddress(order: ShopifyOrderNode) {
  const address = order.shippingAddress;

  if (!address) {
    return "No delivery address";
  }

  return [
    address.address1,
    address.address2,
    address.city,
    address.province,
    address.zip,
    address.country,
  ]
    .filter(Boolean)
    .join(", ");
}

function hasWeakAddress(order: ShopifyOrderNode) {
  const address = order.shippingAddress;

  if (!address) {
    return false;
  }

  return !address.address1 || !address.zip;
}

export function shouldShowOnDeliveryMap(order: ShopifyOrderNode) {
  const shippingMethod = shippingTitle(order);
  const items = lineItems(order);
  const hasPanel = items.some(isPanelLineItem);
  const isSampleOnly = items.length > 0 && items.every(isSampleLineItem);

  if (order.cancelledAt) return false;
  if (isFullyRefunded(order)) return false;
  if (isFulfilled(order)) return false;
  if (isSampleOnly) return false;
  if (!hasPanel) return false;
  if (includesAny(shippingMethod, EXCLUDED_SHIPPING_TERMS)) return false;

  return includesAny(shippingMethod, INCLUDED_SHIPPING_TERMS);
}

export async function toDeliveryOrder(order: ShopifyOrderNode): Promise<DeliveryOrder> {
  const items = lineItems(order);
  const hasPanel = items.some(isPanelLineItem);
  const isSampleOnly = items.length > 0 && items.every(isSampleLineItem);
  const shippingMethod = shippingTitle(order);
  const hasDeliveryAddress = Boolean(order.shippingAddress);
  const weakAddress = hasWeakAddress(order);
  const addressSummary = formatAddress(order);
  const lookup = hasDeliveryAddress
    ? await lookupAddress(order.shippingAddress?.zip || null, addressSummary)
    : null;

  const lookupNeedsCheck = lookup ? lookup.confidence === "LOW" || !lookup.latitude || !lookup.longitude : false;

  return {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    customerName: getCustomerName(order),
    email: order.email || order.customer?.email || null,
    phone: order.phone || order.shippingAddress?.phone || order.customer?.phone || null,
    shippingMethod,
    fulfilmentStatus: order.displayFulfillmentStatus,
    financialStatus: order.displayFinancialStatus,
    postcode: order.shippingAddress?.zip || null,
    addressSummary,
    formattedAddress: lookup?.formattedAddress || null,
    hasDeliveryAddress,
    hasPanel,
    isSampleOnly,
    addressStatus: !hasDeliveryAddress
      ? "NEEDS_ADDRESS"
      : weakAddress || lookupNeedsCheck
        ? "NEEDS_LOCATION_CHECK"
        : "READY",
    addressConfidence: lookup?.confidence || "LOW",
    latitude: lookup?.latitude || null,
    longitude: lookup?.longitude || null,
    lineItemSummary: items.map((item) => item.title).join(", "),
  };
}

const DELIVERY_ORDERS_QUERY = `#graphql
  query DeliveryOrders($query: String!) {
    orders(first: 100, sortKey: CREATED_AT, reverse: true, query: $query) {
      edges {
        node {
          id
          name
          createdAt
          cancelledAt
          displayFulfillmentStatus
          displayFinancialStatus
          email
          phone
          customer {
            firstName
            lastName
            email
            phone
          }
          shippingAddress {
            name
            address1
            address2
            city
            province
            zip
            country
            phone
          }
          shippingLines(first: 5) {
            edges {
              node {
                title
              }
            }
          }
          lineItems(first: 100) {
            edges {
              node {
                title
                sku
                product {
                  productType
                  tags
                }
              }
            }
          }
        }
      }
    }
  }
`;

export async function getDeliveryOrders(admin: ShopifyAdmin) {
  const startDate = getLastWorkingDaysStart(7);
  const query = `created_at:>=${startDate.toISOString().slice(0, 10)}`;

  const response = await admin.graphql(DELIVERY_ORDERS_QUERY, {
    variables: { query },
  });
  const payload = await response.json() as DeliveryOrdersPayload;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join(", "));
  }

  const orders = payload.data?.orders?.edges.map((edge) => edge.node) || [];
  const filteredOrders = orders.filter(shouldShowOnDeliveryMap);

  return Promise.all(filteredOrders.map(toDeliveryOrder));
}
