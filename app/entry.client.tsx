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

function formatDuration(minutes: number) {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;

  if (!hours) {
    return `${mins} min`;
  }

  return `${hours} hr ${mins} min`;
}

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

function liveRouteSummaryCard() {
  let card = document.getElementById("bpd-live-route-summary");

  if (card) {
    return card;
  }

  card = document.createElement("div");
  card.id = "bpd-live-route-summary";
  card.setAttribute("aria-live", "polite");
  card.style.border = "1px solid #d0d5dd";
  card.style.borderRadius = "12px";
  card.style.padding = "12px";
  card.style.marginBottom = "12px";
  card.style.background = "#f0f8ff";
  card.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)";

  const routePlanningHeading = Array.from(document.querySelectorAll("h3"))
    .find((heading) => heading.textContent?.trim() === "Route planning");
  const routePlanningBlock = routePlanningHeading?.parentElement?.parentElement;

  if (routePlanningBlock?.parentElement) {
    routePlanningBlock.parentElement.insertBefore(card, routePlanningBlock);
  } else {
    document.body.appendChild(card);
  }

  return card;
}

function hideLiveRouteSummaryWhenEmpty() {
  if (currentSelectedStopCount() > 0) {
    return;
  }

  const card = document.getElementById("bpd-live-route-summary");
  if (card) {
    card.hidden = true;
  }
}

async function updateLiveRouteSummaryFromResponse(response: Response, requestUrl: string) {
  try {
    const payload = await response.clone().json() as TomTomRoutePayload;
    const summary = payload.routes?.[0]?.summary;
    const lengthInMeters = summary?.lengthInMeters;
    const travelTimeInSeconds = summary?.travelTimeInSeconds;

    if (typeof lengthInMeters !== "number" || typeof travelTimeInSeconds !== "number") {
      return;
    }

    const routeStopCount = routeStopCountFromUrl(requestUrl) || currentSelectedStopCount();
    const distanceMiles = (lengthInMeters / 1000) * 0.621371;
    const driveMinutes = travelTimeInSeconds / 60;
    const minutesPerDrop = Number(inputValue("timePerDropMinutes")) || 0;
    const dropMinutes = routeStopCount * minutesPerDrop;
    const totalMinutes = driveMinutes + dropMinutes;
    const plannedStartTime = inputValue("plannedStartTime") || "05:00";
    const returnToBase = inputValue("returnToBase") === "true";
    const finishLabel = returnToBase ? "Return to base ETA" : "Finish ETA";
    const routeLabel = returnToBase ? "Includes return to base" : "Ends at finish point";
    const card = liveRouteSummaryCard();

    card.hidden = false;
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:8px; align-items:center; margin-bottom:6px;">
        <strong style="font-size:13px; color:#323841;">Live TomTom route estimate</strong>
        <span style="font-size:12px; font-weight:700; color:#509AE6; background:#ffffff; border:1px solid #bfdbfe; border-radius:999px; padding:3px 8px;">Before RouteXL</span>
      </div>
      <div style="font-size:13px; color:#323841; line-height:1.45;">
        ${routeStopCount} stops · ${distanceMiles.toFixed(1)} mi · ${formatDuration(driveMinutes)} driving<br />
        ${formatDuration(totalMinutes)} including drops · ${finishLabel}: ${formatEta(plannedStartTime, totalMinutes)}
      </div>
      <div style="font-size:12px; color:#667085; margin-top:5px;">${routeLabel}. RouteXL can still optimise the order if needed.</div>
    `;
  } catch {
    // If TomTom changes the response shape, leave the normal route map untouched.
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
      updateLiveRouteSummaryFromResponse(response.clone(), request.requestUrl);
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
      updateLiveRouteSummaryFromResponse(response.clone(), requestUrl);
      return response.clone();
    }

    return scheduleRouteLineRequest(input, init, cacheKey, requestUrl);
  };

  window.addEventListener("click", () => {
    window.setTimeout(hideLiveRouteSummaryWhenEmpty, 150);
  }, true);
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
