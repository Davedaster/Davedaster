import crypto from "node:crypto";

import prisma from "../db.server";

const TRACKING_CODE_BYTES = 6;
const TRACKABLE_ROUTE_STATUSES = ["PUBLISHED", "NOTIFICATIONS_SENT", "OUT_FOR_DELIVERY", "COMPLETED"];
const DEFAULT_APP_BASE_URL = "https://davedaster-production.up.railway.app";

function createTrackingCode() {
  return crypto
    .randomBytes(TRACKING_CODE_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function getPublicAppBaseUrl(fallbackUrl?: string | null) {
  return (
    process.env.APP_BASE_URL ||
    process.env.SHOPIFY_APP_URL ||
    DEFAULT_APP_BASE_URL ||
    fallbackUrl ||
    ""
  ).replace(/\/+$/g, "");
}

export function buildShortCustomerTrackingUrl(baseUrl: string, trackingCode: string) {
  const cleanBaseUrl = getPublicAppBaseUrl(baseUrl);

  return `${cleanBaseUrl}/t/${encodeURIComponent(trackingCode)}`;
}

export async function ensureCustomerTrackingCode(orderStopId: string) {
  const existing = await prisma.orderStop.findUnique({
    where: {
      id: orderStopId,
    },
    select: {
      trackingCode: true,
    },
  });

  if (!existing) {
    throw new Error("Customer tracking order could not be found.");
  }

  if (existing.trackingCode) {
    return existing.trackingCode;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const trackingCode = createTrackingCode();
      const updated = await prisma.orderStop.update({
        where: {
          id: orderStopId,
        },
        data: {
          trackingCode,
        },
        select: {
          trackingCode: true,
        },
      });

      if (updated.trackingCode) {
        return updated.trackingCode;
      }
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code) : "";

      if (code !== "P2002") {
        throw error;
      }
    }
  }

  throw new Error("Customer tracking code could not be created.");
}

export async function getCustomerTrackingByCode(trackingCode: string) {
  return prisma.orderStop.findUnique({
    where: {
      trackingCode,
    },
    include: {
      deliveryGroup: {
        include: {
          orders: true,
          proofPhotos: {
            orderBy: {
              createdAt: "asc",
            },
          },
          stops: {
            where: {
              route: {
                status: {
                  in: TRACKABLE_ROUTE_STATUSES,
                },
              },
            },
            include: {
              route: {
                include: {
                  driver: true,
                },
              },
            },
            orderBy: {
              orderIndex: "asc",
            },
          },
        },
      },
    },
  });
}

export async function getOrCreateCustomerTrackingCodeForRouteOrder(routeId: string, shopifyOrderId: string) {
  const stop = await prisma.stop.findFirst({
    where: {
      routeId,
      deliveryGroup: {
        orders: {
          some: {
            shopifyOrderId,
          },
        },
      },
    },
    include: {
      deliveryGroup: {
        include: {
          orders: true,
        },
      },
    },
  });

  const order = stop?.deliveryGroup?.orders.find((entry) => entry.shopifyOrderId === shopifyOrderId);

  if (!order) {
    return null;
  }

  return ensureCustomerTrackingCode(order.id);
}
