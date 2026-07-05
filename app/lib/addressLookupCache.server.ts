import prisma from "../db.server";
import type { AddressLookupResult } from "./getAddress.server";

export const AUTOMATIC_ADDRESS_LOOKUP_NOTE = "Automatic map location lookup";

export function isAutomaticAddressLookupNote(value?: string | null) {
  return value === AUTOMATIC_ADDRESS_LOOKUP_NOTE;
}

export async function cacheAutomaticOrderCoordinates(input: {
  shopifyOrderId: string;
  shopifyOrderName?: string | null;
  address: string;
  postcode?: string | null;
  lookup: AddressLookupResult | null;
}) {
  const latitude = input.lookup?.latitude;
  const longitude = input.lookup?.longitude;

  if (!latitude || !longitude) {
    return;
  }

  try {
    await prisma.addressOverride.create({
      data: {
        shopifyOrderId: input.shopifyOrderId,
        shopifyOrderName: input.shopifyOrderName || null,
        manualAddress: input.lookup?.formattedAddress || input.address,
        postcode: input.lookup?.postcode || input.postcode || null,
        latitude,
        longitude,
        notes: AUTOMATIC_ADDRESS_LOOKUP_NOTE,
        addressStatus: "READY",
      },
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";

    if (code !== "P2002") {
      console.warn("Automatic address lookup could not be cached", {
        shopifyOrderId: input.shopifyOrderId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
