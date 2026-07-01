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

type RouteMapProps = {
  points: RouteMapPoint[];
  height?: number;
  title?: string;
  badge?: string;
  showRouteLine?: boolean;
  onSelectPoint?: (point: RouteMapPoint) => void;
  apiKey?: string | null;
  routeStart?: RouteEndpoint | null;
  routeFinish?: RouteEndpoint | null;
};

type MappablePoint = RouteMapPoint & { latitude: number; longitude: number };
type MappableEndpoint = RouteEndpoint & { id: string; latitude: number; longitude: number };
type RouteCoordinatePoint = { latitude: number; longitude: number };
type TomTomMapRef = any;
type TomTomPopupRef = any;

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

function tooltipHtml(point: RouteMapPoint) {
  const lines = tooltipLinesForPoint(point);
  const heading = point.tooltipTitle || lines[0] || point.title || point.label;
  const bodyLines = point.tooltipTitle ? lines : lines.slice(1);

  return [heading, ...bodyLines]
    .filter(Boolean)
    .map((line, index) => `<div class="${index === 0 ? "bpd-tooltip-heading" : "bpd-tooltip-line"}">${escapeHtml(line)}</div>`)
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
    .bpd-tomtom-popup .mapboxgl-popup-content { background: rgba(255,255,255,0.98); color: #323841; border: 1px solid #d0d5dd; border-radius: 14px; padding: 10px 12px; box-shadow: 0 10px 24px rgba(0,0,0,0.22); min-width: 210px; }
    .bpd-tomtom-popup .mapboxgl-popup-tip { display: none; }
    .bpd-tooltip-heading { font-size: 13px; font-weight: 800; line-height: 1.35; }
    .bpd-tooltip-line { margin-top: 3px; font-size: 12px; font-weight: 500; line-height: 1.35; color: #475467; }
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
  apiKey,
  routeStart,
  routeFinish,
}: RouteMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<TomTomMapRef | null>(null);
  const popupRef = useRef<TomTomPopupRef | null>(null);
  const touchHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const touchHoldShownRef = useRef(false);
  const ignoreNextPinClickRef = useRef(false);
  const lastTouchTimeRef = useRef(0);
  const hasInitialFitRef = useRef(false);
  const sourceIdRef = useRef(`orders-${Math.random().toString(36).slice(2)}`);
  const routeSourceIdRef = useRef(`route-${Math.random().toString(36).slice(2)}`);
  const endpointSourceIdRef = useRef(`route-endpoints-${Math.random().toString(36).slice(2)}`);
  const clustersLayerIdRef = useRef(`clusters-${Math.random().toString(36).slice(2)}`);
  const clusterCountLayerIdRef = useRef(`cluster-count-${Math.random().toString(36).slice(2)}`);
  const pinsLayerIdRef = useRef(`pins-${Math.random().toString(36).slice(2)}`);
  const pinLabelLayerIdRef = useRef(`pin-labels-${Math.random().toString(36).slice(2)}`);
  const routeLayerIdRef = useRef(`route-layer-${Math.random().toString(36).slice(2)}`);
  const endpointPinsLayerIdRef = useRef(`route-endpoint-pins-${Math.random().toString(36).slice(2)}`);
  const endpointLabelLayerIdRef = useRef(`route-endpoint-labels-${Math.random().toString(36).slice(2)}`);
  const [loadedApiKey, setLoadedApiKey] = useState(apiKey || "");
  const [mapReady, setMapReady] = useState(false);
  const [roadRouteCoordinates, setRoadRouteCoordinates] = useState<number[][]>([]);
  const [resolvedStart, setResolvedStart] = useState<MappableEndpoint | null>(null);
  const [resolvedFinish, setResolvedFinish] = useState<MappableEndpoint | null>(null);
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
      id: pinsLayerId,
      type: "circle",
      source: sourceId,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["get", "colour"],
        "circle-radius": 18,
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
        "text-size": 11,
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

    const clearTouchHold = () => {
      if (touchHoldTimerRef.current) {
        clearTimeout(touchHoldTimerRef.current);
        touchHoldTimerRef.current = null;
      }

      touchStartPointRef.current = null;
    };

    const hidePopup = (force = false) => {
      map.getCanvas().style.cursor = "";
      popupRef.current?.remove();
    };

    const finishLongPress = () => {
      const wasLongPress = touchHoldShownRef.current;
      clearTouchHold();
      touchHoldShownRef.current = false;
      hidePopup();

      if (wasLongPress) {
        ignoreNextPinClickRef.current = true;
        window.setTimeout(() => {
          ignoreNextPinClickRef.current = false;
        }, 450);
      }
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
      if (ignoreNextPinClickRef.current) {
        ignoreNextPinClickRef.current = false;
        return;
      }

      const feature = event.features?.[0];
      const id = feature?.properties?.id;
      const point = mappablePoints.find((mapPoint) => mapPoint.id === id);

      if (point) {
        onSelectPoint?.(point);
      }
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

    const showPopup = async (event: any) => {
      map.getCanvas().style.cursor = "pointer";
      await showPopupForFeature(event.features?.[0]);
    };

    const handlePinTouchStart = (event: any) => {
      const feature = event.features?.[0];

      if (!feature) {
        return;
      }

      clearTouchHold();
      touchHoldShownRef.current = false;
      touchStartPointRef.current = event.point ? { x: event.point.x, y: event.point.y } : null;
      touchHoldTimerRef.current = setTimeout(() => {
        touchHoldShownRef.current = true;
        ignoreNextPinClickRef.current = true;
        map.getCanvas().style.cursor = "pointer";
        void showPopupForFeature(feature);
      }, 520);
    };

    const handlePinTouchMove = (event: any) => {
      if (!touchStartPointRef.current || !event.point) {
        return;
      }

      const movedX = Math.abs(event.point.x - touchStartPointRef.current.x);
      const movedY = Math.abs(event.point.y - touchStartPointRef.current.y);

      if (movedX > 12 || movedY > 12) {
  clearTouchHold();
}
    };

    const handlePinTouchEnd = () => {
      finishLongPress();
    };

    const handleBrowserTouchMove = (_event: TouchEvent) => {
  // Let TomTom handle the map drag while the order card is open.
    };

    const handleBrowserTouchEnd = (event: TouchEvent) => {
      if (touchHoldShownRef.current && event.cancelable) {
        event.preventDefault();
      }

      finishLongPress();
    };

    const handleMapMovement = () => {
      clearTouchHold();
      touchHoldShownRef.current = false;
      hidePopup();
    };

    const handleClusterEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };

    const handleClusterLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    const mapElement = mapElementRef.current;

    map.on("click", clustersLayerId, handleClusterClick);
    map.on("click", pinsLayerId, handlePinClick);
    map.on("mouseenter", clustersLayerId, handleClusterEnter);
    map.on("mouseleave", clustersLayerId, handleClusterLeave);
    map.on("mouseenter", pinsLayerId, showPopup);
    map.on("mouseleave", pinsLayerId, hidePopup);
    map.on("mouseenter", endpointPinsLayerId, showPopup);
    map.on("mouseleave", endpointPinsLayerId, hidePopup);
    map.on("touchstart", pinsLayerId, handlePinTouchStart);
    map.on("touchmove", handlePinTouchMove);
    map.on("touchend", handlePinTouchEnd);
    map.on("touchcancel", handlePinTouchEnd);
    map.on("dragstart", handleMapMovement);
    map.on("movestart", handleMapMovement);
    mapElement?.addEventListener("touchmove", handleBrowserTouchMove, { passive: false });
    mapElement?.addEventListener("touchend", handleBrowserTouchEnd, { passive: false });
    mapElement?.addEventListener("touchcancel", handleBrowserTouchEnd, { passive: false });

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
      clearTouchHold();
      map.off("click", clustersLayerId, handleClusterClick);
      map.off("click", pinsLayerId, handlePinClick);
      map.off("mouseenter", clustersLayerId, handleClusterEnter);
      map.off("mouseleave", clustersLayerId, handleClusterLeave);
      map.off("mouseenter", pinsLayerId, showPopup);
      map.off("mouseleave", pinsLayerId, hidePopup);
      map.off("mouseenter", endpointPinsLayerId, showPopup);
      map.off("mouseleave", endpointPinsLayerId, hidePopup);
      map.off("touchstart", pinsLayerId, handlePinTouchStart);
      map.off("touchmove", handlePinTouchMove);
      map.off("touchend", handlePinTouchEnd);
      map.off("touchcancel", handlePinTouchEnd);
      map.off("dragstart", handleMapMovement);
      map.off("movestart", handleMapMovement);
      mapElement?.removeEventListener("touchmove", handleBrowserTouchMove);
      mapElement?.removeEventListener("touchend", handleBrowserTouchEnd);
      mapElement?.removeEventListener("touchcancel", handleBrowserTouchEnd);
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

export type { RouteMapPoint, RouteEndpoint };
