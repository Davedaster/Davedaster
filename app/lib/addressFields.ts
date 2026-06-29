export type StructuredAddress = {
  building: string;
  addressLine1: string;
  addressLine2: string;
  town: string;
  county: string;
  postcode: string;
  country: string;
};

export type ResolvedStructuredAddress = StructuredAddress & {
  formattedAddress: string;
  latitude: number | null;
  longitude: number | null;
};

export const defaultCountry = "United Kingdom";

export const emptyStructuredAddress: StructuredAddress = {
  building: "",
  addressLine1: "",
  addressLine2: "",
  town: "",
  county: "",
  postcode: "",
  country: defaultCountry,
};

export const defaultDepotAddress: ResolvedStructuredAddress = {
  building: "Unit 1 Olympus Business Park",
  addressLine1: "Kingsteignton Road",
  addressLine2: "",
  town: "Newton Abbot",
  county: "Devon",
  postcode: "TQ12 2SN",
  country: defaultCountry,
  formattedAddress: "Unit 1 Olympus Business Park, Kingsteignton Road, Newton Abbot, Devon, TQ12 2SN, United Kingdom",
  latitude: 50.5293,
  longitude: -3.6119,
};

export function cleanAddressValue(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function normalisePostcode(postcode: string | null | undefined) {
  const compact = (postcode || "").replace(/\s+/g, "").trim().toUpperCase();

  if (compact.length > 3) {
    return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  }

  return compact;
}

export function normaliseStructuredAddress(value: Partial<StructuredAddress> | null | undefined, fallback: StructuredAddress = emptyStructuredAddress): StructuredAddress {
  return {
    building: cleanAddressValue(value?.building) || cleanAddressValue(fallback.building),
    addressLine1: cleanAddressValue(value?.addressLine1) || cleanAddressValue(fallback.addressLine1),
    addressLine2: cleanAddressValue(value?.addressLine2) || cleanAddressValue(fallback.addressLine2),
    town: cleanAddressValue(value?.town) || cleanAddressValue(fallback.town),
    county: cleanAddressValue(value?.county) || cleanAddressValue(fallback.county),
    postcode: normalisePostcode(cleanAddressValue(value?.postcode) || cleanAddressValue(fallback.postcode)),
    country: cleanAddressValue(value?.country) || cleanAddressValue(fallback.country) || defaultCountry,
  };
}

export function formatStructuredAddress(address: Partial<StructuredAddress> | null | undefined) {
  const normalised = normaliseStructuredAddress(address);

  return [
    normalised.building,
    normalised.addressLine1,
    normalised.addressLine2,
    normalised.town,
    normalised.county,
    normalised.postcode,
    normalised.country,
  ]
    .map(cleanAddressValue)
    .filter(Boolean)
    .join(", ");
}

export function isStructuredAddressReady(address: Partial<StructuredAddress> | null | undefined) {
  const normalised = normaliseStructuredAddress(address);

  return Boolean((normalised.building || normalised.addressLine1) && normalised.town && normalised.postcode);
}
