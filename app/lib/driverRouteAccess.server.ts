import crypto from "node:crypto";

import prisma from "../db.server";
import { markStopFailedDelivery } from "./failedDelivery.server";
import { isResendEnabled, isTwilioEnabled, sendEmailWithResend, sendSmsWithTwilio } from "./notificationSenders.server";
import { saveProofOfDelivery } from "./proofOfDelivery.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type DriverRouteNotificationResult = {
  smsSent: boolean;
  emailSent: boolean;
  errors: string[];
};

function getBaseUrl(request: Request) {
  const configuredBaseUrl = process.env.APP_BASE_URL || process.env.SHOPIFY_APP_URL;

  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function formatTime(value: Date | string | null | undefined) {
  if (!value) {
    return "time to be confirmed";
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function dateKey(value: Date | string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function buildDriverRouteUrl(request: Request, token: string) {
  return `${getBaseUrl(request)}/driver/routes/${token}`;
}

export async function ensureDriverRouteAccessToken(routeId: string) {
  const route = await prisma.route.findUnique({
    where: {
      id: routeId,
    },
    select: {
      id: true,
      driverAccessToken: true,
    },
  });

  if (!route) {
    throw new Error("Route not found.");
  }

  if (route.driverAccessToken) {
    return route.driverAccessToken;
  }

  const token = createToken();

  await prisma.route.update({
    where: {
      id: routeId,
    },
    data: {
      driverAccessToken: token,
      driverAccessTokenCreatedAt: new Date(),
      history: {
        create: {
          action: "Driver route link created",
          details: "Secure driver route access link was created",
        },
      },
    },
  });

  return token;
}

export async function getDriverRouteByToken(token: string) {
  return prisma.route.findFirst({
    where: {
      driverAccessToken: token,
      status: {
        in: ["PUBLISHED", "NOTIFICATIONS_SENT", "OUT_FOR_DELIVERY", "COMPLETED"],
      },
    },
    include: {
      driver: true,
      stops: {
        include: {
          returnTickets: {
            include: {
              lines: {
                orderBy: {
                  createdAt: "asc",
                },
              },
            },
            orderBy: {
              createdAt: "asc",
            },
          },
          deliveryGroup: {
            include: {
              orders: true,
              proofPhotos: {
                orderBy: {
                  createdAt: "asc",
                },
              },
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

export function canStartDriverRoute(routeDate: Date | string, now = new Date()) {
  return dateKey(routeDate) === dateKey(now);
}

export async function startDriverRouteFromToken(token: string) {
  const route = await getDriverRouteByToken(token);

  if (!route) {
    throw new Error("Driver route not found.");
  }

  if (route.status === "OUT_FOR_DELIVERY" || route.status === "COMPLETED") {
    return route;
  }

  if (!canStartDriverRoute(route.date)) {
    throw new Error("This route can only be started on the planned route date.");
  }

  return prisma.route.update({
    where: {
      id: route.id,
    },
    data: {
      status: "OUT_FOR_DELIVERY",
      history: {
        create: {
          action: "Driver started route",
          details: "Route started from secure driver route link",
        },
      },
    },
  });
}

async function getStopForDriverToken(token: string, stopId: string) {
  const stop = await prisma.stop.findFirst({
    where: {
      id: stopId,
      route: {
        driverAccessToken: token,
        status: {
          in: ["OUT_FOR_DELIVERY"],
        },
      },
    },
    include: {
      route: true,
      deliveryGroup: true,
    },
  });

  if (!stop) {
    throw new Error("Stop not found for this active driver route.");
  }

  return stop;
}

export async function completeDriverStopFromToken(input: {
  token: string;
  stopId: string;
  admin: ShopifyAdmin;
  proofPhotoUrls: string[];
  deliveryNote?: string | null;
  safePlaceNote?: string | null;
  leftInSafePlace?: boolean;
}) {
  await getStopForDriverToken(input.token, input.stopId);

  await saveProofOfDelivery({
    admin: input.admin,
    stopId: input.stopId,
    proofPhotoUrl: input.proofPhotoUrls,
    deliveryNote: input.deliveryNote,
    safePlaceNote: input.safePlaceNote,
    leftInSafePlace: input.leftInSafePlace,
  });
}

export async function markDriverStopMissedFromToken(input: {
  token: string;
  stopId: string;
  admin: ShopifyAdmin;
  reason: string;
  note?: string | null;
}) {
  await getStopForDriverToken(input.token, input.stopId);

  await markStopFailedDelivery({
    admin: input.admin,
    stopId: input.stopId,
    reason: input.reason,
    note: input.note,
  });
}

export async function sendDriverRouteLink(input: {
  routeId: string;
  request: Request;
}): Promise<DriverRouteNotificationResult> {
  const token = await ensureDriverRouteAccessToken(input.routeId);
  const route = await prisma.route.findUnique({
    where: {
      id: input.routeId,
    },
    include: {
      driver: true,
      stops: true,
    },
  });

  if (!route) {
    throw new Error("Route not found.");
  }

  if (!route.driver) {
    throw new Error("Assign a driver before sending the driver route link.");
  }

  const routeUrl = buildDriverRouteUrl(input.request, token);
  const plannedStart = route.stops
    .map((stop) => stop.estimatedArrival)
    .filter(Boolean)
    .sort((a, b) => new Date(a!).getTime() - new Date(b!).getTime())[0];
  const date = formatDate(route.date);
  const startTime = formatTime(plannedStart || route.date);
  const smsBody = `New route assigned\n\nDriver: ${route.driver.name}\nRoute: ${route.name}\nDate: ${date}\nPlanned start: ${startTime}\n\nOpen route: ${routeUrl}`;
  const emailBody = `Hi ${route.driver.name},\n\nA new delivery route has been assigned to you.\n\nRoute: ${route.name}\nDate: ${date}\nPlanned start: ${startTime}\nStops: ${route.stops.length}\n\nOpen your route here:\n${routeUrl}\n\nBathroom Panels Direct`;
  const errors: string[] = [];
  let smsSent = false;
  let emailSent = false;

  if (route.driver.phoneNumber && isTwilioEnabled()) {
    try {
      await sendSmsWithTwilio({
        to: route.driver.phoneNumber,
        message: {
          body: smsBody,
        },
      });
      smsSent = true;
    } catch (error) {
      errors.push(`SMS failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  if (route.driver.email && isResendEnabled()) {
    try {
      await sendEmailWithResend({
        to: route.driver.email,
        message: {
          subject: `New route assigned, ${route.name}`,
          body: emailBody,
        },
      });
      emailSent = true;
    } catch (error) {
      errors.push(`Email failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  await prisma.route.update({
    where: {
      id: route.id,
    },
    data: {
      driverRouteLinkSentAt: new Date(),
      history: {
        create: {
          action: "Driver route link sent",
          details: `Driver route link sent to ${route.driver.name}. SMS: ${smsSent ? "sent" : "not sent"}. Email: ${emailSent ? "sent" : "not sent"}.${errors.length ? ` Errors: ${errors.join(" | ")}` : ""}`,
        },
      },
    },
  });

  return {
    smsSent,
    emailSent,
    errors,
  };
}
