import prisma from "../db.server";
import { lookupAddress } from "./getAddress.server";

export type AddressOverrideInput = {
  shopifyOrderId: string;
  shopifyOrderName?: string | null;
  manualAddress: string;
  postcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  notes?: string | null;
};

export async function getAddressOverrides() {
  return prisma.addressOverride.findMany();
}

export async function getAddressOverridesByOrderId() {
  const overrides = await getAddressOverrides();
  return new Map(overrides.map((override) => [override.shopifyOrderId, override]));
}

export async function upsertAddressOverride(input: AddressOverrideInput) {
  const lookup = input.latitude && input.longitude
    ? null
    : await lookupAddress(input.postcode || null, input.manualAddress);

  const latitude = input.latitude ?? lookup?.latitude ?? null;
  const longitude = input.longitude ?? lookup?.longitude ?? null;
  const addressStatus = latitude && longitude ? "READY" : "NEEDS_LOCATION_CHECK";

  return prisma.addressOverride.upsert({
    where: {
      shopifyOrderId: input.shopifyOrderId,
    },
    create: {
      shopifyOrderId: input.shopifyOrderId,
      shopifyOrderName: input.shopifyOrderName || null,
      manualAddress: input.manualAddress,
      postcode: input.postcode || null,
      latitude,
      longitude,
      notes: input.notes || null,
      addressStatus,
    },
    update: {
      shopifyOrderName: input.shopifyOrderName || null,
      manualAddress: input.manualAddress,
      postcode: input.postcode || null,
      latitude,
      longitude,
      notes: input.notes || null,
      addressStatus,
    },
  });
}

export async function deleteAddressOverride(shopifyOrderId: string) {
  return prisma.addressOverride.delete({
    where: {
      shopifyOrderId,
    },
  });
}
