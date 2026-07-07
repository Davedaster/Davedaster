import prisma from "../db.server";
import { lookupAddress } from "./getAddress.server";
import { calculateEtaSlots } from "./routeDrafts.server";
import type { DeliveryOrder } from "./shopifyOrders.server";

export type ReturnTicketInput = {
  stopId?: string | null;
  orderNumber?: string | null;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  address: string;
  postcode?: string | null;
  notes?: string | null;
  itemsText: string;
};

type ReturnLineInput = {
  itemName: string;
  quantityExpected: number;
};

export type CompleteReturnTicketInput = {
  ticketId: string;
  quantities: Record<string, number>;
  collectionPhotoUrl?: string | null;
  customerSignature?: string | null;
  driverNote?: string | null;
};

type ReturnTicketWithLines = Awaited<ReturnType<typeof getReturnTicketsForPlanning>>[number];

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
  return [
    input.reference,
    input.orderNumber,
    input.customerName,
    input.address,
    input.postcode,
  ]
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

function parseReturnLines(itemsText: string): ReturnLineInput[] {
  return itemsText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const quantityMatch = line.match(/^(\d+)\s*(x|×|-)?\s*(.+)$/i);

      if (quantityMatch) {
        return {
          quantityExpected: Math.max(1, Number(quantityMatch[1]) || 1),
          itemName: quantityMatch[3].trim(),
        };
      }

      return {
        quantityExpected: 1,
        itemName: line,
      };
    })
    .filter((line) => line.itemName);
}

function linesSummary(lines: Array<{ itemName: string; quantityExpected: number }>) {
  return lines.map((line) => `${line.quantityExpected} x ${line.itemName}`).join(", ");
}

function normalisedReturnLine(line: { itemName: string; quantityExpected: number }) {
  const quantity = Number(line.quantityExpected || 1);
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1;
  return `${safeQuantity} × ${line.itemName}`;
}

function assignmentHistoryDetails(ticket: { reference: string; orderNumber: string | null; customerName: string; postcode: string | null }) {
  return `${ticket.reference} · ${ticket.orderNumber || "No order number"} · ${ticket.customerName} · ${ticket.postcode || "No postcode"}`;
}

function returnTicketIdFromPlanningOrderId(value: string) {
  return value.startsWith("return:") ? value.slice("return:".length) : "";
}

async function getReturnTicketsForPlanning() {
  return prisma.returnTicket.findMany({
    where: {
      status: "OPEN",
      routeId: null,
      stopId: null,
    },
    include: {
      lines: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
    orderBy: {
      returnRequestedAt: "asc",
    },
    take: 50,
  });
}

async function returnTicketToPlanningOrder(ticket: ReturnTicketWithLines): Promise<DeliveryOrder> {
  const postcode = ticket.postcode || extractPostcode(ticket.address);
  const lookup = ticket.latitude !== null && ticket.longitude !== null
    ? null
    : await lookupAddress(postcode, ticket.address);
  const latitude = ticket.latitude ?? lookup?.latitude ?? null;
  const longitude = ticket.longitude ?? lookup?.longitude ?? null;
  const formattedAddress = lookup?.formattedAddress || ticket.address;
  const lineItemLines = ticket.lines.map(normalisedReturnLine);
  const lineItemSummary = lineItemLines.join(", ") || "1 × Return collection";

  return {
    id: `return:${ticket.id}`,
    name: ticket.orderNumber || ticket.reference,
    createdAt: ticket.returnRequestedAt.toISOString(),
    customerName: ticket.customerName,
    email: ticket.customerEmail,
    phone: ticket.customerPhone,
    shippingMethod: "Return collection",
    fulfilmentStatus: "return_collection",
    financialStatus: "return",
    postcode: lookup?.postcode || postcode || null,
    addressSummary: ticket.address,
    formattedAddress,
    hasDeliveryAddress: Boolean(ticket.address),
    hasPanel: true,
    isSampleOnly: false,
    addressStatus: latitude !== null && longitude !== null ? "READY" : "NEEDS_LOCATION_CHECK",
    addressConfidence: latitude !== null && longitude !== null ? "HIGH" : "LOW",
    latitude,
    longitude,
    lineItemSummary,
    lineItemLines: ["\u{1F534} Return collection", ...lineItemLines],
    fulfilByDate: null,
    hasManualOverride: true,
    manualAddress: ticket.address,
    manualAddressNotes: ticket.notes || "Return collection added from Returns page",
    orderSource: "return",
    routeAllocation: null,
  };
}

export async function listOpenReturnPlanningOrders() {
  const tickets = await getReturnTicketsForPlanning();
  return Promise.all(tickets.map(returnTicketToPlanningOrder));
}

export async function linkPlannedReturnTicketsToRoute(routeId: string) {
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
    throw new Error("Route not found for return linking.");
  }

  const returnStops = route.stops.flatMap((stop) => {
    const returnOrders = stop.deliveryGroup?.orders.filter((order) => order.orderSource === "return" || order.shopifyOrderId.startsWith("return:")) || [];
    return returnOrders.map((order) => ({ stop, order, ticketId: returnTicketIdFromPlanningOrderId(order.shopifyOrderId) })).filter((item) => item.ticketId);
  });

  if (!returnStops.length) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const item of returnStops) {
      await tx.returnTicket.updateMany({
        where: {
          id: item.ticketId,
          status: "OPEN",
          routeId: null,
          stopId: null,
        },
        data: {
          status: "ASSIGNED",
          routeId: route.id,
          stopId: item.stop.id,
        },
      });
    }

    await tx.routeHistory.create({
      data: {
        routeId: route.id,
        action: "Return collections linked",
        details: `${returnStops.length} return collection${returnStops.length === 1 ? "" : "s"} linked to this draft route`,
      },
    });
  });
}

