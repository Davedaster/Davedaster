import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { getAppCredentials } from "../lib/appCredentials.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const credentials = await getAppCredentials();

  return json({ apiKey: credentials.tomtomApiKey || "" });
};
