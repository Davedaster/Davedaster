import { useEffect, useMemo, useRef, useState } from "react";
import "@tomtom-international/web-sdk-maps/dist/maps.css";

type RouteMapPoint = {
  id: string;
  label: string;
  title?: string;
  latitude: number | null;
  longitude: number | null;
  selected?: boolean;
  status?: string;
  tooltipTitle?: string;
  tooltipLines?: string[];
};

type RouteEndpoint = {
  address: string;
  label: string;
  latitude?: number | null;
  longitude?: number | null;
  status: "START" | "FINISH";
};

type MapContextLocation = {
  address: string;
  latitude: number;
  longitude: number;
};

type MapContextAction = "setStart" | "setFinish";
type PointContextAction = "setFirstDrop" | "setLastDrop" | "clearFixedPosition";

type RouteMapProps = {
  points: RouteMapPoint[];
  height?: number;
  title?: string;
  badge?: string;
  showRouteLine?: boolean;
  onSelectPoint?: (point: RouteMapPoint) => void;
  onMapContextAction?: (action: MapContextAction, location: MapContextLocation) => void;
  onPointContextAction?: (action: PointContextAction, point: RouteMapPoint) => void;
  apiKey?: string | null;
  routeStart?: RouteEndpoint | null;
  routeFinish?: RouteEndpoint | null;
};

type MappablePoint = RouteMapPoint & { latitude: number; longitude: number };
type MappableEndpoint = RouteEndpoint & { id: string; latitude: number; longitude: number };
type RouteCoordinatePoint = { latitude: number; longitude: number };
type ContextMenuState = {
  x: number;
  y: number;
  latitude: number;
  longitude: number;
  pointId: string | null;
};
type TomTomMapRef = any;
type TomTomPopupRef = any;
type TooltipTone = "default" | "success" | "warning" | "critical";

const DEFAULT_CENTER: [number, number] = [-3.6119, 50.5293];
const DEFAULT_SHOP_LOCATION = {
  address: "Unit 1 Olympus Business Park, Newton Abbot, TQ12 2SN, United Kingdom",
  latitude: 50.5293,
  longitude: -3.6119,
};
const START_ENDPOINT_IMAGE_ID = "bpd-route-endpoint-start-pin-v3";
const FINISH_ENDPOINT_IMAGE_ID = "bpd-route-endpoint-finish-pin-v3";
const SPLIT_ENDPOINT_IMAGE_ID = "bpd-route-start-finish-pin-return-v4";
const ENDPOINT_ICON_SIZE = 0.62;
const TRAFFIC_MARKER_PATTERN = /^[\s🟢🔵🟠🔴⚪]+/u;
const FULFIL_BY_PATTERN = /fulfil\s*by\s*:?\s*([0-9]{1,2}\s+[A-Za-z]{3,9}\.?\s+[0-9]{4})/i;
const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function normalisedPoints(points: RouteMapPoint[]): MappablePoint[] {
  return points.filter((point): point is MappablePoint => (
    typeof point.latitude === "number" &&
    typeof point.longitude === "number" &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude)
  ));
}

