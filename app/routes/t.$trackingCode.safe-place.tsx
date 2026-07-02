import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import prisma from "../db.server";
import { getCustomerTrackingByCode } from "../lib/customerTracking.server";

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
  const trackingCode = params.trackingCode || "";

  if (!trackingCode) {
    throw new Response("Tracking details not found", { status: 404 });
  }

  const formData = await request.formData();
  const safePlaceNote = buildSafePlaceNote(formData);

  if (!safePlaceNote) {
    return redirect(`/t/${encodeURIComponent(trackingCode)}?instructions=missing`);
  }

  const tracking = await getCustomerTrackingByCode(trackingCode);
  const stop = tracking?.deliveryGroup?.stops?.[0];

  if (!tracking?.deliveryGroup || !stop) {
    throw new Response("Tracking details not found", { status: 404 });
  }

  if (stop.status === "DELIVERED" || stop.status === "FAILED") {
    return redirect(`/t/${encodeURIComponent(trackingCode)}?instructions=closed`);
  }

  await prisma.deliveryGroup.update({
    where: {
      id: tracking.deliveryGroup.id,
    },
    data: {
      safePlaceNote,
    },
  });

  return redirect(`/t/${encodeURIComponent(trackingCode)}?instructions=saved`);
};
