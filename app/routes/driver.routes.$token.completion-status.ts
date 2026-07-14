import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import prisma from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const token = params.token;
  const url = new URL(request.url);
  const stopId = url.searchParams.get("stopId")?.trim() || "";
  const intent = url.searchParams.get("intent")?.trim() || "";

  if (!token || !stopId || (intent !== "completeStop" && intent !== "completeCollectionStop")) {
    return json({ completed: false, error: "Completion status request is incomplete." }, { status: 400 });
  }

  const stop = await prisma.stop.findFirst({
    where: {
      id: stopId,
      route: { driverAccessToken: token },
    },
    select: {
      status: true,
      returnTickets: { select: { id: true }, take: 1 },
    },
  });

  if (!stop) {
    return json({ completed: false, error: "Stop not found for this driver route." }, { status: 404 });
  }

  const isCollection = stop.returnTickets.length > 0;
  if ((intent === "completeCollectionStop") !== isCollection) {
    return json({ completed: false, error: "Stop type does not match this completion request." }, { status: 400 });
  }

  return json({
    completed: stop.status === "DELIVERED",
    resolved: stop.status === "DELIVERED" || stop.status === "FAILED",
    status: stop.status,
  });
};
