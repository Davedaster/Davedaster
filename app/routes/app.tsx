import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useLocation, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu, TitleBar } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { useEffect } from "react";

import { appName } from "../lib/appName";
import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

function isPackingListPath(pathname: string) {
  return pathname.includes("/packing-list");
}

function standalonePackingListPath(pathname: string) {
  const match = pathname.match(/^\/app\/routes\/([^/]+)\/packing-list\/?$/);
  return match ? `/packing-list/${match[1]}` : null;
}

function rewritePackingListLinks() {
  document.querySelectorAll('a[href*="/app/routes/"][href$="/packing-list"]').forEach((element) => {
    const link = element as HTMLAnchorElement;
    try {
      const url = new URL(link.href);
      const standalonePath = standalonePackingListPath(url.pathname);
      if (standalonePath) {
        link.href = `${url.origin}${standalonePath}${url.search}`;
      }
    } catch {
      // Ignore malformed browser hrefs.
    }
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (!isPackingListPath(url.pathname)) {
    await authenticate.admin(request);
  }

  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const location = useLocation();

  useEffect(() => {
    rewritePackingListLinks();
  }, [location.pathname]);

  if (isPackingListPath(location.pathname)) {
    return <Outlet />;
  }

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <TitleBar title={appName} />
      <NavMenu>
        <Link to="/app" rel="home">
          Orders Map
        </Link>
        <Link to="/app/routes">Routes</Link>
        <Link to="/app/drivers">Drivers</Link>
        <Link to="/app/address-checks">Address Checks</Link>
        <Link to="/app/pod-search">Proof of Delivery</Link>
        <Link to="/app/returns">Returns</Link>
        <Link to="/app/notifications">Notifications</Link>
        <Link to="/app/sms-status">SMS Status</Link>
        <Link to="/app/fulfilment-settings">Fulfilment Settings</Link>
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