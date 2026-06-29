import { getAppCredentials } from "./appCredentials.server";

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

function addUniqueQuery(queries: string[], query: string) {
  const cleaned = query.replace(/\s+/g, " ").trim();

  if (cleaned && !queries.some((existingQuery) => existingQuery.toLowerCase() === cleaned.toLowerCase())) {
    queries.push(cleaned);
  }
}

function buildSearchQueries(postcode: string, searchText: string) {
  const queries: string[] = [];
  const cleanedSearchText = searchText.trim();

  if (cleanedSearchText) {
    addUniqueQuery(queries, cleanedSearchText);
    addUniqueQuery(queries, `${cleanedSearchText}, United Kingdom`);
  }

  if (postcode) {
    addUniqueQuery(queries, `${postcode}, United Kingdom`);
    addUniqueQuery(queries, postcode);
  }

  return queries;
}

function fallbackAddress(postcode: string, searchText: string): AddressLookupResult {
  return {
    formattedAddress: searchText || postcode || "No address found",
    postcode,
    latitude: null,
    longitude: null,
    confidence: "LOW",
    source: "none",
  };
}

async function lookupTomTom(query: string, postcode: string, searchText: string): Promise<AddressLookupResult | null> {
  const credentials = await getAppCredentials();
  const tomTomKey = credentials.tomtomApiKey;

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

async function lookupOpenStreetMap(query: string, postcode: string, searchText: string): Promise<AddressLookupResult | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=1&countrycodes=gb`;

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
        query,
        postcode,
        status: response.status,
        statusText: response.statusText,
        body: body.slice(0, 500),
      });

      return null;
    }

    const payload = await response.json() as NominatimSearchResult[];
    const bestMatch = Array.isArray(payload) ? payload[0] : null;
    const latitude = bestMatch?.lat ? Number(bestMatch.lat) : null;
    const longitude = bestMatch?.lon ? Number(bestMatch.lon) : null;

    if (typeof latitude !== "number" || Number.isNaN(latitude) || typeof longitude !== "number" || Number.isNaN(longitude)) {
      console.warn("OpenStreetMap lookup returned no coordinates", {
        query,
        postcode,
        resultCount: Array.isArray(payload) ? payload.length : 0,
      });

      return null;
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
      query,
      postcode,
      message: error instanceof Error ? error.message : String(error),
    });

    return null;
  }
}

export async function lookupAddress(postcode: string | null, searchText: string): Promise<AddressLookupResult> {
  const cleanPostcode = normalisePostcode(postcode);
  const queries = buildSearchQueries(cleanPostcode, searchText);

  if (!queries.length) {
    console.warn("address lookup skipped", {
      postcode: postcode || "",
      cleanPostcode,
    });

    return fallbackAddress(postcode || "", searchText);
  }

  for (const query of queries) {
    const tomTomResult = await lookupTomTom(query, cleanPostcode || postcode || "", searchText);

    if (tomTomResult) {
      return tomTomResult;
    }
  }

  for (const query of queries) {
    const openStreetMapResult = await lookupOpenStreetMap(query, cleanPostcode || postcode || "", searchText);

    if (openStreetMapResult) {
      return openStreetMapResult;
    }
  }

  return fallbackAddress(cleanPostcode || postcode || "", searchText);
}
