import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { getAppCredentials } from "../lib/appCredentials.server";

export const loader = async (_args: LoaderFunctionArgs) => {
  const credentials = await getAppCredentials();

  return json({ apiKey: credentials.tomtomApiKey || "" });
};