export async function listDraftRoutesForReturnAssignment() {
  return prisma.route.findMany({
    where: {
      status: "DRAFT",
    },
    orderBy: [
      { date: "asc" },
      { createdAt: "desc" },
    ],
    include: {
      driver: true,
      stops: {
        orderBy: {
          orderIndex: "asc",
        },
      },
    },
    take: 50,
  });
}

export async function listReturnAssignableStops() {
  const routes = await prisma.route.findMany({
    where: {
      status: {
        in: ["DRAFT", "PUBLISHED", "NOTIFICATIONS_SENT", "OUT_FOR_DELIVERY"],
      },
    },
    orderBy: {
      date: "desc",
    },
    include: {
      stops: {
        orderBy: {
          orderIndex: "asc",
        },
        include: {
          deliveryGroup: {
            include: {
              orders: true,
            },
          },
        },
      },
    },
    take: 30,
  });

  return routes.flatMap((route) => route.stops.map((stop) => {
    const orders = stop.deliveryGroup?.orders || [];
    const orderNumbers = orders.map((order) => order.shopifyOrderNumber).join(", ") || "No order number";
    const customerNames = orders.map((order) => order.customerName).filter(Boolean).join(", ") || "No customer";
    const address = stop.deliveryGroup?.address || "No address";

    return {
      label: `${route.name} · Stop ${stop.orderIndex} · ${orderNumbers} · ${customerNames}`,
      value: stop.id,
      routeId: route.id,
      stopId: stop.id,
      orderNumber: orderNumbers,
      customerName: customerNames,
      customerEmail: orders.map((order) => order.customerEmail).filter(Boolean)[0] || "",
      customerPhone: orders.map((order) => order.customerPhone).filter(Boolean)[0] || "",
      address,
      postcode: stop.deliveryGroup?.postcode || extractPostcode(address),
    };
  }));
}

