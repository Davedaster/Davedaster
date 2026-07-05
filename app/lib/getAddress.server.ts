import { createHash } from "node:crypto";

import prisma from "../db.server";
import { getAppCredentials } from "./appCredentials.server";

export type AddressLookupResult = {
  formattedAddress: string;
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  confidence: "HIGH" | "LOW";
  source: "getaddress" | "manual" | "none";
};

export type PostcodeAddressOption = {
  id: string;
  address: string;
  postcode: string;
  latitude: number | null;
  longitude: number | null;
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

type GetAddressExpandedAddress = {
  formatted_address?: string[];
  line_1?: string;
  line_2?: string;
  line_3?: string;
  line_4?: string;
  locality?: string;
  town_or_city?: string;
  county?: string;
  country?: string;
  postcode?: string;
  latitude?: number;
  longitude?: number;
};

type GetAddressFindPayload = {
  postcode?: string;
  latitude?: number;
  longitude?: number;
  addresses?: Array<string | GetAddressExpandedAddress>;
};

const TOMTOM_RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
const ADDRESS_LOOKUP_CACHE_PREFIX = "address-lookup-cache:";
let tomTomPausedUntil = 0;
let tomTomQueue: Promise<void> = Promise.resolve();

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

function hasUnitedKingdomSuffix(value: string) {
  return /\b(united kingdom|great britain|uk)\b/i.test(value);
}

function buildSearchQueries(postcode: string, searchText: string) {
  const queries: string[] = [];
  const cleanedSearchText = searchText.trim();

  if (cleanedSearchText) {
    addUniqueQuery(queries, cleanedSearchText);

    if (!hasUnitedKingdomSuffix(cleanedSearchText)) {
      addUniqueQuery(queries, `${cleanedSearchText}, United Kingdom`);
    }
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

function addressLookupCacheKey(postcode: string, searchText: string) {
  const fingerprint = createHash("sha256")
    .update(`${postcode.trim().toUpperCase()}|${searchText.replace(/\s+/g, " ").trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 48);

  return `${ADDRESS_LOOKUP_CACHE_PREFIX}${fingerprint}`;
}

function isAddressLookupResult(value: unknown): value is AddressLookupResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Partial<AddressLookupResult>;

  return (
    typeof result.formattedAddress === "string" &&
    typeof result.postcode === "string" &&
    typeof result.latitude === "number" &&
    typeof result.longitude === "number" &&
    (result.confidence === "HIGH" || result.confidence === "LOW") &&
    (result.source === "getaddress" || result.source === "manual" || result.source === "none")
  );
}

async function getCachedAddressLookup(cacheKey: string): Promise<AddressLookupResult | null> {
  try {
    const setting = await prisma.setting.findUnique({
      where: {
        key: cacheKey,
      },
    });

    if (!setting?.value) {
      return null;
    }

    const parsed = JSON.parse(setting.value) as unknown;

    return isAddressLookupResult(parsed) ? parsed : null;
  } catch (error) {
    console.warn("Address lookup cache read failed", {
      message: error instanceof Error ? error.message : String(error),
    });

    return null;
  }
}

async function saveCachedAddressLookup(cacheKey: string, result: AddressLookupResult) {
  if (typeof result.latitude !== "number" || typeof result.longitude !== "number") {
    return;
  }

  try {
    await prisma.setting.upsert({
      where: {
        key: cacheKey,
      },
      create: {
        key: cacheKey,
        value: JSON.stringify(result),
      },
      update: {
        value: JSON.stringify(result),
      },
    });
  } catch (error) {
    console.warn("Address lookup cache write failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function cleanAddressPart(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function formatGetAddressAddress(address: string | GetAddressExpandedAddress, postcode: string) {
  if (typeof address === "string") {
    return address
      .split(",")
      .map(cleanAddressPart)
      .filter(Boolean)
      .join(", ");
  }

  const formattedLines = address.formatted_address
    ?.map(cleanAddressPart)
    .filter(Boolean) || [];

  const addressParts = formattedLines.length ? formattedLines : [
    address.line_1,
    address.line_2,
    address.line_3,
    address.line_4,
    address.locality,
    address.town_or_city,
    address.county,
    address.country,
  ]
    .map(cleanAddressPart)
    .filter(Boolean);

  const finalPostcode = cleanAddressPart(address.postcode || postcode);

  return [...addressParts, finalPostcode].filter(Boolean).join(", ");
}

function coordinate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function runQueuedTomTomLookup<T>(callback: () => Promise<T>): Promise<T> {
  const previousQueue = tomTomQueue;
  let releaseQueue: () => void = () => {};

  tomTomQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previousQueue.catch(() => undefined);

  try {
    return await callback();
  } finally {
    releaseQueue();
  }
}

async function lookupTomTom(query: string, postcode: string, searchText: string): Promise<AddressLookupResult | null> {
  return runQueuedTomTomLookup(async () => {
    const credentials = await getAppCredentials();
    const tomTomKey = credentials.tomtomApiKey;

    if (!tomTomKey) {
      return null;
    }

    if (Date.now() < tomTomPausedUntil) {
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

        if (response.status === 429) {
          tomTomPausedUntil = Math.max(tomTomPausedUntil, Date.now() + TOMTOM_RATE_LIMIT_COOLDOWN_MS);
          console.warn("TomTom rate limit reached. Pausing TomTom lookups temporarily.", {
            query,
            status: response.status,
            statusText: response.statusText,
            pausedUntil: new Date(tomTomPausedUntil).toISOString(),
          });

          return null;
        }

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
  });
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

export async function findAddressesByPostcode(postcode: string): Promise<PostcodeAddressOption[]> {
  const credentials = await getAppCredentials();
  const apiKey = credentials.getAddressApiKey;
  const cleanPostcode = normalisePostcode(postcode);

  if (!apiKey || !cleanPostcode) {
    return [];
  }

  const params = new URLSearchParams({
    "api-key": apiKey,
    expand: "true",
    sort: "true",
  });
  const url = `https://api.getAddress.io/find/${encodeURIComponent(cleanPostcode)}?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Address lookup failed. Check the postcode and try again.");
  }

  const payload = await response.json() as GetAddressFindPayload;
  const payloadPostcode = normalisePostcode(payload.postcode || cleanPostcode);
  const postcodeLatitude = coordinate(payload.latitude);
  const postcodeLongitude = coordinate(payload.longitude);

  return (payload.addresses || [])
    .map((address, index) => {
      const formattedAddress = formatGetAddressAddress(address, payloadPostcode);

      if (!formattedAddress) {
        return null;
      }

      const expandedAddress = typeof address === "string" ? null : address;

      return {
        id: `${payloadPostcode}-${index}`,
        address: formattedAddress,
        postcode: payloadPostcode,
        latitude: coordinate(expandedAddress?.latitude) ?? postcodeLatitude,
        longitude: coordinate(expandedAddress?.longitude) ?? postcodeLongitude,
      };
    })
    .filter((address): address is PostcodeAddressOption => Boolean(address));
}

export async function lookupAddress(postcode: string | null, searchText: string): Promise<AddressLookupResult> {
  const cleanPostcode = normalisePostcode(postcode);
  const cacheKey = addressLookupCacheKey(cleanPostcode, searchText);
  const cachedResult = await getCachedAddressLookup(cacheKey);

  if (cachedResult) {
    return cachedResult;
  }

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
      await saveCachedAddressLookup(cacheKey, tomTomResult);
      return tomTomResult;
    }
  }

  for (const query of queries) {
    const openStreetMapResult = await lookupOpenStreetMap(query, cleanPostcode || postcode || "", searchText);

    if (openStreetMapResult) {
      await saveCachedAddressLookup(cacheKey, openStreetMapResult);
      return openStreetMapResult;
    }
  }

  return fallbackAddress(cleanPostcode || postcode || "", searchText);
}
