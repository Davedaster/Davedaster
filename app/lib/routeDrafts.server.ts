import prisma from "../db.server";
import type { DeliveryOrder } from "./shopifyOrders.server";

type CreateRouteDraftInput = {
  orders: DeliveryOrder[];
  routeName?: string;
};

function getTodayRouteDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function buildRouteName(orders: DeliveryOrder[], routeName?: string) {
  if (routeName?.trim()) {
    return routeName.trim();
  }

  const date = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date());

  return `Draft route ${date} ${orders.length} stops`;
}

export async function createRouteDraft(input: CreateRouteDraftInput) {
  const name = buildRouteName(input.orders, input.routeName);

  return prisma.route.create({
    data: {
      name,
      date: getTodayRouteDate(),
      status: "DRAFT",
      stops: {
        create: input.orders.map((order, index) => ({
          orderIndex: index + 1,
          isLocked: false,
          deliveryGroup: {
            create: {
              address: order.formattedAddress || order.addressSummary,
              formattedAddress: order.formattedAddress,
              postcode: order.postcode,
              latitude: order.latitude,
              longitude: order.longitude,
              addressStatus: order.addressStatus,
              addressSource: order.hasManualOverride ? "manual" : "getaddress",
              addressConfidence: order.addressConfidence,
              manualAddress: order.manualAddress,
              useManualAddress: order.hasManualOverride,
              orders: {
                create: {
                  shopifyOrderId: order.id,
                  shopifyOrderNumber: order.name,
                  customerName: order.customerName,
                  postcode: order.postcode,
                },
              },
            },
          },
        })),
      },
      history: {
        create: {
          action: "Route created",
          details: `Draft route created with ${input.orders.length} stops`,
        },
      },
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
        orderBy: {
          orderIndex: "asc",
        },
      },
      history: true,
    },
  });
}

export async function listRoutes() {
  return prisma.route.findMany({
    orderBy: {
      createdAt: "desc",
    },
    include: {
      driver: true,
      stops: {
        include: {
          deliveryGroup: {
            include: {
              orders: true,
            },
          },
        },
        orderBy: {
          orderIndex: "asc",
        },
      },
    },
  });
}

export async function getRoute(routeId: string) {
  return prisma.route.findUnique({
    where: {
      id: routeId,
    },
    include: {
      driver: true,
      stops: {
        include: {
          deliveryGroup: {
            include: {
              orders: true,
            },
          },
        },
        orderBy: {
          orderIndex: "asc",
        },
      },
      history: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });
}

export async function publishRoute(routeId: string) {
  return prisma.route.update({
    where: {
      id: routeId,
    },
    data: {
      status: "PUBLISHED",
      history: {
        create: {
          action: "Route published",
          details: "Route was published from the route details page",
        },
      },
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
      history: true,
    },
  });
}

export async function renameRoute(routeId: string, name: string) {
  return prisma.route.update({
    where: {
      id: routeId,
    },
    data: {
      name,
      history: {
        create: {
          action: "Route renamed",
          details: `Route renamed to ${name}`,
        },
      },
    },
  });
}

export async function assignDriverToRoute(routeId: string, driverId: string | null) {
  const driver = driverId
    ? await prisma.driver.findUnique({ where: { id: driverId } })
    : null;

  return prisma.route.update({
    where: {
      id: routeId,
    },
    data: {
      driverId,
      history: {
        create: {
          action: driver ? "Driver assigned" : "Driver removed",
          details: driver ? `Assigned to ${driver.name}` : "Driver assignment removed",
        },
      },
    },
  });
}