export async function createReturnTicket(input: ReturnTicketInput) {
  const lines = parseReturnLines(input.itemsText);

  if (!input.customerName.trim()) {
    throw new Error("Customer name is required.");
  }

  if (!input.address.trim()) {
    throw new Error("Address is required.");
  }

  if (!lines.length) {
    throw new Error("Add at least one item to collect.");
  }

  const stop = input.stopId
    ? await prisma.stop.findUnique({ where: { id: input.stopId }, select: { id: true, routeId: true } })
    : null;
  const reference = createReturnReference();
  const postcode = input.postcode?.trim() || extractPostcode(input.address);

  return prisma.returnTicket.create({
    data: {
      reference,
      routeId: stop?.routeId || null,
      stopId: stop?.id || null,
      orderNumber: input.orderNumber?.trim() || null,
      customerName: input.customerName.trim(),
      customerEmail: input.customerEmail?.trim() || null,
      customerPhone: input.customerPhone?.trim() || null,
      address: input.address.trim(),
      postcode: postcode || null,
      notes: input.notes?.trim() || null,
      searchText: buildSearchText({
        reference,
        orderNumber: input.orderNumber,
        customerName: input.customerName,
        address: input.address,
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

export async function assignReturnTicketToDraftRoute(ticketId: string, routeId: string) {
  if (!ticketId || !routeId) {
    throw new Error("Choose a return collection and a draft route.");
  }

  const [route, ticket] = await Promise.all([
    prisma.route.findUnique({
      where: {
        id: routeId,
      },
      include: {
        stops: {
          orderBy: {
            orderIndex: "asc",
          },
        },
      },
    }),
    prisma.returnTicket.findUnique({
      where: {
        id: ticketId,
      },
      include: {
        lines: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    }),
  ]);

  if (!route) {
    throw new Error("Draft route not found.");
  }

  if (route.status !== "DRAFT") {
    throw new Error("Return collections can only be assigned to draft routes.");
  }

  if (!ticket) {
    throw new Error("Return collection not found.");
  }

  if (ticket.status !== "OPEN") {
    throw new Error("Only open return collections can be assigned to a draft route.");
  }

  if (ticket.stopId || ticket.routeId) {
    throw new Error("This return collection is already assigned to a route.");
  }

  const nextOrderIndex = route.stops.reduce((max, stop) => Math.max(max, stop.orderIndex), 0) + 1;
  const summary = linesSummary(ticket.lines);
  const postcode = ticket.postcode || extractPostcode(ticket.address);

  const stop = await prisma.$transaction(async (tx) => {
    const deliveryGroup = await tx.deliveryGroup.create({
      data: {
        address: ticket.address,
        formattedAddress: ticket.address,
        postcode: postcode || null,
        latitude: ticket.latitude,
        longitude: ticket.longitude,
        addressStatus: ticket.latitude !== null && ticket.longitude !== null ? "READY" : "NEEDS_LOCATION_CHECK",
        addressSource: ticket.latitude !== null && ticket.longitude !== null ? "getaddress" : "none",
        addressConfidence: ticket.latitude !== null && ticket.longitude !== null ? "HIGH" : "LOW",
        manualAddress: ticket.address,
        useManualAddress: true,
        orders: {
          create: {
            shopifyOrderId: `return:${ticket.id}`,
            shopifyOrderNumber: ticket.orderNumber || ticket.reference,
            orderSource: "return",
            customerName: ticket.customerName,
            customerEmail: ticket.customerEmail,
            customerPhone: ticket.customerPhone,
            postcode: postcode || null,
            lineItemSummary: summary,
          },
        },
      },
    });

    const stop = await tx.stop.create({
      data: {
        routeId: route.id,
        orderIndex: nextOrderIndex,
        isLocked: false,
        deliveryGroupId: deliveryGroup.id,
      },
    });

    await tx.returnTicket.update({
      where: {
        id: ticket.id,
      },
      data: {
        status: "ASSIGNED",
        routeId: route.id,
        stopId: stop.id,
      },
    });

    await tx.route.update({
      where: {
        id: route.id,
      },
      data: {
        totalMileage: null,
        totalDuration: null,
        history: {
          create: {
            action: "Return collection assigned",
            details: assignmentHistoryDetails(ticket),
          },
        },
      },
    });

    return stop;
  });

  await calculateEtaSlots(route.id);

  return stop;
}

export async function searchReturnTickets(query: string) {
  const trimmed = query.trim().toLowerCase();

  return prisma.returnTicket.findMany({
    where: trimmed
      ? {
          searchText: {
            contains: trimmed,
          },
        }
      : undefined,
    orderBy: {
      createdAt: "desc",
    },
    include: {
      lines: {
        orderBy: {
          createdAt: "asc",
        },
      },
      route: true,
      stop: true,
    },
    take: 50,
  });
}

export async function completeReturnTicket(input: CompleteReturnTicketInput) {
  const ticket = await prisma.returnTicket.findUnique({
    where: {
      id: input.ticketId,
    },
    include: {
      lines: true,
    },
  });

  if (!ticket) {
    throw new Error("Return ticket not found.");
  }

  if (ticket.status !== "OPEN") {
    throw new Error("This return ticket is not open.");
  }

  await prisma.$transaction(async (tx) => {
    for (const line of ticket.lines) {
      await tx.returnTicketLine.update({
        where: {
          id: line.id,
        },
        data: {
          quantityCollected: Math.max(0, Math.round(input.quantities[line.id] ?? 0)),
        },
      });
    }

    await tx.returnTicket.update({
      where: {
        id: ticket.id,
      },
      data: {
        status: "COLLECTED",
        collectionPhotoUrl: input.collectionPhotoUrl || null,
        customerSignature: input.customerSignature?.trim() || null,
        driverNote: input.driverNote?.trim() || null,
        collectedAt: new Date(),
      },
    });
  });
}

export async function completeReturnTicketFromDriverToken(token: string, input: CompleteReturnTicketInput) {
  const ticket = await prisma.returnTicket.findFirst({
    where: {
      id: input.ticketId,
      status: "OPEN",
      route: {
        driverAccessToken: token,
        status: "OUT_FOR_DELIVERY",
      },
    },
    select: {
      id: true,
    },
  });

  if (!ticket) {
    throw new Error("Return ticket not found for this active driver route.");
  }

  return completeReturnTicket(input);
}
