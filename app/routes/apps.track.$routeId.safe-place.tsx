import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import prisma from "../db.server";

const SAFE_PLACE_LABELS: Record<string, string> = {
  porch: "Leave in porch",
  side_gate: "Leave behind side gate",
  shed: "Leave in shed or outbuilding",
  neighbour: "Leave with neighbour",
  other: "Other safe place",
};

function cleanInstruction(value: FormDataEntryValue | null) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function buildSafePlaceNote(formData: FormData) {
  const option = cleanInstruction(formData.get("safePlaceOption"));
  const details = cleanInstruction(formData.get("safePlaceDetails"));
  const optionLabel = SAFE_PLACE_LABELS[option] || SAFE_PLACE_LABELS.other;

  return [optionLabel, details].filter(Boolean).join(". ");
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const routeId = params.routeId;
  const url = new URL(request.url);
  const shopifyOrderId = url.searchParams.get("order");

  if (!routeId || !shopifyOrderId) {
    throw new Response("Tracking link is missing details", { status: 404 });
  }

  const formData = await request.formData();
  const safePlaceNote = buildSafePlaceNote(formData);

  if (!safePlaceNote) {
    return redirect(`/apps/track/${routeId}?order=${encodeURIComponent(shopifyOrderId)}&instructions=missing`);
  }

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
      deliveryGroup: true,
    },
  });

  if (!stop?.deliveryGroup) {
    throw new Response("Tracking details not found", { status: 404 });
  }

  if (stop.status === "DELIVERED" || stop.status === "FAILED") {
    return redirect(`/apps/track/${routeId}?order=${encodeURIComponent(shopifyOrderId)}&instructions=closed`);
  }

  await prisma.deliveryGroup.update({
    where: {
      id: stop.deliveryGroup.id,
    },
    data: {
      safePlaceNote,
    },
  });

  return redirect(`/apps/track/${routeId}?order=${encodeURIComponent(shopifyOrderId)}&instructions=saved`);
};
