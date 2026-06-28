export type AddressLookupResult = {
  formattedAddress: string;
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  confidence: "HIGH" | "LOW";
  source: "getaddress" | "manual" | "none";
};

type NominatimSearchResult = {
  lat?: string;
  lon?: string;
  display_name?: string;
};

function normalisePostcode(postcode: string | null | undefined) {
  const compact = (postcode || "").replace(/\s+/g, "").trim().toUpperCase();

  if (compact.length > 3) {
    return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  }

  return compact;
}

function buildSearchQuery(postcode: string, searchText: string) {
  if (postcode) {
    return `${postcode}, United Kingdom`;
  }

  return searchText;
}

export async function lookupAddress(postcode: string | null, searchText: string): Promise<AddressLookupResult> {
  const cleanPostcode = normalisePostcode(postcode);
  const query = buildSearchQuery(cleanPostcode, searchText);

  if (!query) {
    console.warn("address lookup skipped", {
      postcode: postcode || "",
      cleanPostcode,
    });

    return {
      formattedAddress: searchText || "No address found",
      postcode: postcode || "",
      latitude: null,
      longitude: null,
      confidence: "LOW",
      source: "none",
    };
  }

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&countrycodes=gb`;

  console.warn("OPENSTREETMAP URL", url);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "BPD Route Planner/1.0 (bathroom-panels-direct.myshopify.com)",
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.warn("OpenStreetMap lookup failed", {
      postcode: cleanPostcode,
      status: response.status,
      statusText: response.statusText,
      body: body.slice(0, 500),
    });

    return {
      formattedAddress: searchText || cleanPostcode,
      postcode: cleanPostcode || postcode || "",
      latitude: null,
      longitude: null,
      confidence: "LOW",
      source: "none",
    };
  }

  const payload = await response.json() as NominatimSearchResult[];
  const bestMatch = Array.isArray(payload) ? payload[0] : null;
  const latitude = bestMatch?.lat ? Number(bestMatch.lat) : null;
  const longitude = bestMatch?.lon ? Number(bestMatch.lon) : null;

  if (typeof latitude !== "number" || Number.isNaN(latitude) || typeof longitude !== "number" || Number.isNaN(longitude)) {
    console.warn("OpenStreetMap lookup returned no coordinates", {
      postcode: cleanPostcode,
      resultCount: Array.isArray(payload) ? payload.length : 0,
    });

    return {
      formattedAddress: searchText || cleanPostcode,
      postcode: cleanPostcode || postcode || "",
      latitude: null,
      longitude: null,
      confidence: "LOW",
      source: "none",
    };
  }

  return {
    formattedAddress: bestMatch?.display_name || searchText || cleanPostcode,
    postcode: cleanPostcode || postcode || "",
    latitude,
    longitude,
    confidence: "HIGH",
    source: "getaddress",
  };
}
