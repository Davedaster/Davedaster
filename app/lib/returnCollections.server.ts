import crypto from "node:crypto";

import prisma from "../db.server";
import { lookupAddress } from "./getAddress.server";
import type { DeliveryOrder } from "./shopifyOrders.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type ShopifyReturnLineItem = {
  id: string;
  title: string;
  quantity: number;
  sku: string | null;
};

type ShopifyReturnOrder = {
  id: string;
  name: string;
  createdAt: string;
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
  lineItems: {
    edges: Array<{
      node: ShopifyReturnLineItem;
    }>;
  };
};

type ShopifyReturnOrderPayload = {
  data?: {
    orders?: {
      edges: Array<{
        node: ShopifyReturnOrder;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
};

export type ReturnCollectionOrderLine = {
  itemName: string;
  quantityExpected: number;
};

export type ReturnCollectionPlanningPin = {
  id: string;
  reference: string;
  orderNumber: string;
  customerName: string;
  postcode: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  originalOrderCreatedAt: string | null;
  returnRequestedAt: string;
  lines: ReturnCollectionOrderLine[];
};

export type CreateReturnCollectionInput = {
  admin: ShopifyAdmin;
  orderNumber: string;
  selectedLines: ReturnCollectionOrderLine[];
  notes?: string | null;
};

const RETURN_ORDER_QUERY = `#graphql
  query ReturnCollectionOrder($query: String!) {
    orders(first: 1, sortKey: CREATED_AT, reverse: true, query: $query) {
      edges {
        node {
          id
          name
          createdAt
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
          lineItems(first: 100) {
            edges {
              node {
                id
                title
                quantity
                sku
              }
            }
          }
        }
      }
    }
  }
`;

function normaliseOrderNumber(value: string) {
  const trimmed = value.trim();
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function safeShopifyQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function customerName(order: ShopifyReturnOrder) {
  const firstName = order.customer?.firstName || "";
  const lastName = order.customer?.lastName || "";
  const fromCustomer = `${firstName} ${lastName}`.trim();
  const fromAddress = order.shippingAddress?.name || "";

  return fromCustomer || fromAddress || "Customer";
}

function formatAddress(order: ShopifyReturnOrder) {
  const address = order.shippingAddress;

  if (!address) {
    return "No delivery address stored on original order";
  }

  return [address.address1, address.address2, address.city, address.province, address.zip, address.country]
    .filter(Boolean)
    .join(", ");
}

function extractPostcode(value: string) {
  const match = value.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);

  return match?.[0]?.toUpperCase() || "";
}

function buildSearchText(input: {
  reference?: string;
  orderNumber?: string | null;
  customerName?: string | null;
  address?: string | null;
  postcode?: string | null;
}) {
  return [input.reference, input.orderNumber, input.customerName, input.address, input.postcode]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function createReturnReference() {
  const date = new Date();
  const stamp = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();

  return `RET-${stamp}-${random}`;
}

function createProofToken() {
  return crypto.randomBytes(16).toString("hex");
}

function normaliseSelectedLines(lines: ReturnCollectionOrderLine[]) {
  return lines
    .map((line) => ({
      itemName: line.itemName.trim(),
      quantityExpected: Math.max(1, Math.round(Number(line.quantityExpected) || 1)),
    }))
    .filter((line) => line.itemName && line.quantityExpected > 0);
}

function lineSummary(lines: ReturnCollectionOrderLine[]) {
  return lines.map((line) => `${line.quantityExpected} × ${line.itemName}`).join(", ");
}

function returnTicketIdFromPlanningOrderId(orderId: string) {
  return orderId.startsWith("return:") ? orderId.replace("return:", "") : null;
}

export async function findShopifyOrderForReturn(admin: ShopifyAdmin, orderNumber: string) {
  const normalisedOrderNumber = normaliseOrderNumber(orderNumber);
  const response = await admin.graphql(RETURN_ORDER_QUERY, {
    variables: {
      query: `name:\"${safeShopifyQueryValue(normalisedOrderNumber)}\"`,
    },
  });
  const payload = await response.json() as ShopifyReturnOrderPayload;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join(", "));
  }

  const order = payload.data?.orders?.edges?.[0]?.node || null;

  if (!order) {
    return null;
  }

  return {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    customerName: customerName(order),
    customerEmail: order.email || order.customer?.email || null,
    customerPhone: order.phone || order.shippingAddress?.phone || order.customer?.phone || null,
    address: formatAddress(order),
    postcode: order.shippingAddress?.zip || extractPostcode(formatAddress(order)) || null,
    lineItems: order.lineItems.edges.map((edge) => ({
      id: edge.node.id,
      title: edge.node.title,
      quantity: edge.node.quantity,
      sku: edge.node.sku,
    })),
  };
}

export async function createReturnCollectionFromShopifyOrder(input: CreateReturnCollectionInput) {
  const order = await findShopifyOrderForReturn(input.admin, input.orderNumber);

  if (!order) {
    throw new Error("Original Shopify order could not be found.");
  }

  const lines = normaliseSelectedLines(input.selectedLines);

  if (!lines.length) {
    throw new Error("Choose at least one item to collect.");
  }

  const lookup = await lookupAddress(order.postcode, order.address);
  const reference = createReturnReference();
  const postcode = lookup.postcode || order.postcode || extractPostcode(order.address) || null;
  const address = lookup.formattedAddress || order.address;

  return prisma.returnTicket.create({
    data: {
      reference,
      status: "OPEN",
      originalOrderId: order.id,
      originalOrderCreatedAt: new Date(order.createdAt),
      returnRequestedAt: new Date(),
      orderNumber: order.name,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      address,
      postcode,
      latitude: lookup.latitude,
      longitude: lookup.longitude,
      notes: input.notes?.trim() || null,
      collectionProofToken: createProofToken(),
      searchText: buildSearchText({
        reference,
        orderNumber: order.name,
        customerName: order.customerName,
        address,
        postcode,
      }),
      lines: {
        create: lines,
      },
    },
    include: {
      lines: true,
      route: true,
      stop: true,
    },
  });
}

export async function listOpenReturnCollectionPins(): Promise<ReturnCollectionPlanningPin[]> {
  const tickets = await prisma.returnTicket.findMany({
    where: {
      status: {
        in: ["OPEN", "ASSIGNED"],
      },
      OR: [
        { routeId: null, stopId: null },
        { stopId: null },
        { route: { status: "CANCELLED" } },
      ],
    },
    include: {
      lines: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
    orderBy: {
      returnRequestedAt: "desc",
    },
  });

  return tickets.map((ticket) => ({
    id: `return:${ticket.id}`,
    reference: ticket.reference,
    orderNumber: ticket.orderNumber || ticket.reference,
    customerName: ticket.customerName,
    postcode: ticket.postcode,
    address: ticket.address,
    latitude: ticket.latitude,
    longitude: ticket.longitude,
    originalOrderCreatedAt: ticket.originalOrderCreatedAt?.toISOString() || null,
    returnRequestedAt: ticket.returnRequestedAt.toISOString(),
    lines: ticket.lines.map((line) => ({
      itemName: line.itemName,
      quantityExpected: line.quantityExpected,
    })),
  }));
}

export function returnCollectionPinsToDeliveryOrders(pins: ReturnCollectionPlanningPin[]): DeliveryOrder[] {
  return pins.map((pin) => {
    const lineItemLines = pin.lines.map((line) => `${line.quantityExpected} × ${line.itemName}`);
    const hasCoordinates = typeof pin.latitude === "number" && typeof pin.longitude === "number";

    return {
      id: pin.id,
      name: pin.orderNumber,
      createdAt: pin.originalOrderCreatedAt || pin.returnRequestedAt,
      customerName: pin.customerName,
      email: null,
      phone: null,
      shippingMethod: "Return collection",
      fulfilmentStatus: "return",
      financialStatus: "return",
      postcode: pin.postcode,
      addressSummary: pin.address,
      formattedAddress: pin.address,
      hasDeliveryAddress: true,
      hasPanel: true,
      isSampleOnly: false,
      addressStatus: hasCoordinates ? "READY" : "NEEDS_LOCATION_CHECK",
      addressConfidence: hasCoordinates ? "HIGH" : "LOW",
      latitude: pin.latitude,
      longitude: pin.longitude,
      lineItemSummary: lineSummary(pin.lines),
      lineItemLines,
      fulfilByDate: null,
      hasManualOverride: true,
      manualAddress: pin.address,
      manualAddressNotes: "Return collection created from the Returns page",
      orderSource: "manual",
      isReturnCollection: true,
      returnRequestedAt: pin.returnRequestedAt,
    };
  });
}

export async function markReturnCollectionsAssignedToRoute(routeId: string, selectedOrderIds: string[]) {
  const selectedReturnTicketIds = selectedOrderIds
    .map(returnTicketIdFromPlanningOrderId)
    .filter((id): id is string => Boolean(id));

  if (!selectedReturnTicketIds.length) {
    return;
  }

  const route = await prisma.route.findUnique({
    where: { id: routeId },
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
    return;
  }

  for (const stop of route.stops) {
    const returnOrder = stop.deliveryGroup?.orders.find((order) => selectedOrderIds.includes(order.shopifyOrderId));
    const ticketId = returnTicketIdFromPlanningOrderId(returnOrder?.shopifyOrderId || "");

    if (!ticketId || !selectedReturnTicketIds.includes(ticketId)) {
      continue;
    }

    await prisma.returnTicket.updateMany({
      where: {
        id: ticketId,
        status: {
          in: ["OPEN", "ASSIGNED"],
        },
      },
      data: {
        routeId,
        stopId: stop.id,
        status: "ASSIGNED",
      },
    });
  }
}

export async function listCollectedReturnArchive(query = "") {
  const trimmed = query.trim().toLowerCase();

  return prisma.returnTicket.findMany({
    where: {
      status: {
        in: ["COLLECTED", "COULD_NOT_COLLECT", "CANCELLED"],
      },
      ...(trimmed
        ? {
            searchText: {
              contains: trimmed,
            },
          }
        : {}),
    },
    include: {
      lines: {
        orderBy: {
          createdAt: "asc",
        },
      },
      route: {
        include: {
          driver: true,
        },
      },
      stop: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 100,
  });
}

export function returnCollectionItemsSummary(lines: ReturnCollectionOrderLine[]) {
  return lineSummary(lines) || "Items not listed";
}
