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
  routeAllocation?: RouteAllocation | null;
  isRedelivery?: boolean;
  redeliveryReason?: string | null;
  redeliveryRouteName?: string | null;
  redeliveryAttemptedAt?: string | null;
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

function isPickupOrCollectionOrder(order: ShopifyOrderNode) {
  const title = normalise(shippingTitle(order));
  return (
    !order.shippingAddress ||
    title.includes("pickup") ||
    title.includes("pick up") ||
    title.includes("collection") ||
    title.includes("click and collect") ||
    title.includes("collect in store") ||
    title.includes("customer collect")
  );
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

function quantityLine(quantity: number, title: string) {
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1;
  return `${safeQuantity} × ${title}`;
}

function normaliseStoredLineItemLine(line: string) {
  const cleanLine = line.replace(/\s+/g, " ").trim();

  if (!cleanLine) {
    return "";
  }

  const leadingQuantity = cleanLine.match(/^(\d+)(?:\s*[x×]\s+)(.+)$/i);
  if (leadingQuantity) {
    return quantityLine(Number(leadingQuantity[1]), leadingQuantity[2].trim());
  }

  const trailingQuantity = cleanLine.match(/^(.+?)(?:\s+[x×]\s*)(\d+)$/i);
  if (trailingQuantity) {
    return quantityLine(Number(trailingQuantity[2]), trailingQuantity[1].trim());
  }

  return quantityLine(1, cleanLine);
}

function normaliseStoredLineItemLines(summary: string) {
  return summary
    .split(/,|\n/)
    .map(normaliseStoredLineItemLine)
    .filter(Boolean);
}

function lineItemLines(items: ShopifyLineItem[]) {
  return items.map((item) => quantityLine(Number(item.quantity || 1), item.title));
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
  if (!address) return "No delivery address";

  return [address.address1, address.address2, address.city, address.province, address.zip, address.country]
    .filter(Boolean)
    .join(", ");
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

function allocationLine(allocation: RouteAllocation) {
  return `Already allocated to ${allocation.routeName}${allocation.driverName ? ` with ${allocation.driverName}` : ""}`;
}

function redeliveryLine(reason?: string | null) {
  return `🔴 Redeliver${reason ? `, ${reason}` : ""}`;
}

function applyRouteAllocation(order: DeliveryOrder, allocation: RouteAllocation | undefined): DeliveryOrder {
  if (!allocation) return order;

  return {
    ...order,
    routeAllocation: allocation,
    lineItemLines: [allocationLine(allocation), ...order.lineItemLines],
  };
}

function applyRedeliveryFlag(order: DeliveryOrder, redelivery: DeliveryOrder | undefined): DeliveryOrder {
  if (!redelivery) return order;

  const redeliveryMarker = redeliveryLine(redelivery.redeliveryReason);
  const lineItemLines = order.lineItemLines.some((line) => line.includes("Redeliver"))
    ? order.lineItemLines
    : [redeliveryMarker, ...order.lineItemLines];

  return {
    ...order,
    isRedelivery: true,
    redeliveryReason: redelivery.redeliveryReason,
    redeliveryRouteName: redelivery.redeliveryRouteName,
    redeliveryAttemptedAt: redelivery.redeliveryAttemptedAt,
    lineItemLines,
  };
}

function applyOverride(order: DeliveryOrder, override: AddressOverride | undefined): DeliveryOrder {
  if (!override) return order;

  return {
    ...order,
    postcode: override.postcode || order.postcode,
    addressSummary: override.manualAddress,
    formattedAddress: override.manualAddress,
    addressStatus: override.latitude && override.longitude ? "READY" : "NEEDS_LOCATION_CHECK",
    addressConfidence: override.latitude && override.longitude ? "HIGH" : "LOW",
    latitude: override.latitude,
    longitude: override.longitude,
    hasManualOverride: true,
    manualAddress: override.manualAddress,
    manualAddressNotes: override.notes,
  };
}

function failedDeliveryReason(note?: string | null) {
  const cleanNote = (note || "").trim();
  const prefix = "Failed delivery,";

  if (!cleanNote) {
    return "Missed delivery";
  }

  if (!cleanNote.toLowerCase().startsWith(prefix.toLowerCase())) {
    return cleanNote;
  }

  return cleanNote.slice(prefix.length).trim().split(".")[0]?.trim() || "Missed delivery";
}

export function shouldShowOnDeliveryMap(order: ShopifyOrderNode) {
  const items = lineItems(order);
  const isSampleOnly = items.length > 0 && items.every(isSampleLineItem);

  if (order.cancelledAt) return false;
  if (isFullyRefunded(order)) return false;
  if (isFulfilled(order)) return false;
  if (isSampleOnly) return false;
  if (isPickupOrCollectionOrder(order)) return false;

  return true;
}

export async function toDeliveryOrder(order: ShopifyOrderNode, override?: AddressOverride): Promise<DeliveryOrder> {
  const items = lineItems(order);
  const itemLines = lineItemLines(items);
  const hasPanel = items.some(isPanelLineItem);
  const isSampleOnly = items.length > 0 && items.every(isSampleLineItem);
  const shippingMethod = shippingTitle(order);
  const hasDeliveryAddress = Boolean(order.shippingAddress);
  const addressSummary = formatAddress(order);
  const lookupHasCoordinates = false;

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
    formattedAddress: null,
    hasDeliveryAddress,
    hasPanel,
    isSampleOnly,
    addressStatus: !hasDeliveryAddress ? "NEEDS_ADDRESS" : lookupHasCoordinates ? "READY" : "NEEDS_LOCATION_CHECK",
    addressConfidence: "LOW",
    latitude: null,
    longitude: null,
    lineItemSummary: itemLines.join(", "),
    lineItemLines: itemLines,
    fulfilByDate: null,
    hasManualOverride: false,
    manualAddress: null,
    manualAddressNotes: null,
    orderSource: "shopify",
    routeAllocation: null,
  };

  return applyOverride(deliveryOrder, override);
}

export async function toManualDeliveryOrder(input: ManualDeliveryOrderInput): Promise<DeliveryOrder> {
  const customerName = input.customerName.trim() || "Manual customer";
  const addressSummary = input.address.trim();
  const lookup = await lookupAddress(extractPostcode(addressSummary), addressSummary);
  const reference = manualOrderReference(input);
  const lineItemLines = normaliseStoredLineItemLines(input.lineItemSummary);
  const lineItemSummary = lineItemLines.join(", ");

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
    addressConfidence: lookup.latitude && lookup.longitude ? "HIGH" : lookup.confidence,
    latitude: lookup.latitude,
    longitude: lookup.longitude,
    lineItemSummary,
    lineItemLines,
    fulfilByDate: null,
    hasManualOverride: true,
    manualAddress: addressSummary,
    manualAddressNotes: "Manual order added from the planning map",
    orderSource: "manual",
    routeAllocation: null,
  };
}

