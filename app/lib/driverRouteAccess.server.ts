import crypto from "node:crypto";

import prisma from "../db.server";
import { markStopFailedDelivery } from "./failedDelivery.server";
import { isResendEnabled, isTwilioEnabled, sendEmailWithResend, sendSmsWithTwilio } from "./notificationSenders.server";
import { saveProofOfDelivery } from "./proofOfDelivery.server";
import { sendNextPendingStopNotification } from "./routeNotifications.server";

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

const DEFAULT_APP_BASE_URL = "https://davedaster-production.up.railway.app";

function getBaseUrl(_request: Request) {
  return DEFAULT_APP_BASE_URL;
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

  if (typeof value === "string" && /^\d{2}:\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(date);
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
  return crypto.randomBytes(12).toString("hex");
}

export function buildDriverRouteUrl(request: Request, token: string) {
  return `${getBaseUrl(request)}/driver/routes/${encodeURIComponent(token)}`;
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
  admin?: ShopifyAdmin | null;
  proofPhotoUrls: string[];
  deliveryNote?: string | null;
  safePlaceNote?: string | null;
  leftInSafePlace?: boolean;
  podImage?: string | null;
  podName?: string | null;
  podTicked?: boolean;
  podLat?: number | null;
  podLng?: number | null;
}) {
  await getStopForDriverToken(input.token, input.stopId);

  await saveProofOfDelivery({
    admin: input.admin,
    stopId: input.stopId,
    proofPhotoUrl: input.proofPhotoUrls,
    deliveryNote: input.deliveryNote,
    safePlaceNote: input.safePlaceNote,
    leftInSafePlace: input.leftInSafePlace,
    podImage: input.podImage,
    podName: input.podName,
    podTicked: input.podTicked,
    podLat: input.podLat,
    podLng: input.podLng,
  });
}

export async function markDriverStopMissedFromToken(input: {
  token: string;
  stopId: string;
  admin: ShopifyAdmin;
  reason: string;
  note?: string | null;
}) {
  const stop = await getStopForDriverToken(input.token, input.stopId);

  await markStopFailedDelivery({
    admin: input.admin,
    stopId: input.stopId,
    reason: input.reason,
    note: input.note,
  });

  await sendNextPendingStopNotification(stop.routeId, input.stopId);
}

export async function sendDriverRouteLink(input: {
  routeId: string;
  request: Request;
}): Promise<DriverRouteNotificationResult> {
  const token = await ensureDriverRouteAccessToken(input.routeId);
  const [route, canSendSms, canSendEmail] = await Promise.all([
    prisma.route.findUnique({
      where: {
        id: input.routeId,
      },
      include: {
        driver: true,
      },
    }),
    isTwilioEnabled(),
    isResendEnabled(),
  ]);
  const errors: string[] = [];

  if (!route) {
    throw new Error("Route not found.");
  }

  const driver = route.driver;

  if (!driver) {
    throw new Error("Assign a driver before sending the route link.");
  }

  const routeUrl = buildDriverRouteUrl(input.request, token);
  const smsBody = `Bathroom Panels Direct route ${route.name} for ${formatDate(route.date)}. Start ${formatTime(route.plannedStartTime)}. Open: ${routeUrl}`;
  const emailSubject = `Bathroom Panels Direct route ${route.name}`;
  const emailBody = [
    `Hi ${driver.name},`,
    "",
    `Your route ${route.name} is ready for ${formatDate(route.date)}.`,
    `Planned start: ${formatTime(route.plannedStartTime)}.`,
    "",
    `Open your secure driver route here: ${routeUrl}`,
    "",
    "Bathroom Panels Direct",
  ].join("\n");
  let smsSent = false;
  let emailSent = false;

  if (driver.phoneNumber && canSendSms) {
    try {
      await sendSmsWithTwilio({
        to: driver.phoneNumber,
        message: {
          body: smsBody,
        },
      });
      smsSent = true;
    } catch (error) {
      errors.push(`Driver SMS failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  if (driver.email && canSendEmail) {
    try {
      await sendEmailWithResend({
        to: driver.email,
        message: {
          subject: emailSubject,
          body: emailBody,
        },
      });
      emailSent = true;
    } catch (error) {
      errors.push(`Driver email failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  await prisma.routeHistory.create({
    data: {
      routeId: route.id,
      action: "Driver route link sent",
      details: `Secure driver route link sent. SMS: ${smsSent ? "sent" : "not sent"}. Email: ${emailSent ? "sent" : "not sent"}.${errors.length ? ` Errors: ${errors.join(" | ")}` : ""}`,
    },
  });

  return {
    smsSent,
    emailSent,
    errors,
  };
}
