import type { AddressOverride } from "@prisma/client";
import prisma from "../db.server";
import { getAddressOverridesByOrderId } from "./addressOverrides.server";
import { lookupAddress } from "./getAddress.server";
import { getActiveRouteAllocations, type RouteAllocation } from "./routeAllocations.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type ShopifyLineItem = {
  title: string;
  quantity: number;
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
  lineItemLines: string[];
  fulfilByDate?: string | null;
  hasManualOverride: boolean;
  manualAddress: string | null;
  manualAddressNotes: string | null;
  orderSource?: "shopify" | "manual" | "return";
  isReturnCollection?: boolean;
  routeAllocation?: RouteAllocation | null;
  isRedelivery?: boolean;
  redeliveryReason?: string | null;
  redeliveryRouteName?: string | null;
  redeliveryAttemptedAt?: string | null;
  returnRequestedAt?: string | null;
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

function customerName(order: ShopifyOrderNode) {
  const firstName = order.customer?.firstName || "";
  const lastName = order.customer?.lastName || "";
  const fromCustomer = `${firstName} ${lastName}`.trim();
  const fromAddress = order.shippingAddress?.name || "";

  return fromCustomer || fromAddress || "Customer";
}

function shippingMethod(order: ShopifyOrderNode) {
  return order.shippingLines.edges.map((edge) => edge.node.title).filter(Boolean).join(", ") || "No shipping method";
}

function formatAddress(order: ShopifyOrderNode) {
  const address = order.shippingAddress;
  if (!address) return "No delivery address";
  return [address.address1, address.address2, address.city, address.province, address.zip, address.country]
    .filter(Boolean)
    .join(", ");
}

function hasDeliveryAddress(order: ShopifyOrderNode) {
  const address = order.shippingAddress;
  return Boolean(address?.address1 && address?.city && address?.zip);
}

function lineItems(order: ShopifyOrderNode) {
  return order.lineItems.edges.map((edge) => edge.node);
}

function lineItemSummary(order: ShopifyOrderNode) {
  return lineItems(order)
    .map((item) => `${item.quantity} × ${item.title}${item.sku ? ` (${item.sku})` : ""}`)
    .join(", ");
}

function lineItemLines(order: ShopifyOrderNode) {
  return lineItems(order).map((item) => `${item.quantity} × ${item.title}${item.sku ? ` (${item.sku})` : ""}`);
}

function hasPanel(order: ShopifyOrderNode) {
  return lineItems(order).some((item) => {
    const productType = normalise(item.product?.productType);
    const title = normalise(item.title);
    const tags = (item.product?.tags || []).map(normalise);

    return productType.includes("panel") || title.includes("panel") || tags.some((tag) => tag.includes("panel"));
  });
}

function isSampleOnly(order: ShopifyOrderNode) {
  const items = lineItems(order);

  if (!items.length) {
    return false;
  }

  return items.every((item) => {
    const title = normalise(item.title);
    const productType = normalise(item.product?.productType);
    const tags = (item.product?.tags || []).map(normalise);

    return title.includes("sample") || productType.includes("sample") || tags.some((tag) => tag.includes("sample"));
  });
}

function isCollectionOrder(order: ShopifyOrderNode) {
  const shipping = normalise(shippingMethod(order));
  return shipping.includes("collection") || shipping.includes("pickup") || shipping.includes("pick up");
}

function shouldShowOnDeliveryMap(order: ShopifyOrderNode) {
  if (order.cancelledAt) return false;
  if (order.displayFulfillmentStatus === "FULFILLED") return false;
  if (order.displayFinancialStatus === "REFUNDED" || order.displayFinancialStatus === "VOIDED") return false;
  if (!hasPanel(order)) return false;
  if (isSampleOnly(order)) return false;
  if (isCollectionOrder(order)) return false;
  return true;
}

function overrideAddressSummary(override: AddressOverride) {
  return override.manualAddress;
}

function addressStatus(order: ShopifyOrderNode, override: AddressOverride | null): DeliveryOrder["addressStatus"] {
  if (override?.latitude && override.longitude) return "READY";
  if (override?.manualAddress) return "NEEDS_LOCATION_CHECK";
  if (!hasDeliveryAddress(order)) return "NEEDS_ADDRESS";
  return "NEEDS_LOCATION_CHECK";
}

function addressConfidence(latitude: number | null, longitude: number | null): DeliveryOrder["addressConfidence"] {
  return typeof latitude === "number" && typeof longitude === "number" ? "HIGH" : "LOW";
}

