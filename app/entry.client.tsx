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
  requestUrl: string;
};

type TomTomRoutePayload = {
  routes?: Array<{
    summary?: {
      lengthInMeters?: number;
      travelTimeInSeconds?: number;
    };
  }>;
};

function formatEta(startTime: string, offsetMinutes: number) {
  const [hours = "0", minutes = "0"] = startTime.split(":");
  const startMinutes = Number(hours) * 60 + Number(minutes);

  if (!Number.isFinite(startMinutes)) {
    return "Pending";
  }

  const etaMinutes = startMinutes + Math.round(offsetMinutes);
  const etaHours = Math.floor(etaMinutes / 60) % 24;
  const etaMinuteValue = etaMinutes % 60;

  return `${String(etaHours).padStart(2, "0")}:${String(etaMinuteValue).padStart(2, "0")}`;
}

function routeStopCountFromUrl(requestUrl: string) {
  const match = requestUrl.match(/calculateRoute\/([^/]+)\/json/i);
  const routePoints = match?.[1]?.split(":").filter(Boolean) || [];

  return Math.max(0, routePoints.length - 2);
}

function inputValue(name: string) {
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);

  return input?.value || "";
}

function currentSelectedStopCount() {
  const selectedIds = inputValue("selectedOrderIds")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return selectedIds.length;
}

function cleanText(element: Element) {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

function routeSummaryTextElements() {
  return Array.from(document.querySelectorAll<HTMLElement>("span,p"));
}

function findSummaryElement(predicate: (text: string) => boolean) {
  return routeSummaryTextElements().find((element) => predicate(cleanText(element))) || null;
}

function findRouteDetailLine() {
  return Array.from(document.querySelectorAll<HTMLElement>("p")).find((element) => {
    const text = cleanText(element);
    return text.startsWith("Route includes return to base") || text.startsWith("Route ends at");
  }) || null;
}

function findOptimisationBadge() {
  return findSummaryElement((text) => text === "Optimised" || text === "⚡ Optimised" || text === "Not optimised");
}

function currentRouteIsOptimised() {
  const badgeText = cleanText(findOptimisationBadge() || document.createElement("span"));

  return badgeText === "Optimised" || badgeText === "⚡ Optimised";
}

function setText(element: HTMLElement | null, value: string) {
  if (element && cleanText(element) !== value) {
    element.textContent = value;
  }
}

function hideElement(element: HTMLElement | null) {
  if (element && !element.hidden) {
    element.hidden = true;
  }
}

function removeSeparateLiveRouteCard() {
  document.getElementById("bpd-live-route-summary")?.remove();
}

function simplifyExistingRouteSummary() {
  removeSeparateLiveRouteCard();

  const routeDetailLine = findRouteDetailLine();
  const etaMatch = cleanText(routeDetailLine || document.createElement("p")).match(/Finish ETA:\s*([0-9]{2}:[0-9]{2})/);
  const finishEtaElement = findSummaryElement((text) => text.startsWith("Complete route time:") || text.startsWith("Finish ETA:"));

  if (etaMatch?.[1]) {
    setText(finishEtaElement, `Finish ETA: ${etaMatch[1]}`);
  }

  hideElement(routeDetailLine);

  const badge = findOptimisationBadge();
  if (badge && cleanText(badge) === "Optimised") {
    setText(badge, "⚡ Optimised");
  }
}

async function updateRouteSummaryFromResponse(response: Response, requestUrl: string) {
  try {
    const payload = await response.clone().json() as TomTomRoutePayload;
    const summary = payload.routes?.[0]?.summary;
    const lengthInMeters = summary?.lengthInMeters;
    const travelTimeInSeconds = summary?.travelTimeInSeconds;

    if (typeof lengthInMeters !== "number" || typeof travelTimeInSeconds !== "number") {
      simplifyExistingRouteSummary();
      return;
    }

    simplifyExistingRouteSummary();

    if (currentRouteIsOptimised()) {
      return;
    }

    const routeStopCount = routeStopCountFromUrl(requestUrl) || currentSelectedStopCount();
    const distanceMiles = (lengthInMeters / 1000) * 0.621371;
    const driveMinutes = travelTimeInSeconds / 60;
    const minutesPerDrop = Number(inputValue("timePerDropMinutes")) || 0;
    const finishEta = formatEta(inputValue("plannedStartTime") || "05:00", driveMinutes + (routeStopCount * minutesPerDrop));

    setText(findSummaryElement((text) => text.startsWith("Miles:")), `Miles: ${distanceMiles.toFixed(1)} mi`);
    setText(findSummaryElement((text) => text.startsWith("Complete route time:") || text.startsWith("Finish ETA:")), `Finish ETA: ${finishEta}`);
    setText(findOptimisationBadge(), "Not optimised");
    hideElement(findRouteDetailLine());
  } catch {
    simplifyExistingRouteSummary();
  }
}

function installRouteSummarySimplifier() {
  let scheduled = false;

  const schedule = () => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      simplifyExistingRouteSummary();
    });
  };

  const start = () => {
    simplifyExistingRouteSummary();
    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  };

  if (document.body) {
    start();
  } else {
    window.addEventListener("DOMContentLoaded", start, { once: true });
  }
}

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
      updateRouteSummaryFromResponse(response.clone(), request.requestUrl);
      waitingRequests.forEach(({ resolve }) => resolve(response.clone()));
    } catch (error) {
      waitingRequests.forEach(({ reject }) => reject(error));
    }
  }

  function scheduleRouteLineRequest(input: RequestInfo | URL, init: RequestInit | undefined, cacheKey: string, requestUrl: string) {
    return new Promise<Response>((resolve, reject) => {
      pendingRouteLineRequests.push({ resolve, reject });
      latestRouteLineRequest = { input, init, cacheKey, requestUrl };

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
      const response = await cachedResponse;
      updateRouteSummaryFromResponse(response.clone(), requestUrl);
      return response.clone();
    }

    return scheduleRouteLineRequest(input, init, cacheKey, requestUrl);
  };

  window.addEventListener("click", () => {
    window.setTimeout(simplifyExistingRouteSummary, 150);
  }, true);
}

