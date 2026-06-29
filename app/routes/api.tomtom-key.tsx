import { json } from "@remix-run/node";

import { getAppCredentials } from "../lib/appCredentials.server";

export const loader = async () => {
  const credentials = await getAppCredentials();

  return json({ apiKey: credentials.tomtomApiKey || "" });
};
