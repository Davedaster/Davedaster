import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import prisma from "../db.server";
import { getCustomerTrackingByCode } from "../lib/customerTracking.server";
import { getCustomerTrackingSettings } from "../lib/customerTrackingSettings.server";

function cleanInstruction(value: FormDataEntryValue | null) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function returnSafePlaceLabel(value: string) {
  const label = value.trim();
  const withoutLeave = label.replace(/^leave\s+/i, "").trim();

  if (!withoutLeave) return label;

  return withoutLeave.charAt(0).toUpperCase() + withoutLeave.slice(1);
}

async function buildSafePlaceNote(formData: FormData, isCollection: boolean) {
  const settings = await getCustomerTrackingSettings();
  const optionId = cleanInstruction(formData.get("safePlaceOption"));
  const details = cleanInstruction(formData.get("safePlaceDetails"));
  const option = settings.safePlaceOptions.find((safePlaceOption) => safePlaceOption.id === optionId) || settings.safePlaceOptions[0];

  if (!option) {
    return "";
  }

  if (option.requiresDetails && !details) {
    return "";
  }

  const optionLabel = isCollection ? returnSafePlaceLabel(option.label) : option.label;

  return [optionLabel, details].filter(Boolean).join(". ");
}

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const trackingCode = params.trackingCode || "";

  if (!trackingCode) {
    throw new Response("Tracking details not found", { status: 404 });
  }

  const tracking = await getCustomerTrackingByCode(trackingCode);
  const stop = tracking?.deliveryGroup?.stops?.[0];

  if (!tracking?.deliveryGroup || !stop) {
    throw new Response("Tracking details not found", { status: 404 });
  }

  if (stop.status === "DELIVERED" || stop.status === "FAILED") {
    return redirect(`/t/${encodeURIComponent(trackingCode)}?instructions=closed`);
  }

  const formData = await request.formData();
  const safePlaceNote = await buildSafePlaceNote(formData, tracking.orderSource === "return");

  if (!safePlaceNote) {
    return redirect(`/t/${encodeURIComponent(trackingCode)}?instructions=missing`);
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
