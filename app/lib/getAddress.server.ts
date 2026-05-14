export type AddressLookupResult = {
  formattedAddress: string;
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  confidence: "HIGH" | "LOW";
  source: "getaddress" | "manual" | "none";
};

type GetAddressFindResponse = {
  postcode?: string;
  latitude?: number;
  longitude?: number;
  addresses?: string[];
};

function normalisePostcode(postcode: string | null | undefined) {
  return (postcode || "").replace(/\s+/g, "").trim().toUpperCase();
}

function normaliseText(value: string | null | undefined) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreAddress(address: string, searchText: string) {
  const addressText = normaliseText(address);
  const terms = normaliseText(searchText).split(" ").filter((term) => term.length > 2);

  if (!terms.length) {
    return 0;
  }

  return terms.reduce((score, term) => addressText.includes(term) ? score + 1 : score, 0);
}

function pickBestAddress(addresses: string[], searchText: string) {
  if (!addresses.length) {
    return null;
  }

  return addresses
    .map((address) => ({ address, score: scoreAddress(address, searchText) }))
    .sort((a, b) => b.score - a.score)[0];
}

export async function lookupAddress(postcode: string | null, searchText: string): Promise<AddressLookupResult> {
  const apiKey = process.env.GETADDRESS_API_KEY;
  const cleanPostcode = normalisePostcode(postcode);

  if (!apiKey || !cleanPostcode) {
    return {
      formattedAddress: searchText || "No address found",
      postcode: postcode || "",
      latitude: null,
      longitude: null,
      confidence: "LOW",
      source: "none",
    };
  }

  const response = await fetch(
    `https://api.getAddress.io/find/${encodeURIComponent(cleanPostcode)}?api-key=${encodeURIComponent(apiKey)}&expand=true`,
  );

  if (!response.ok) {
    return {
      formattedAddress: searchText || cleanPostcode,
      postcode: postcode || "",
      latitude: null,
      longitude: null,
      confidence: "LOW",
      source: "none",
    };
  }

  const payload = await response.json() as GetAddressFindResponse;
  const addresses = payload.addresses || [];
  const bestMatch = pickBestAddress(addresses, searchText);

  return {
    formattedAddress: bestMatch?.address || addresses[0] || searchText || cleanPostcode,
    postcode: payload.postcode || postcode || "",
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    confidence: bestMatch && bestMatch.score > 0 ? "HIGH" : "LOW",
    source: "getaddress",
  };
}
