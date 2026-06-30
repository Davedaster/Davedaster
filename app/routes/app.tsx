import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu, TitleBar } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { appName } from "../lib/appName";
import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <TitleBar title={appName} />
      <NavMenu>
        <Link to="/app" rel="home">
          Orders Map
        </Link>
        <Link to="/app/routes">Routes</Link>
        <Link to="/app/driver-routes">Driver Routes</Link>
        <Link to="/app/drivers">Drivers</Link>
        <Link to="/app/address-checks">Address Checks</Link>
        <Link to="/app/proof-of-delivery">Proof of Delivery</Link>
        <Link to="/app/returns">Returns</Link>
        <Link to="/app/notifications">Notifications</Link>
        <Link to="/app/fulfilment-settings">Fulfilment Settings</Link>
        <Link to="/app/area-filters">Area Filters</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