function tidyDriverPodStatusCards() {
  if (!window.location.pathname.startsWith("/driver/routes/")) {
    return;
  }

  document.querySelectorAll<HTMLElement>("article").forEach((card) => {
    const heading = card.querySelector<HTMLElement>("h2");
    if (!heading || !cleanText(heading).startsWith("Drop ")) {
      return;
    }

    const cardText = card.textContent || "";
    const closed = cardText.includes("Delivery complete")
      || cardText.includes("Collection complete")
      || cardText.includes("Delivery marked missed")
      || cardText.includes("Collection could not be completed");

    if (!closed) {
      const baseHeading = cleanText(heading).replace(/\s+·\s+(CURRENT|NEXT)$/i, "");
      const status = card.id === "next-stop" ? "CURRENT" : "NEXT";
      setText(heading, `${baseHeading} · ${status}`);
    }

    const badge = heading.parentElement?.parentElement?.lastElementChild;
    if (badge instanceof HTMLElement) {
      Object.assign(badge.style, {
        width: "52px",
        height: "52px",
        minWidth: "52px",
        maxWidth: "52px",
        minHeight: "52px",
        maxHeight: "52px",
        flex: "0 0 52px",
        aspectRatio: "1 / 1",
        borderRadius: "50%",
        lineHeight: "1",
      });
    }
  });
}

function installDriverPodTidier() {
  const start = () => {
    tidyDriverPodStatusCards();
    new MutationObserver(() => window.requestAnimationFrame(tidyDriverPodStatusCards)).observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  };

  if (document.body) {
    start();
  } else {
    window.addEventListener("DOMContentLoaded", start, { once: true });
  }
}

declare global {
  interface Window {
    __bpdTomTomRouteLineCacheInstalled?: boolean;
  }
}

installRouteSummarySimplifier();
installTomTomRouteLineCache();
installDriverPodTidier();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RemixBrowser />
    </StrictMode>,
  );
});
