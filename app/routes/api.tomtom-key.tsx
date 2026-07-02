import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import { getAppCredentials } from "../lib/appCredentials.server";
import { getDriverCompletionMessageTemplate } from "../lib/driverCompletionSettings.server";

export const loader = async (_args: LoaderFunctionArgs) => {
  const [credentials, driverCompletionMessageTemplate] = await Promise.all([
    getAppCredentials(),
    getDriverCompletionMessageTemplate(),
  ]);

  return json({
    apiKey: credentials.tomtomApiKey || "",
    driverCompletionMessageTemplate,
  });
};
