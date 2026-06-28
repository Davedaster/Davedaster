export type AddressLookupResult = {
  formattedAddress: string;
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  confidence: "HIGH" | "LOW";
  source: "getaddress" | "manual" | "none";
};

type ExpandedAddress = {
  formatted_address?: string[];
  line_1?: string;
  line_2?: string;
  line_3?: string;
  line_4?: string;
  locality?: string;
  town_or_city?: string;
  county?: string;
};

type GetAddressFindResponse = {
  postcode?: string;
  latitude?: number;
  longitude?: number;
  addresses?: Array<string | ExpandedAddress>;
};

function normalisePostcode(postcode: string | null | undefined) {
  const compact = (postcode || "").replace(/\s+/g, "").trim().toUpperCase();

  if (compact.length > 3) {
    return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  }

  return compact;
}

function normaliseText(value: string | null | undefined) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function formatExpandedAddress(address: ExpandedAddress) {
  if (Array.isArray(address.formatted_address)) {
    return address.formatted_address.filter(Boolean).join(", ");
  }

  return [
    address.line_1,
    address.line_2,
    address.line_3,
    address.line_4,
    address.locality,
    address.town_or_city,
    address.county,
  ]
    .filter(Boolean)
    .join(", ");
}

function formatGetAddressResult(address: string | ExpandedAddress) {
  if (typeof address === "string") {
    return address;
  }

  return formatExpandedAddress(address);
}

function scoreAddress(address: string, searchText: string) {
  const addressText = normaliseText(address);
  const terms = normaliseText(searchText).split(" ").filter((term) => term.length > 2);

  if (!terms.length) {
    return 0;
  }

  return terms.reduce((score, term) => addressText.includes(term) ? score + 1 : score, 0);
}

function pickBestAddress(addresses: Array<string | ExpandedAddress>, searchText: string) {
  if (!addresses.length) {
    return null;
  }

  return addresses
    .map((address) => {
      const formattedAddress = formatGetAddressResult(address);
      return {
        address: formattedAddress,
        score: scoreAddress(formattedAddress, searchText),
      };
    })
    .sort((a, b) => b.score - a.score)[0];
}

export async function lookupAddress(postcode: string | null, searchText: string): Promise<AddressLookupResult> {
  const apiKey = process.env.GETADDRESS_API_KEY;
  const cleanPostcode = normalisePostcode(postcode);
console.warn("POSTCODE DEBUG", {
  original: postcode,
  clean: cleanPostcode,
});
  if (!apiKey || !cleanPostcode) {
    console.warn("getAddress lookup skipped", {
      hasApiKey: Boolean(apiKey),
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

  const url = `https://api.getAddress.io/find/${encodeURIComponent(cleanPostcode)}?api-key=${encodeURIComponent(apiKey)}&expand=true`;
  const response = await fetch(url);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.warn("getAddress lookup failed", {
      postcode: cleanPostcode,
      status: response.status,
      statusText: response.statusText,
      body: body.slice(0, 500),
    });

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
console.log(
  "getAddress payload",
  JSON.stringify(payload).slice(0, 2000)
);
  const addresses = payload.addresses || [];
  const bestMatch = pickBestAddress(addresses, searchText);
  const firstAddress = addresses[0] ? formatGetAddressResult(addresses[0]) : null;

  if (typeof payload.latitude !== "number" || typeof payload.longitude !== "number") {
    console.warn("getAddress lookup returned no coordinates", {
      postcode: cleanPostcode,
      returnedPostcode: payload.postcode || "",
      addressCount: addresses.length,
    });
  }

  return {
    formattedAddress: bestMatch?.address || firstAddress || searchText || cleanPostcode,
    postcode: payload.postcode || postcode || "",
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    confidence: bestMatch && bestMatch.score > 0 ? "HIGH" : "LOW",
    source: "getaddress",
  };
}
