import type { LoaderFunctionArgs } from "@remix-run/node";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const appUrl = (process.env.SHOPIFY_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  const authUrl = `${appUrl}/auth?shop=${encodeURIComponent(shop)}`;

  await prisma.session.deleteMany({
    where: { shop },
  });

  return new Response(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Reconnect Shopify permissions</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 32px; color: #323841; background: #f6f6f7; }
      .card { max-width: 560px; margin: 40px auto; background: white; border: 1px solid #d0d5dd; border-radius: 14px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
      a { display: inline-block; margin-top: 16px; background: #509AE6; color: white; font-weight: 700; text-decoration: none; padding: 11px 16px; border-radius: 8px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Reconnect Shopify permissions</h1>
      <p>The app needs to reopen Shopify authorisation outside this embedded frame.</p>
      <p>You should be redirected automatically. If nothing happens, click the button below.</p>
      <a href="${escapeHtml(authUrl)}" target="_top">Reconnect permissions</a>
    </div>
    <script>
      window.top.location.href = ${JSON.stringify(authUrl)};
    </script>
  </body>
</html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
};