function failedStopForOrderStop(orderStop: Awaited<ReturnType<typeof getFailedRedeliveryOrderStops>>[number]) {
  return orderStop.deliveryGroup.stops
    .filter((stop) => stop.status === "FAILED")
    .sort((a, b) => new Date(b.actualArrival || b.updatedAt).getTime() - new Date(a.actualArrival || a.updatedAt).getTime())[0];
}

function toRedeliveryOrder(orderStop: Awaited<ReturnType<typeof getFailedRedeliveryOrderStops>>[number]): DeliveryOrder | null {
  const group = orderStop.deliveryGroup;
  const failedStop = failedStopForOrderStop(orderStop);

  if (!failedStop) {
    return null;
  }

  const reason = failedDeliveryReason(group.deliveryNote || group.safePlaceNote);
  const lineItemLines = normaliseStoredLineItemLines(orderStop.lineItemSummary || "");
  const lineItemSummary = lineItemLines.join(", ") || "1 × Redelivery required";

  return {
    id: orderStop.shopifyOrderId,
    name: orderStop.shopifyOrderNumber,
    createdAt: (failedStop.actualArrival || orderStop.createdAt).toISOString(),
    customerName: orderStop.customerName || "Customer",
    email: orderStop.customerEmail,
    phone: orderStop.customerPhone,
    shippingMethod: "Redelivery required",
    fulfilmentStatus: "redelivery_required",
    financialStatus: "paid",
    postcode: group.postcode || orderStop.postcode,
    addressSummary: group.formattedAddress || group.manualAddress || group.address,
    formattedAddress: group.formattedAddress || group.manualAddress || group.address,
    hasDeliveryAddress: true,
    hasPanel: true,
    isSampleOnly: false,
    addressStatus: group.latitude && group.longitude ? "READY" : "NEEDS_LOCATION_CHECK",
    addressConfidence: group.latitude && group.longitude ? "HIGH" : "LOW",
    latitude: group.latitude,
    longitude: group.longitude,
    lineItemSummary,
    lineItemLines: [redeliveryLine(reason), ...(lineItemLines.length ? lineItemLines : [lineItemSummary])],
    fulfilByDate: null,
    hasManualOverride: group.useManualAddress,
    manualAddress: group.manualAddress,
    manualAddressNotes: group.useManualAddress ? "Redelivery from missed POD" : null,
    orderSource: orderStop.orderSource === "manual" ? "manual" : "shopify",
    routeAllocation: null,
    isRedelivery: true,
    redeliveryReason: reason,
    redeliveryRouteName: failedStop.route.name,
    redeliveryAttemptedAt: failedStop.actualArrival?.toISOString() || null,
  };
}

