import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { findAddressesByPostcode } from "../lib/getAddress.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const postcode = String(url.searchParams.get("postcode") || "").trim();

  if (!postcode) {
    return json({ ok: true, addresses: [] });
  }

  try {
    const addresses = await findAddressesByPostcode(postcode);

    return json({ ok: true, addresses });
  } catch (error) {
    return json({
      ok: false,
      addresses: [],
      error: error instanceof Error ? error.message : "Address lookup failed.",
    }, { status: 400 });
  }
};