async function toDeliveryOrder(order: ShopifyOrderNode, override: AddressOverride | null, routeAllocation: RouteAllocation | null): Promise<DeliveryOrder> {
  const addressSummary = override ? overrideAddressSummary(override) : formatAddress(order);
  const postcode = override?.postcode || order.shippingAddress?.zip || null;
  const lookup = !override && hasDeliveryAddress(order) ? await lookupAddress(postcode, addressSummary) : null;
  const latitude = override?.latitude ?? lookup?.latitude ?? null;
  const longitude = override?.longitude ?? lookup?.longitude ?? null;
  const formattedAddress = override?.manualAddress || lookup?.formattedAddress || addressSummary;
  const sourceAddressStatus = addressStatus(order, override);
  const status = typeof latitude === "number" && typeof longitude === "number" ? "READY" : sourceAddressStatus;

  return {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    customerName: customerName(order),
    email: order.email || order.customer?.email || null,
    phone: order.phone || order.shippingAddress?.phone || order.customer?.phone || null,
    shippingMethod: shippingMethod(order),
    fulfilmentStatus: order.displayFulfillmentStatus,
    financialStatus: order.displayFinancialStatus,
    postcode,
    addressSummary,
    formattedAddress,
    hasDeliveryAddress: hasDeliveryAddress(order),
    hasPanel: hasPanel(order),
    isSampleOnly: isSampleOnly(order),
    addressStatus: status,
    addressConfidence: addressConfidence(latitude, longitude),
    latitude,
    longitude,
    lineItemSummary: lineItemSummary(order),
    lineItemLines: lineItemLines(order),
    hasManualOverride: Boolean(override),
    manualAddress: override?.manualAddress || null,
    manualAddressNotes: override?.notes || null,
    orderSource: "shopify",
    routeAllocation,
  };
}

export async function getDeliveryOrders(admin: ShopifyAdmin) {
  const allOrders: ShopifyOrderNode[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(`#graphql
      query DeliveryOrders($cursor: String) {
        orders(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
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
              customer { firstName lastName email phone }
              shippingAddress { name address1 address2 city province zip country phone }
              shippingLines(first: 5) { edges { node { title } } }
              lineItems(first: 100) { edges { node { title quantity sku product { productType tags } } } }
            }
          }
        }
      }
    `, { variables: { cursor } });

    const payload = await response.json() as DeliveryOrdersPayload;
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join(", "));
    }

    const pageOrders = payload.data?.orders?.edges.map((edge) => edge.node) || [];
    allOrders.push(...pageOrders);
    hasNextPage = Boolean(payload.data?.orders?.pageInfo.hasNextPage);
    cursor = payload.data?.orders?.pageInfo.endCursor || null;
  }

  const visibleOrders = allOrders.filter(shouldShowOnDeliveryMap);
  const [overridesByOrderId, allocationsByOrderId] = await Promise.all([
    getAddressOverridesByOrderId(visibleOrders.map((order) => order.id)),
    getActiveRouteAllocations(visibleOrders.map((order) => order.id)),
  ]);

  const orders = await Promise.all(visibleOrders.map((order) => toDeliveryOrder(
    order,
    overridesByOrderId.get(order.id) || null,
    allocationsByOrderId.get(order.id) || null,
  )));

  return orders.filter((order) => !order.routeAllocation);
}

export async function toManualDeliveryOrder(input: ManualDeliveryOrderInput): Promise<DeliveryOrder> {
  const address = input.address.trim();
  const postcodeMatch = address.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
  const postcode = postcodeMatch?.[0]?.toUpperCase() || null;
  const lookup = await lookupAddress(postcode, address);
  const latitude = lookup.latitude;
  const longitude = lookup.longitude;
  const formattedAddress = lookup.formattedAddress || address;
  const hasCoordinates = typeof latitude === "number" && typeof longitude === "number";

  return {
    id: input.id || `manual:${Date.now()}`,
    name: input.id ? input.id.replace("manual:", "MANUAL-").toUpperCase() : "MANUAL",
    createdAt: new Date().toISOString(),
    customerName: input.customerName,
    email: input.email || null,
    phone: input.phone || null,
    shippingMethod: "Manual route entry",
    fulfilmentStatus: "manual",
    financialStatus: "manual",
    postcode,
    addressSummary: address,
    formattedAddress,
    hasDeliveryAddress: true,
    hasPanel: true,
    isSampleOnly: false,
    addressStatus: hasCoordinates ? "READY" : "NEEDS_LOCATION_CHECK",
    addressConfidence: hasCoordinates ? "HIGH" : "LOW",
    latitude,
    longitude,
    lineItemSummary: input.lineItemSummary,
    lineItemLines: input.lineItemSummary.split("\n").map((line) => line.trim()).filter(Boolean),
    fulfilByDate: null,
    hasManualOverride: true,
    manualAddress: address,
    manualAddressNotes: "Manual order added from the planning map",
    orderSource: "manual",
  };
}
