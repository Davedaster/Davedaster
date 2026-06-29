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

type TomTomSearchResult = {
  address?: {
    freeformAddress?: string;
    postalCode?: string;
  };
  position?: {
    lat?: number;
    lon?: number;
  };
};

type TomTomSearchPayload = {
  results?: TomTomSearchResult[];
};

function normalisePostcode(postcode: string | null | undefined) {
  const compact = (postcode || "").replace(/\s+/g, "").trim().toUpperCase();

  if (compact.length > 3) {
    return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  }

  return compact;
}

function buildSearchQuery(postcode: string, searchText: string) {
  const cleanedSearchText = searchText.trim();

  if (cleanedSearchText) {
    return cleanedSearchText;
  }

  if (postcode) {
    return `${postcode}, United Kingdom`;
  }

  return "";
}

async function lookupTomTom(query: string, postcode: string, searchText: string): Promise<AddressLookupResult | null> {
  const tomTomKey = process.env.TOMTOM_API_KEY || "";

  if (!tomTomKey) {
    return null;
  }

  const params = new URLSearchParams({
    key: tomTomKey,
    countrySet: "GB",
    limit: "1",
    language: "en-GB",
  });
  const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("TomTom lookup failed", {
        query,
        status: response.status,
        statusText: response.statusText,
        body: body.slice(0, 500),
      });

      return null;
    }

    const payload = await response.json() as TomTomSearchPayload;
    const bestMatch = payload.results?.[0];

    if (!bestMatch) {
      console.warn("TomTom lookup returned no matches", {
        query,
        resultCount: payload.results?.length || 0,
      });

      return null;
    }

    const latitude = bestMatch.position?.lat;
    const longitude = bestMatch.position?.lon;

    if (typeof latitude !== "number" || typeof longitude !== "number") {
      console.warn("TomTom lookup returned no coordinates", {
        query,
        resultCount: payload.results?.length || 0,
      });

      return null;
    }

    return {
      formattedAddress: bestMatch.address?.freeformAddress || searchText || postcode,
      postcode: normalisePostcode(bestMatch.address?.postalCode || postcode),
      latitude,
      longitude,
      confidence: "HIGH",
      source: "getaddress",
    };
  } catch (error) {
    console.warn("TomTom lookup crashed", {
      query,
      message: error instanceof Error ? error.message : String(error),
    });

    return null;
  }
}

async function lookupOpenStreetMap(query: string, postcode: string, searchText: string): Promise<AddressLookupResult> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&countrycodes=gb`;

  console.warn("OPENSTREETMAP URL", url);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "BPD Route Planner/1.0 (bathroom-panels-direct.myshopify.com)",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("OpenStreetMap lookup failed", {
        postcode,
        status: response.status,
        statusText: response.statusText,
        body: body.slice(0, 500),
      });

      return {
        formattedAddress: searchText || postcode,
        postcode,
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
        postcode,
        resultCount: Array.isArray(payload) ? payload.length : 0,
      });

      return {
        formattedAddress: searchText || postcode,
        postcode,
        latitude: null,
        longitude: null,
        confidence: "LOW",
        source: "none",
      };
    }

    return {
      formattedAddress: bestMatch?.display_name || searchText || postcode,
      postcode,
      latitude,
      longitude,
      confidence: "HIGH",
      source: "getaddress",
    };
  } catch (error) {
    console.warn("OpenStreetMap lookup crashed", {
      postcode,
      message: error instanceof Error ? error.message : String(error),
    });

    return {
      formattedAddress: searchText || postcode,
      postcode,
      latitude: null,
      longitude: null,
      confidence: "LOW",
      source: "none",
    };
  }
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

  const tomTomResult = await lookupTomTom(query, cleanPostcode || postcode || "", searchText);

  if (tomTomResult) {
    return tomTomResult;
  }

  return lookupOpenStreetMap(query, cleanPostcode || postcode || "", searchText);
}