function cleanPinLabel(point: RouteMapPoint, fallback: number) {
  const cleaned = point.label.trim().replace("#", "");

  return cleaned || String(fallback);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function tooltipLinesForPoint(point: RouteMapPoint) {
  if (point.tooltipLines?.length) {
    return point.tooltipLines.filter(Boolean);
  }

  return (point.title || point.label)
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
}

function localDateOnly(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseShortBritishDate(value: string) {
  const match = value.match(/([0-9]{1,2})\s+([A-Za-z]{3,9})\.?\s+([0-9]{4})/);

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const monthText = match[2].toLowerCase().replace(".", "");
  const month = MONTHS[monthText] ?? MONTHS[monthText.slice(0, 3)];
  const year = Number(match[3]);

  if (!Number.isFinite(day) || typeof month !== "number" || !Number.isFinite(year)) {
    return null;
  }

  return new Date(year, month, day);
}

function isWorkingDay(date: Date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function workingDaysUntil(target: Date) {
  const today = localDateOnly(new Date());
  const end = localDateOnly(target);

  if (end.getTime() <= today.getTime()) {
    return 0;
  }

  const cursor = new Date(today);
  let days = 0;

  while (cursor.getTime() < end.getTime()) {
    cursor.setDate(cursor.getDate() + 1);
    if (isWorkingDay(cursor)) {
      days += 1;
    }
  }

  return days;
}

function markerToneFromLine(line: string): TooltipTone | null {
  const trimmed = line.trim();

  if (trimmed.startsWith("🟢")) {
    return "success";
  }

  if (trimmed.startsWith("🟠") || trimmed.startsWith("🔵")) {
    return "warning";
  }

  if (trimmed.startsWith("🔴")) {
    return "critical";
  }

  return null;
}

function fulfilmentToneFromLine(line: string): TooltipTone | null {
  const fulfilByMatch = line.match(FULFIL_BY_PATTERN);

  if (!fulfilByMatch) {
    return null;
  }

  const fulfilByDate = parseShortBritishDate(fulfilByMatch[1]);

  if (!fulfilByDate) {
    return markerToneFromLine(line) || "default";
  }

  const daysLeft = workingDaysUntil(fulfilByDate);

  if (daysLeft >= 4) {
    return "success";
  }

  if (daysLeft >= 2) {
    return "warning";
  }

  return "critical";
}

function tooltipToneForLine(line: string): TooltipTone {
  const lower = line.toLowerCase();
  const fulfilmentTone = fulfilmentToneFromLine(line);

  if (lower.includes("redeliver")) {
    return "critical";
  }

  if (fulfilmentTone) {
    return fulfilmentTone;
  }

  return markerToneFromLine(line) || "default";
}

function cleanTooltipLine(line: string) {
  return line.replace(TRAFFIC_MARKER_PATTERN, "").trim();
}

function fulfilmentDateLineHtml(line: string, tone: TooltipTone) {
  const cleanLine = cleanTooltipLine(line);
  const fulfilByMatch = cleanLine.match(FULFIL_BY_PATTERN);

  if (!fulfilByMatch) {
    return null;
  }

  const dateText = fulfilByMatch[1];
  const matchStart = fulfilByMatch.index || 0;
  const labelText = cleanLine
    .slice(0, matchStart)
    .concat(cleanLine.slice(matchStart, matchStart + fulfilByMatch[0].length).replace(dateText, ""));

  return `<div class="bpd-tooltip-line">${escapeHtml(labelText)}<span class="bpd-tooltip-date bpd-tooltip-date--${tone}">${escapeHtml(dateText)}</span></div>`;
}

function tooltipLineHtml(line: string, index: number) {
  if (index === 0) {
    return `<div class="bpd-tooltip-heading">${escapeHtml(line)}</div>`;
  }

  const fulfilmentTone = fulfilmentToneFromLine(line);
  const fulfilmentHtml = fulfilmentTone ? fulfilmentDateLineHtml(line, fulfilmentTone) : null;

  if (fulfilmentHtml) {
    return fulfilmentHtml;
  }

  const tone = tooltipToneForLine(line);
  return `<div class="bpd-tooltip-line bpd-tooltip-line--${tone}">${escapeHtml(cleanTooltipLine(line))}</div>`;
}

function tooltipHtml(point: RouteMapPoint) {
  const lines = tooltipLinesForPoint(point);
  const heading = point.tooltipTitle || lines[0] || point.title || point.label;
  const bodyLines = point.tooltipTitle ? lines : lines.slice(1);

  return [heading, ...bodyLines]
    .filter(Boolean)
    .map(tooltipLineHtml)
    .join("");
}

function markerColour(point: RouteMapPoint) {
  if (point.status === "DELIVERED" || point.status === "COLLECTED") {
    return "#16a34a";
  }

  if (point.status === "FAILED") {
    return "#b42318";
  }

  return point.selected ? "#323841" : "#509AE6";
}

function endpointColour(endpoint: MappableEndpoint) {
  return endpoint.status === "START" ? "#16a34a" : "#b42318";
}

function endpointImage(endpoint: MappableEndpoint) {
  return endpoint.status === "START" ? START_ENDPOINT_IMAGE_ID : FINISH_ENDPOINT_IMAGE_ID;
}

function styles() {
  return `
    .bpd-tomtom-map { overscroll-behavior: contain; }
    .bpd-tomtom-map .mapboxgl-map { font-family: inherit; overscroll-behavior: contain; touch-action: none; }
    .bpd-tomtom-map .mapboxgl-canvas-container,
    .bpd-tomtom-map .mapboxgl-canvas { overscroll-behavior: contain; touch-action: none; }
    .bpd-tomtom-map .mapboxgl-ctrl-group button { width: 36px; height: 36px; }
    .bpd-tomtom-map .mapboxgl-canvas { outline: none; }
    .bpd-tomtom-popup .mapboxgl-popup-content {
      background: rgba(255,255,255,0.98);
      color: #323841;
      border: 1px solid #d0d5dd;
      border-radius: 14px;
      padding: 10px 12px;
      box-shadow: 0 10px 24px rgba(0,0,0,0.22);
      min-width: 210px;
      max-width: min(320px, calc(100vw - 36px));
      overflow: visible;
    }
    .bpd-tomtom-popup .mapboxgl-popup-tip { display: none; }
    .bpd-tooltip-heading { font-size: 13px; font-weight: 800; line-height: 1.35; }
    .bpd-tooltip-line { margin-top: 3px; font-size: 12px; font-weight: 500; line-height: 1.35; color: #475467; }
    .bpd-tooltip-line--success { color: #15803d; font-weight: 800; }
    .bpd-tooltip-line--warning { color: #ea580c; font-weight: 800; }
    .bpd-tooltip-line--critical { color: #b42318; font-weight: 800; }
    .bpd-tooltip-date { font-weight: 800; }
    .bpd-tooltip-date--success { color: #15803d; }
    .bpd-tooltip-date--warning { color: #ea580c; }
    .bpd-tooltip-date--critical { color: #b42318; }
  `;
}

function buildFeatureCollection(points: MappablePoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((point, index) => ({
      type: "Feature" as const,
      id: point.id,
      properties: {
        id: point.id,
        label: cleanPinLabel(point, index + 1),
        colour: markerColour(point),
        markerRadius: cleanPinLabel(point, index + 1).length > 3 ? 25 : 18,
        labelSize: cleanPinLabel(point, index + 1).length > 3 ? 10 : 11,
        tooltip: tooltipHtml(point),
      },
      geometry: {
        type: "Point" as const,
        coordinates: [point.longitude, point.latitude],
      },
    })),
  };
}

function endpointCoordinateKey(endpoint: MappableEndpoint) {
  return `${endpoint.latitude.toFixed(6)},${endpoint.longitude.toFixed(6)}`;
}

function mergedEndpointMarkers(endpoints: MappableEndpoint[]) {
  const groups = new Map<string, MappableEndpoint[]>();

  for (const endpoint of endpoints) {
    const key = endpointCoordinateKey(endpoint);
    groups.set(key, [...(groups.get(key) || []), endpoint]);
  }

  return [...groups.values()].map((group) => {
    const firstEndpoint = group[0];
    const hasStart = group.some((endpoint) => endpoint.status === "START");
    const hasFinish = group.some((endpoint) => endpoint.status === "FINISH");
    const label = hasStart && hasFinish ? "" : firstEndpoint.label;
    const address = firstEndpoint.address;

    return {
      ...firstEndpoint,
      id: hasStart && hasFinish ? "route-start-finish" : firstEndpoint.id,
      label,
      status: hasStart ? "START" as const : firstEndpoint.status,
      address,
    };
  });
}

function buildEndpointFeatureCollection(endpoints: MappableEndpoint[]) {
  const markers = mergedEndpointMarkers(endpoints);

  return {
    type: "FeatureCollection" as const,
    features: markers.map((endpoint) => {
      const isStartFinish = endpoint.id === "route-start-finish";
      const tooltipLabel = isStartFinish ? "Start and finish" : endpoint.label;

      return {
        type: "Feature" as const,
        id: endpoint.id,
        properties: {
          id: endpoint.id,
          label: endpoint.label,
          markerType: isStartFinish ? "startFinish" : "single",
          colour: endpointColour(endpoint),
          iconImage: isStartFinish ? SPLIT_ENDPOINT_IMAGE_ID : endpointImage(endpoint),
          tooltip: `<div class="bpd-tooltip-heading">${escapeHtml(tooltipLabel)}</div><div class="bpd-tooltip-line">${escapeHtml(endpoint.address)}</div>`,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [endpoint.longitude, endpoint.latitude],
        },
      };
    }),
  };
}

function drawLocationPin(context: CanvasRenderingContext2D, colour: string) {
  const cx = 32;
  const cy = 33;
  const tipY = 76;

  context.beginPath();
  context.moveTo(cx, tipY);
  context.bezierCurveTo(cx - 5, tipY - 9, cx - 23, cy + 15, cx - 23, cy - 2);
  context.bezierCurveTo(cx - 23, cy - 17, cx - 13, cy - 28, cx, cy - 28);
  context.bezierCurveTo(cx + 13, cy - 28, cx + 23, cy - 17, cx + 23, cy - 2);
  context.bezierCurveTo(cx + 23, cy + 15, cx + 5, tipY - 9, cx, tipY);
  context.closePath();
  context.fillStyle = colour;
  context.fill();
  context.strokeStyle = "#ffffff";
  context.lineWidth = 5;
  context.stroke();
}

function createEndpointPinImage(colour: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 78;

  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  drawLocationPin(context, colour);

  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function drawReturnBaseIcon(context: CanvasRenderingContext2D, badgeCenterX: number, badgeCenterY: number) {
  context.fillStyle = "#ffffff";

  context.beginPath();
  context.moveTo(badgeCenterX - 6, badgeCenterY - 1);
  context.lineTo(badgeCenterX, badgeCenterY - 7);
  context.lineTo(badgeCenterX + 6, badgeCenterY - 1);
  context.closePath();
  context.fill();

  context.fillRect(badgeCenterX - 4.4, badgeCenterY - 1, 8.8, 6.8);

  context.fillStyle = "#b42318";
  context.fillRect(badgeCenterX - 1.2, badgeCenterY + 2.1, 2.4, 3.7);
}

function createSplitEndpointImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 78;

  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  drawLocationPin(context, "#16a34a");

  const badgeCenterX = 45;
  const badgeCenterY = 16;
  const badgeRadius = 10;

  context.beginPath();
  context.arc(badgeCenterX, badgeCenterY, badgeRadius, 0, Math.PI * 2);
  context.fillStyle = "#b42318";
  context.fill();
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2.5;
  context.stroke();

  drawReturnBaseIcon(context, badgeCenterX, badgeCenterY);

  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function ensureEndpointImages(map: TomTomMapRef) {
  try {
    const images: Array<[string, ImageData | null]> = [
      [START_ENDPOINT_IMAGE_ID, createEndpointPinImage("#16a34a")],
      [FINISH_ENDPOINT_IMAGE_ID, createEndpointPinImage("#b42318")],
      [SPLIT_ENDPOINT_IMAGE_ID, createSplitEndpointImage()],
    ];

    for (const [id, image] of images) {
      if (!image) {
        return false;
      }

      if (!map.hasImage?.(id)) {
        map.addImage(id, image);
      }
    }

    return true;
  } catch {
    return false;
  }
}

function boundsForCoordinates(coordinates: number[][]) {
  const lngValues = coordinates.map((coordinate) => coordinate[0]);
  const latValues = coordinates.map((coordinate) => coordinate[1]);

  return [
    [Math.min(...lngValues), Math.min(...latValues)],
    [Math.max(...lngValues), Math.max(...latValues)],
  ];
}

function straightLineCoordinates(points: RouteCoordinatePoint[]) {
  return points.map((point) => [point.longitude, point.latitude]);
}

function selectedRoutePoints(points: MappablePoint[]) {
  return points.filter((point) => point.selected);
}

function routeRequestKey(points: RouteCoordinatePoint[]) {
  return points.map((point) => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`).join(":");
}

function tomTomRouteUrl(points: RouteCoordinatePoint[], apiKey: string) {
  const locations = routeRequestKey(points);
  const params = new URLSearchParams({
    key: apiKey,
    traffic: "true",
    travelMode: "van",
    routeType: "fastest",
  });

  return `https://api.tomtom.com/routing/1/calculateRoute/${locations}/json?${params.toString()}`;
}

function tomTomGeocodeUrl(address: string, apiKey: string) {
  const params = new URLSearchParams({
    key: apiKey,
    countrySet: "GB",
    limit: "1",
  });

  return `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(address)}.json?${params.toString()}`;
}

function tomTomReverseGeocodeUrl(latitude: number, longitude: number, apiKey: string) {
  const params = new URLSearchParams({
    key: apiKey,
    radius: "80",
  });

  return `https://api.tomtom.com/search/2/reverseGeocode/${latitude},${longitude}.json?${params.toString()}`;
}

function coordinateAddressFallback(latitude: number, longitude: number) {
  return `Map point ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

function addressFromReverseGeocodePayload(payload: any) {
  const address = payload?.addresses?.[0]?.address;

  return address?.freeformAddress || address?.streetNameAndNumber || address?.municipality || "";
}

function coordinatesFromTomTomRoute(payload: any) {
  const legs = payload?.routes?.[0]?.legs || [];
  const coordinates: number[][] = [];

  for (const leg of legs) {
    for (const point of leg.points || []) {
      if (typeof point.latitude === "number" && typeof point.longitude === "number") {
        coordinates.push([point.longitude, point.latitude]);
      }
    }
  }

  return coordinates;
}

function isDefaultShopAddress(address: string) {
  const normalisedAddress = address.trim().toLowerCase();

  return normalisedAddress === DEFAULT_SHOP_LOCATION.address.toLowerCase() ||
    (normalisedAddress.includes("olympus") && normalisedAddress.includes("tq12 2sn"));
}

async function resolveEndpoint(endpoint: RouteEndpoint | null | undefined, apiKey: string): Promise<MappableEndpoint | null> {
  if (!endpoint?.address.trim()) {
    return null;
  }

  if (typeof endpoint.latitude === "number" && typeof endpoint.longitude === "number") {
    return {
      ...endpoint,
      id: `route-${endpoint.status.toLowerCase()}`,
      latitude: endpoint.latitude,
      longitude: endpoint.longitude,
    };
  }

  if (isDefaultShopAddress(endpoint.address)) {
    return {
      ...endpoint,
      id: `route-${endpoint.status.toLowerCase()}`,
      latitude: DEFAULT_SHOP_LOCATION.latitude,
      longitude: DEFAULT_SHOP_LOCATION.longitude,
    };
  }

  const response = await fetch(tomTomGeocodeUrl(endpoint.address, apiKey));

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const position = payload?.results?.[0]?.position;

  if (typeof position?.lat !== "number" || typeof position?.lon !== "number") {
    return null;
  }

  return {
    ...endpoint,
    id: `route-${endpoint.status.toLowerCase()}`,
    latitude: position.lat,
    longitude: position.lon,
  };
}

export function RouteMap({
  points,
  height = 520,
  title = "Route map",
  badge,
  showRouteLine = true,
  onSelectPoint,
  onMapContextAction,
  onPointContextAction,
  apiKey,
  routeStart,
  routeFinish,
}: RouteMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<TomTomMapRef | null>(null);
  const popupRef = useRef<TomTomPopupRef | null>(null);
  const hasInitialFitRef = useRef(false);
  const sourceIdRef = useRef(`orders-${Math.random().toString(36).slice(2)}`);
  const routeSourceIdRef = useRef(`route-${Math.random().toString(36).slice(2)}`);
  const endpointSourceIdRef = useRef(`route-endpoints-${Math.random().toString(36).slice(2)}`);
  const clustersLayerIdRef = useRef(`clusters-${Math.random().toString(36).slice(2)}`);
  const clusterCountLayerIdRef = useRef(`cluster-count-${Math.random().toString(36).slice(2)}`);
  const pinsLayerIdRef = useRef(`pins-${Math.random().toString(36).slice(2)}`);
  const pinTouchTargetLayerIdRef = useRef(`pin-touch-targets-${Math.random().toString(36).slice(2)}`);
  const pinLabelLayerIdRef = useRef(`pin-labels-${Math.random().toString(36).slice(2)}`);
  const routeLayerIdRef = useRef(`route-layer-${Math.random().toString(36).slice(2)}`);
  const endpointPinsLayerIdRef = useRef(`route-endpoint-pins-${Math.random().toString(36).slice(2)}`);
  const endpointLabelLayerIdRef = useRef(`route-endpoint-labels-${Math.random().toString(36).slice(2)}`);
  const [loadedApiKey, setLoadedApiKey] = useState(apiKey || "");
  const [mapReady, setMapReady] = useState(false);
  const [roadRouteCoordinates, setRoadRouteCoordinates] = useState<number[][]>([]);
  const [resolvedStart, setResolvedStart] = useState<MappableEndpoint | null>(null);
  const [resolvedFinish, setResolvedFinish] = useState<MappableEndpoint | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [contextMenuLoading, setContextMenuLoading] = useState(false);
  const mappablePoints = useMemo(() => normalisedPoints(points), [points]);
  const selectedPoints = useMemo(() => selectedRoutePoints(mappablePoints), [mappablePoints]);
  const activeApiKey = apiKey || loadedApiKey;
  const routeEndpoints = useMemo(() => [resolvedStart, resolvedFinish].filter((endpoint): endpoint is MappableEndpoint => Boolean(endpoint)), [resolvedStart, resolvedFinish]);
  const routePathPoints = useMemo(() => [
    ...(resolvedStart ? [resolvedStart] : []),
    ...selectedPoints,
    ...(resolvedFinish ? [resolvedFinish] : []),
  ], [resolvedStart, resolvedFinish, selectedPoints]);
  const routePathKey = useMemo(() => routeRequestKey(routePathPoints), [routePathPoints]);

  const resolveContextLocation = async (menu: ContextMenuState): Promise<MapContextLocation> => {
    const fallback = coordinateAddressFallback(menu.latitude, menu.longitude);

    if (!activeApiKey) {
      return {
        address: fallback,
        latitude: menu.latitude,
        longitude: menu.longitude,
      };
    }

    try {
      const response = await fetch(tomTomReverseGeocodeUrl(menu.latitude, menu.longitude, activeApiKey));

      if (!response.ok) {
        throw new Error(`Reverse geocode failed with status ${response.status}`);
      }

      const payload = await response.json();
      const address = addressFromReverseGeocodePayload(payload).trim();

      return {
        address: address || fallback,
        latitude: menu.latitude,
        longitude: menu.longitude,
      };
    } catch {
      return {
        address: fallback,
        latitude: menu.latitude,
        longitude: menu.longitude,
      };
    }
  };

  const handleMapContextAction = async (action: MapContextAction) => {
    if (!contextMenu) {
      return;
    }

    setContextMenuLoading(true);
    const location = await resolveContextLocation(contextMenu);
    setContextMenuLoading(false);
    setContextMenu(null);
    onMapContextAction?.(action, location);
  };

  const handlePointContextAction = (action: PointContextAction) => {
    if (!contextMenu?.pointId) {
      return;
    }

    const point = mappablePoints.find((candidate) => candidate.id === contextMenu.pointId);

    setContextMenu(null);

    if (point) {
      onPointContextAction?.(action, point);
    }
  };

  useEffect(() => {
    if (apiKey) {
      setLoadedApiKey(apiKey);
      return;
    }

    let cancelled = false;

    async function loadKey() {
      try {
        const response = await fetch("/api/tomtom-key");
        const data = await response.json() as { apiKey?: string };

        if (!cancelled) {
          setLoadedApiKey(data.apiKey || "");
        }
      } catch {
        if (!cancelled) {
          setLoadedApiKey("");
        }
      }
    }

    loadKey();

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  useEffect(() => {
    let cancelled = false;

    async function resolveRouteEndpoints() {
      if (!activeApiKey) {
        setResolvedStart(null);
        setResolvedFinish(null);
        return;
      }

      const [start, finish] = await Promise.all([
        resolveEndpoint(routeStart, activeApiKey),
        resolveEndpoint(routeFinish, activeApiKey),
      ]);

      if (!cancelled) {
        setResolvedStart(start);
        setResolvedFinish(finish);
      }
    }

    resolveRouteEndpoints();

    return () => {
      cancelled = true;
    };
  }, [activeApiKey, routeStart?.address, routeStart?.latitude, routeStart?.longitude, routeFinish?.address, routeFinish?.latitude, routeFinish?.longitude]);

  useEffect(() => {
    let cancelled = false;

    async function setupMap() {
      if (!mapElementRef.current || mapRef.current || !activeApiKey) {
        return;
      }

      const tt = await import("@tomtom-international/web-sdk-maps");

      if (cancelled || !mapElementRef.current) {
        return;
      }

      const map = tt.map({
        key: activeApiKey,
        container: mapElementRef.current,
        center: DEFAULT_CENTER,
        zoom: 10,
        dragPan: true,
        scrollZoom: true,
        touchZoomRotate: true,
      });

      map.addControl(new tt.NavigationControl(), "bottom-right");
      map.once("load", () => {
        if (!cancelled) {
          setMapReady(true);
        }
      });
      mapRef.current = map;
    }

    setupMap();

    return () => {
      cancelled = true;
    };
  }, [activeApiKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadRoadRoute() {
      if (!showRouteLine || !activeApiKey || routePathPoints.length < 2 || selectedPoints.length < 1) {
        setRoadRouteCoordinates([]);
        return;
      }

      const fallback = straightLineCoordinates(routePathPoints);

      try {
        const response = await fetch(tomTomRouteUrl(routePathPoints, activeApiKey));

        if (!response.ok) {
          throw new Error(`TomTom route failed with status ${response.status}`);
        }

        const payload = await response.json();
        const coordinates = coordinatesFromTomTomRoute(payload);

        if (!cancelled) {
          setRoadRouteCoordinates(coordinates.length > 1 ? coordinates : fallback);
        }
      } catch {
        if (!cancelled) {
          setRoadRouteCoordinates(fallback);
        }
      }
    }

    loadRoadRoute();

    return () => {
      cancelled = true;
    };
  }, [activeApiKey, routePathKey, routePathPoints, selectedPoints.length, showRouteLine]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapReady) {
      return;
    }

    const sourceId = sourceIdRef.current;
    const routeSourceId = routeSourceIdRef.current;
    const endpointSourceId = endpointSourceIdRef.current;
    const clustersLayerId = clustersLayerIdRef.current;
    const clusterCountLayerId = clusterCountLayerIdRef.current;
    const pinsLayerId = pinsLayerIdRef.current;
    const pinTouchTargetLayerId = pinTouchTargetLayerIdRef.current;
    const pinLabelLayerId = pinLabelLayerIdRef.current;
    const routeLayerId = routeLayerIdRef.current;
    const endpointPinsLayerId = endpointPinsLayerIdRef.current;
    const endpointLabelLayerId = endpointLabelLayerIdRef.current;
    const featureCollection = buildFeatureCollection(mappablePoints);
    const endpointFeatureCollection = buildEndpointFeatureCollection(routeEndpoints);
    const fallbackRouteCoordinates = straightLineCoordinates(routePathPoints);
    const routeCoordinates = roadRouteCoordinates.length > 1 ? roadRouteCoordinates : fallbackRouteCoordinates;

    const removeLayer = (layerId: string) => {
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }
    };

    const removeSource = (id: string) => {
      if (map.getSource(id)) {
        map.removeSource(id);
      }
    };

    removeLayer(clusterCountLayerId);
    removeLayer(clustersLayerId);
    removeLayer(pinLabelLayerId);
    removeLayer(pinsLayerId);
    removeLayer(pinTouchTargetLayerId);
    removeLayer(endpointLabelLayerId);
    removeLayer(endpointPinsLayerId);
    removeLayer(routeLayerId);
    removeSource(sourceId);
    removeSource(endpointSourceId);
    removeSource(routeSourceId);

    map.addSource(sourceId, {
      type: "geojson",
      data: featureCollection,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    });

    if (showRouteLine && selectedPoints.length > 0 && routeCoordinates.length > 1) {
      map.addSource(routeSourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: routeCoordinates,
          },
        },
      });

      map.addLayer({
        id: routeLayerId,
        type: "line",
        source: routeSourceId,
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#509AE6",
          "line-width": 4,
          "line-opacity": 0.85,
        },
      });
    }

    map.addLayer({
      id: clustersLayerId,
      type: "circle",
      source: sourceId,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#509AE6", 5, "#f97316", 13, "#b42318"],
        "circle-radius": ["step", ["get", "point_count"], 19, 5, 23, 13, 27],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
        "circle-opacity": 0.95,
      },
    });

    map.addLayer({
      id: clusterCountLayerId,
      type: "symbol",
      source: sourceId,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": 14,
      },
      paint: {
        "text-color": "#ffffff",
      },
    });

    map.addLayer({
      id: pinTouchTargetLayerId,
      type: "circle",
      source: sourceId,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": 30,
        "circle-color": "#000000",
        "circle-opacity": 0.001,
      },
    });

    map.addLayer({
      id: pinsLayerId,
      type: "circle",
      source: sourceId,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["get", "colour"],
        "circle-radius": ["get", "markerRadius"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
        "circle-opacity": 0.98,
      },
    });

    map.addLayer({
      id: pinLabelLayerId,
      type: "symbol",
      source: sourceId,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "text-field": ["get", "label"],
        "text-size": ["get", "labelSize"],
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#ffffff",
      },
    });

    map.addSource(endpointSourceId, {
      type: "geojson",
      data: endpointFeatureCollection,
    });

    const endpointImagesReady = ensureEndpointImages(map);

    if (endpointImagesReady) {
      map.addLayer({
        id: endpointPinsLayerId,
        type: "symbol",
        source: endpointSourceId,
        layout: {
          "icon-image": ["get", "iconImage"],
          "icon-size": ENDPOINT_ICON_SIZE,
          "icon-anchor": "bottom",
          "icon-allow-overlap": true,
        },
      });
    } else {
      map.addLayer({
        id: endpointPinsLayerId,
        type: "circle",
        source: endpointSourceId,
        paint: {
          "circle-color": ["get", "colour"],
          "circle-radius": 18,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 3,
          "circle-opacity": 0.98,
        },
      });
    }

    const hidePopup = () => {
      map.getCanvas().style.cursor = "";
      popupRef.current?.remove();
    };

    const handleClusterClick = (event: any) => {
      const features = map.queryRenderedFeatures(event.point, { layers: [clustersLayerId] });
      const feature = features[0];
      const clusterId = feature?.properties?.cluster_id;
      const source = map.getSource(sourceId);

      if (!source || typeof clusterId === "undefined") {
        return;
      }

      source.getClusterExpansionZoom(clusterId, (error: Error | null, zoom: number) => {
        if (error) {
          return;
        }

        map.easeTo({ center: feature.geometry.coordinates, zoom });
      });
    };

    const handlePinClick = (event: any) => {
      const feature = event.features?.[0];
      const id = feature?.properties?.id;
      const point = mappablePoints.find((mapPoint) => mapPoint.id === id);

      if (point) {
        onSelectPoint?.(point);
      }
    };

    const handleContextMenu = (event: any) => {
      event.preventDefault?.();
      event.originalEvent?.preventDefault?.();
      popupRef.current?.remove();

      const features = map.queryRenderedFeatures(event.point, { layers: [pinsLayerId, pinLabelLayerId, pinTouchTargetLayerId] });
      const pointId = features[0]?.properties?.id || null;

      setContextMenu({
        x: event.point.x,
        y: event.point.y,
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
        pointId,
      });
    };

    const showPopupForFeature = async (feature: any) => {
      if (!feature) {
        return;
      }

      const tt = await import("@tomtom-international/web-sdk-maps");
      popupRef.current?.remove();
      popupRef.current = new tt.Popup({ closeButton: false, closeOnClick: false, className: "bpd-tomtom-popup", offset: 18 })
        .setLngLat(feature.geometry.coordinates)
        .setHTML(feature.properties.tooltip || "")
        .addTo(map);
    };

    const shouldShowDesktopPopup = () => {
      if (typeof window === "undefined") {
        return true;
      }

      const canHover = window.matchMedia("(hover: hover), (any-hover: hover)").matches;
      const hasFinePointer = window.matchMedia("(pointer: fine), (any-pointer: fine)").matches;

      return canHover || hasFinePointer;
    };

    const showPopup = async (event: any) => {
      if (!shouldShowDesktopPopup()) {
        hidePopup();
        return;
      }

      map.getCanvas().style.cursor = "pointer";
      await showPopupForFeature(event.features?.[0]);
    };

    const handleMapMovement = () => {
      hidePopup();
      setContextMenu(null);
    };

    const handleClusterEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };

    const handleClusterLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", clustersLayerId, handleClusterClick);
    map.on("click", pinTouchTargetLayerId, handlePinClick);
    map.on("click", pinsLayerId, handlePinClick);
    map.on("contextmenu", handleContextMenu);
    map.on("mouseenter", clustersLayerId, handleClusterEnter);
    map.on("mouseleave", clustersLayerId, handleClusterLeave);
    map.on("mouseenter", pinTouchTargetLayerId, handleClusterEnter);
    map.on("mouseleave", pinTouchTargetLayerId, handleClusterLeave);
    map.on("mouseenter", pinsLayerId, showPopup);
    map.on("mouseleave", pinsLayerId, hidePopup);
    map.on("mouseenter", endpointPinsLayerId, showPopup);
    map.on("mouseleave", endpointPinsLayerId, hidePopup);
    map.on("dragstart", handleMapMovement);
    map.on("movestart", handleMapMovement);

    if (!hasInitialFitRef.current) {
      const fittingCoordinates = routeCoordinates.length > 1 ? routeCoordinates : [
        ...routeEndpoints.map((endpoint) => [endpoint.longitude, endpoint.latitude]),
        ...mappablePoints.map((point) => [point.longitude, point.latitude]),
      ];

      if (fittingCoordinates.length === 1) {
        map.flyTo({ center: fittingCoordinates[0], zoom: Math.max(map.getZoom(), 14) });
        hasInitialFitRef.current = true;
      } else if (fittingCoordinates.length > 1) {
        map.fitBounds(boundsForCoordinates(fittingCoordinates), { padding: 52, maxZoom: 14 });
        hasInitialFitRef.current = true;
      }
    }

    return () => {
      map.off("click", clustersLayerId, handleClusterClick);
      map.off("click", pinTouchTargetLayerId, handlePinClick);
      map.off("click", pinsLayerId, handlePinClick);
      map.off("contextmenu", handleContextMenu);
      map.off("mouseenter", clustersLayerId, handleClusterEnter);
      map.off("mouseleave", clustersLayerId, handleClusterLeave);
      map.off("mouseenter", pinTouchTargetLayerId, handleClusterEnter);
      map.off("mouseleave", pinTouchTargetLayerId, handleClusterLeave);
      map.off("mouseenter", pinsLayerId, showPopup);
      map.off("mouseleave", pinsLayerId, hidePopup);
      map.off("mouseenter", endpointPinsLayerId, showPopup);
      map.off("mouseleave", endpointPinsLayerId, hidePopup);
      map.off("dragstart", handleMapMovement);
      map.off("movestart", handleMapMovement);
      popupRef.current?.remove();
    };
  }, [mapReady, mappablePoints, onSelectPoint, roadRouteCoordinates, routeEndpoints, routePathPoints, selectedPoints.length, showRouteLine]);

  useEffect(() => {
    return () => {
      popupRef.current?.remove();
      mapRef.current?.remove();
    };
  }, []);

  const showTitleBadge = title.trim().length > 0 && title !== "Live planning map";
  const contextPoint = contextMenu?.pointId ? mappablePoints.find((point) => point.id === contextMenu.pointId) : null;

  return (
    <div className="bpd-tomtom-map" style={{ display: "grid", gap: 10, overscrollBehavior: "contain" }}>
      <style>{styles()}</style>
      <div
        style={{
          position: "relative",
          height,
          overflow: "hidden",
          borderRadius: 16,
          border: "1px solid #d0d5dd",
          background: "#d6ecff",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.4)",
          overscrollBehavior: "contain",
          touchAction: "none",
        }}
      >
        {activeApiKey ? <div ref={mapElementRef} style={{ height: "100%", width: "100%" }} /> : null}

        <div style={{ position: "absolute", inset: 14, pointerEvents: "none", zIndex: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            {showTitleBadge ? <span style={{ background: "rgba(255,255,255,0.94)", padding: "7px 10px", borderRadius: 999, fontWeight: 800, fontSize: 13, color: "#323841", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>{title}</span> : <span />}
            {badge ? <span style={{ background: "rgba(255,255,255,0.94)", padding: "7px 10px", borderRadius: 999, fontWeight: 800, fontSize: 13, color: "#509AE6", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>{badge}</span> : null}
          </div>
        </div>

        {contextMenu ? (
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #d0d5dd",
              borderRadius: 8,
              boxShadow: "0 12px 28px rgba(15,23,42,0.22)",
              display: "grid",
              gap: 4,
              left: Math.min(contextMenu.x, Math.max(0, (mapElementRef.current?.clientWidth || 260) - 190)),
              minWidth: 180,
              padding: 6,
              position: "absolute",
              top: Math.min(contextMenu.y, Math.max(0, height - 150)),
              zIndex: 8,
            }}
          >
            {contextPoint ? (
              <>
                <button type="button" onClick={() => handlePointContextAction("setFirstDrop")} style={{ background: "transparent", border: 0, borderRadius: 6, color: "#323841", cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 700, padding: "8px 10px", textAlign: "left" }}>Set first drop</button>
                <button type="button" onClick={() => handlePointContextAction("setLastDrop")} style={{ background: "transparent", border: 0, borderRadius: 6, color: "#323841", cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 700, padding: "8px 10px", textAlign: "left" }}>Set last drop</button>
                <button type="button" onClick={() => handlePointContextAction("clearFixedPosition")} style={{ background: "transparent", border: 0, borderRadius: 6, color: "#323841", cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 700, padding: "8px 10px", textAlign: "left" }}>Remove fixed position</button>
              </>
            ) : (
              <>
                <button type="button" disabled={contextMenuLoading} onClick={() => handleMapContextAction("setStart")} style={{ background: "transparent", border: 0, borderRadius: 6, color: "#323841", cursor: contextMenuLoading ? "wait" : "pointer", font: "inherit", fontSize: 13, fontWeight: 700, padding: "8px 10px", textAlign: "left" }}>Set route start</button>
                <button type="button" disabled={contextMenuLoading} onClick={() => handleMapContextAction("setFinish")} style={{ background: "transparent", border: 0, borderRadius: 6, color: "#323841", cursor: contextMenuLoading ? "wait" : "pointer", font: "inherit", fontSize: 13, fontWeight: 700, padding: "8px 10px", textAlign: "left" }}>Set route finish</button>
              </>
            )}
          </div>
        ) : null}

        {!activeApiKey ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24, textAlign: "center", color: "#323841" }}>
            <div style={{ background: "rgba(255,255,255,0.95)", borderRadius: 14, padding: 18, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
              <strong>TomTom map key needed</strong>
              <p style={{ margin: "8px 0 0" }}>Add TOMTOM_API_KEY in Railway to load the live map.</p>
            </div>
          </div>
        ) : null}
      </div>

      {mappablePoints.length === 0 ? (
        <p style={{ margin: 0, color: "#667085", fontSize: 14 }}>No usable coordinates yet. Check the address lookup for these stops.</p>
      ) : null}
    </div>
  );
}

export type { RouteMapPoint, RouteEndpoint, MapContextAction, MapContextLocation, PointContextAction };
