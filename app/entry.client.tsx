import { RemixBrowser } from "@remix-run/react";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";

function installTomTomRouteLineCache() {
  if (typeof window === "undefined" || window.__bpdTomTomRouteLineCacheInstalled) {
    return;
  }

  window.__bpdTomTomRouteLineCacheInstalled = true;
  const originalFetch = window.fetch.bind(window);
  const routeLineCache = new Map<string, Promise<Response>>();
  const maxCacheEntries = 60;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const isTomTomRouteLineRequest = method === "GET" && requestUrl.includes("api.tomtom.com/routing/1/calculateRoute/");

    if (!isTomTomRouteLineRequest) {
      return originalFetch(input, init);
    }

    const cacheKey = requestUrl.replace(/([?&]key=)[^&]+/i, "$1***");
    const cachedResponse = routeLineCache.get(cacheKey);

    if (cachedResponse) {
      return (await cachedResponse).clone();
    }

    const responsePromise = originalFetch(input, init).then((response) => {
      if (!response.ok) {
        routeLineCache.delete(cacheKey);
        return response;
      }

      return response.clone();
    }).catch((error) => {
      routeLineCache.delete(cacheKey);
      throw error;
    });

    routeLineCache.set(cacheKey, responsePromise);

    if (routeLineCache.size > maxCacheEntries) {
      const oldestKey = routeLineCache.keys().next().value;
      if (oldestKey) {
        routeLineCache.delete(oldestKey);
      }
    }

    return (await responsePromise).clone();
  };
}

declare global {
  interface Window {
    __bpdTomTomRouteLineCacheInstalled?: boolean;
  }
}

installTomTomRouteLineCache();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RemixBrowser />
    </StrictMode>,
  );
});