async function getFailedRedeliveryOrderStops() {
  return prisma.orderStop.findMany({
    where: {
      deliveryGroup: {
        stops: {
          some: {
            status: "FAILED",
          },
        },
      },
    },
    include: {
      deliveryGroup: {
        include: {
          stops: {
            include: {
              route: true,
            },
          },
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
}

async function getFailedRedeliveryOrders() {
  const failedOrderStops = await getFailedRedeliveryOrderStops();
  const orderIds = [...new Set(failedOrderStops.map((orderStop) => orderStop.shopifyOrderId))];

  if (!orderIds.length) {
    return [];
  }

  const deliveredOrderStops = await prisma.orderStop.findMany({
    where: {
      shopifyOrderId: {
        in: orderIds,
      },
      deliveryGroup: {
        stops: {
          some: {
            status: "DELIVERED",
          },
        },
      },
    },
    select: {
      shopifyOrderId: true,
    },
  });
  const deliveredOrderIds = new Set(deliveredOrderStops.map((orderStop) => orderStop.shopifyOrderId));
  const redeliveryByOrderId = new Map<string, DeliveryOrder>();

  for (const orderStop of failedOrderStops) {
    if (deliveredOrderIds.has(orderStop.shopifyOrderId)) {
      continue;
    }

    const redeliveryOrder = toRedeliveryOrder(orderStop);

    if (redeliveryOrder && !redeliveryByOrderId.has(redeliveryOrder.id)) {
      redeliveryByOrderId.set(redeliveryOrder.id, redeliveryOrder);
    }
  }

  return [...redeliveryByOrderId.values()];
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
                quantity
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
  const response = await admin.graphql(DELIVERY_ORDERS_QUERY, { variables: { query, cursor } });
  const payload = await response.json() as DeliveryOrdersPayload;
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).join(", "));
  return payload.data?.orders;
}

export async function getDeliveryOrders(admin: ShopifyAdmin) {
  const query = "status:open";
  const orders: ShopifyOrderNode[] = [];
  let cursor: string | null = null;
  let page = 0;

  do {
    const result = await fetchDeliveryOrderPage(admin, query, cursor);
    if (!result) break;
    orders.push(...result.edges.map((edge) => edge.node));
    cursor = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : null;
    page += 1;
  } while (cursor && page < 10);

  const filteredOrders = orders.filter(shouldShowOnDeliveryMap);
  const [overrides, redeliveryOrders] = await Promise.all([
    getAddressOverridesByOrderId(),
    getFailedRedeliveryOrders(),
  ]);
  const deliveryOrders = await Promise.all(filteredOrders.map((order) => toDeliveryOrder(order, overrides.get(order.id))));
  const redeliveryOrdersById = new Map(redeliveryOrders.map((order) => [order.id, order]));
  const mergedOrdersById = new Map<string, DeliveryOrder>();

  for (const order of deliveryOrders) {
    mergedOrdersById.set(order.id, applyRedeliveryFlag(order, redeliveryOrdersById.get(order.id)));
  }

  for (const redeliveryOrder of redeliveryOrders) {
    if (!mergedOrdersById.has(redeliveryOrder.id)) {
      mergedOrdersById.set(redeliveryOrder.id, redeliveryOrder);
    }
  }

  const mergedOrders = [...mergedOrdersById.values()];
  const allocations = await getActiveRouteAllocations(mergedOrders.map((order) => order.id));

  return mergedOrders
    .filter((order) => !allocations.has(order.id))
    .map((order) => applyRouteAllocation(order, allocations.get(order.id)));
}
