import { RemixBrowser } from "@remix-run/react";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";

type PendingRouteLineRequest = {
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
};

type LatestRouteLineRequest = {
  input: RequestInfo | URL;
  init?: RequestInit;
  cacheKey: string;
};

function installTomTomRouteLineCache() {
  if (typeof window === "undefined" || window.__bpdTomTomRouteLineCacheInstalled) {
    return;
  }

  window.__bpdTomTomRouteLineCacheInstalled = true;
  const originalFetch = window.fetch.bind(window);
  const routeLineCache = new Map<string, Promise<Response>>();
  const pendingRouteLineRequests: PendingRouteLineRequest[] = [];
  const maxCacheEntries = 60;
  const debounceDelayMs = 450;
  let latestRouteLineRequest: LatestRouteLineRequest | null = null;
  let routeLineDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  function routeLineCacheKey(requestUrl: string) {
    return requestUrl.replace(/([?&]key=)[^&]+/i, "$1***");
  }

  function trimRouteLineCache() {
    if (routeLineCache.size <= maxCacheEntries) {
      return;
    }

    const oldestKey = routeLineCache.keys().next().value;
    if (oldestKey) {
      routeLineCache.delete(oldestKey);
    }
  }

  async function runLatestRouteLineRequest() {
    const request = latestRouteLineRequest;
    latestRouteLineRequest = null;
    routeLineDebounceTimer = null;

    if (!request) {
      return;
    }

    const waitingRequests = pendingRouteLineRequests.splice(0);

    try {
      const responsePromise = originalFetch(request.input, request.init).then((response) => {
        if (!response.ok) {
          routeLineCache.delete(request.cacheKey);
          return response;
        }

        return response.clone();
      }).catch((error) => {
        routeLineCache.delete(request.cacheKey);
        throw error;
      });

      routeLineCache.set(request.cacheKey, responsePromise);
      trimRouteLineCache();

      const response = await responsePromise;
      waitingRequests.forEach(({ resolve }) => resolve(response.clone()));
    } catch (error) {
      waitingRequests.forEach(({ reject }) => reject(error));
    }
  }

  function scheduleRouteLineRequest(input: RequestInfo | URL, init: RequestInit | undefined, cacheKey: string) {
    return new Promise<Response>((resolve, reject) => {
      pendingRouteLineRequests.push({ resolve, reject });
      latestRouteLineRequest = { input, init, cacheKey };

      if (routeLineDebounceTimer) {
        clearTimeout(routeLineDebounceTimer);
      }

      routeLineDebounceTimer = setTimeout(runLatestRouteLineRequest, debounceDelayMs);
    });
  }

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

    const cacheKey = routeLineCacheKey(requestUrl);
    const cachedResponse = routeLineCache.get(cacheKey);

    if (cachedResponse) {
      return (await cachedResponse).clone();
    }

    return scheduleRouteLineRequest(input, init, cacheKey);
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
