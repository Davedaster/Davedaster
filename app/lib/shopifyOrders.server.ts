import type { AddressOverride } from "@prisma/client";
import { getAddressOverridesByOrderId } from "./addressOverrides.server";
import { lookupAddress } from "./getAddress.server";

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
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
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
  hasManualOverride: boolean;
  manualAddress: string | null;
  manualAddressNotes: string | null;
  orderSource?: "shopify" | "manual";
};

export type ManualDeliveryOrderInput = {
  id?: string | null;
  customerName: string;
  address: string;
  email?: string | null;
  phone?: string | null;
  lineItemSummary: string;
};

function normalise(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function shippingTitle(order: ShopifyOrderNode) {
  return order.shippingLines.edges.map((edge) => edge.node.title).join(", ");
}

function isFulfilled(order: ShopifyOrderNode) {
  return normalise(order.displayFulfillmentStatus) === "fulfilled";
}

function isFullyRefunded(order: ShopifyOrderNode) {
  return normalise(order.displayFinancialStatus) === "refunded";
}

function isSampleLineItem(item: ShopifyLineItem) {
  const title = normalise(item.title);
  const sku = normalise(item.sku);
  const productType = normalise(item.product?.productType);
  const tags = item.product?.tags.map(normalise) || [];

  return (
    productType === "pvc panel sample" ||
    productType.includes("sample") ||
    title.includes("sample") ||
    sku.includes("samp") ||
    tags.includes("sample")
  );
}

function isPanelLineItem(item: ShopifyLineItem) {
  return normalise(item.product?.productType) === "pvc panel" && !isSampleLineItem(item);
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

function extractPostcode(value: string) {
  const match = value.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);

  return match?.[0]?.toUpperCase() || "";
}

function manualOrderReference(input: ManualDeliveryOrderInput) {
  const suppliedId = input.id?.trim();

  if (suppliedId) {
    return suppliedId.startsWith("manual:") ? suppliedId : `manual:${suppliedId}`;
  }

  const seed = `${input.customerName}-${input.address}-${input.lineItemSummary}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 44) || "order";

  return `manual:${seed}-${Date.now()}`;
}

function manualOrderNumber(reference: string) {
  return reference.replace("manual:", "MANUAL-").toUpperCase();
}

function applyOverride(order: DeliveryOrder, override: AddressOverride | undefined): DeliveryOrder {
  if (!override) {
    return order;
  }

  return {
    ...order,
    postcode: override.postcode || order.postcode,
    addressSummary: override.manualAddress,
    formattedAddress: override.manualAddress,
    addressStatus: override.addressStatus === "READY" ? "READY" : "NEEDS_LOCATION_CHECK",
    addressConfidence: override.addressStatus === "READY" ? "HIGH" : "LOW",
    latitude: override.latitude,
    longitude: override.longitude,
    hasManualOverride: true,
    manualAddress: override.manualAddress,
    manualAddressNotes: override.notes,
  };
}

export function shouldShowOnDeliveryMap(order: ShopifyOrderNode) {
  const items = lineItems(order);
  const isSampleOnly = items.length > 0 && items.every(isSampleLineItem);

  if (order.cancelledAt) return false;
  if (isFullyRefunded(order)) return false;
  if (isFulfilled(order)) return false;
  if (isSampleOnly) return false;

  return true;
}

export async function toDeliveryOrder(order: ShopifyOrderNode, override?: AddressOverride): Promise<DeliveryOrder> {
  const items = lineItems(order);
  const hasPanel = items.some(isPanelLineItem);
  const isSampleOnly = items.length > 0 && items.every(isSampleLineItem);
  const shippingMethod = shippingTitle(order);
  const hasDeliveryAddress = Boolean(order.shippingAddress);
  const weakAddress = hasWeakAddress(order);
  const addressSummary = formatAddress(order);
  const lookup = hasDeliveryAddress && !override
    ? await lookupAddress(order.shippingAddress?.zip || null, addressSummary)
    : null;

  const lookupNeedsCheck = lookup ? lookup.confidence === "LOW" || !lookup.latitude || !lookup.longitude : false;

  const deliveryOrder: DeliveryOrder = {
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
    hasManualOverride: false,
    manualAddress: null,
    manualAddressNotes: null,
    orderSource: "shopify",
  };

  return applyOverride(deliveryOrder, override);
}

export async function toManualDeliveryOrder(input: ManualDeliveryOrderInput): Promise<DeliveryOrder> {
  const customerName = input.customerName.trim() || "Manual customer";
  const addressSummary = input.address.trim();
  const lookup = await lookupAddress(extractPostcode(addressSummary), addressSummary);
  const reference = manualOrderReference(input);

  return {
    id: reference,
    name: manualOrderNumber(reference),
    createdAt: new Date().toISOString(),
    customerName,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    shippingMethod: "Manual route entry",
    fulfilmentStatus: "unfulfilled",
    financialStatus: "manual",
    postcode: lookup.postcode || extractPostcode(addressSummary) || null,
    addressSummary,
    formattedAddress: lookup.formattedAddress || addressSummary,
    hasDeliveryAddress: Boolean(addressSummary),
    hasPanel: true,
    isSampleOnly: false,
    addressStatus: lookup.latitude && lookup.longitude ? "READY" : "NEEDS_LOCATION_CHECK",
    addressConfidence: lookup.confidence,
    latitude: lookup.latitude,
    longitude: lookup.longitude,
    lineItemSummary: input.lineItemSummary.trim(),
    hasManualOverride: true,
    manualAddress: addressSummary,
    manualAddressNotes: "Manual order added from the planning map",
    orderSource: "manual",
  };
}

const DELIVERY_ORDERS_QUERY = `#graphql
  query DeliveryOrders($query: String!, $cursor: String) {
    orders(first: 100, after: $cursor, sortKey: CREATED_AT, reverse: true, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
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

async function fetchDeliveryOrderPage(admin: ShopifyAdmin, query: string, cursor: string | null) {
  const response = await admin.graphql(DELIVERY_ORDERS_QUERY, {
    variables: { query, cursor },
  });
  const payload = await response.json() as DeliveryOrdersPayload;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join(", "));
  }

  return payload.data?.orders;
}

export async function getDeliveryOrders(admin: ShopifyAdmin) {
  const query = "status:open";
  const orders: ShopifyOrderNode[] = [];
  let cursor: string | null = null;
  let page = 0;

  do {
    const result = await fetchDeliveryOrderPage(admin, query, cursor);

    if (!result) {
      break;
    }

    orders.push(...result.edges.map((edge) => edge.node));
    cursor = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null;
    page += 1;
  } while (cursor && page < 10);

  const filteredOrders = orders.filter(shouldShowOnDeliveryMap);
  const overrides = await getAddressOverridesByOrderId();

  return Promise.all(filteredOrders.map((order) => toDeliveryOrder(order, overrides.get(order.id))));
}
