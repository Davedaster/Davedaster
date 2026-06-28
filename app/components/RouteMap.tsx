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

type RouteMapProps = {
  points: RouteMapPoint[];
  height?: number;
  title?: string;
  badge?: string;
  showRouteLine?: boolean;
  onSelectPoint?: (point: RouteMapPoint) => void;
  apiKey?: string | null;
};

type TomTomMapRef = any;
type TomTomPopupRef = any;

const DEFAULT_CENTER: [number, number] = [-3.6119, 50.5293];

function normalisedPoints(points: RouteMapPoint[]) {
  return points.filter((point): point is RouteMapPoint & { latitude: number; longitude: number } => (
    typeof point.latitude === "number" &&
    typeof point.longitude === "number" &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude)
  ));
}

function cleanPinLabel(point: RouteMapPoint, fallback: number) {
  return point.label.trim().replace("#", "") || String(fallback);
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
  if (point.status === "DELIVERED" || point.status === "COLLECTED") return "#16a34a";
  if (point.status === "FAILED") return "#b42318";
  return point.selected ? "#323841" : "#509AE6";
}

function styles() {
  return `
    .bpd-tomtom-map .mapboxgl-map { font-family: inherit; }
    .bpd-tomtom-map .mapboxgl-ctrl-group button { width: 36px; height: 36px; }
    .bpd-tomtom-map .mapboxgl-canvas { outline: none; }
    .bpd-tomtom-popup .mapboxgl-popup-content { background: rgba(255,255,255,0.98); color: #323841; border: 1px solid #d0d5dd; border-radius: 14px; padding: 10px 12px; box-shadow: 0 10px 24px rgba(0,0,0,0.22); min-width: 210px; }
    .bpd-tomtom-popup .mapboxgl-popup-tip { display: none; }
    .bpd-tooltip-heading { font-size: 13px; font-weight: 800; line-height: 1.35; }
    .bpd-tooltip-line { margin-top: 3px; font-size: 12px; font-weight: 500; line-height: 1.35; color: #475467; }
  `;
}

function buildFeatureCollection(points: Array<RouteMapPoint & { latitude: number; longitude: number }>) {
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

function boundsFromCoordinates(coordinates: number[][]) {
  const longitudes = coordinates.map((coordinate) => coordinate[0]);
  const latitudes = coordinates.map((coordinate) => coordinate[1]);

  return [
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ];
}

export function RouteMap({
  points,
  height = 520,
  title = "Route map",
  badge,
  showRouteLine = true,
  onSelectPoint,
  apiKey,
}: RouteMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<TomTomMapRef | null>(null);
  const popupRef = useRef<TomTomPopupRef | null>(null);
  const sourceIdRef = useRef(`orders-${Math.random().toString(36).slice(2)}`);
  const routeSourceIdRef = useRef(`route-${Math.random().toString(36).slice(2)}`);
  const clustersLayerIdRef = useRef(`clusters-${Math.random().toString(36).slice(2)}`);
  const clusterCountLayerIdRef = useRef(`cluster-count-${Math.random().toString(36).slice(2)}`);
  const pinsLayerIdRef = useRef(`pins-${Math.random().toString(36).slice(2)}`);
  const pinLabelLayerIdRef = useRef(`pin-labels-${Math.random().toString(36).slice(2)}`);
  const routeLayerIdRef = useRef(`route-layer-${Math.random().toString(36).slice(2)}`);
  const [loadedApiKey, setLoadedApiKey] = useState(apiKey || "");
  const [mapReady, setMapReady] = useState(false);
  const mappablePoints = useMemo(() => normalisedPoints(points), [points]);
  const activeApiKey = apiKey || loadedApiKey;

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
        if (!cancelled) setLoadedApiKey(data.apiKey || "");
      } catch {
        if (!cancelled) setLoadedApiKey("");
      }
    }

    loadKey();
    return () => { cancelled = true; };
  }, [apiKey]);

  useEffect(() => {
    let cancelled = false;

    async function setupMap() {
      if (!mapElementRef.current || mapRef.current || !activeApiKey) return;
      const tt = await import("@tomtom-international/web-sdk-maps");
      if (cancelled || !mapElementRef.current) return;

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
        if (!cancelled) setMapReady(true);
      });
      mapRef.current = map;
    }

    setupMap();
    return () => { cancelled = true; };
  }, [activeApiKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const sourceId = sourceIdRef.current;
    const routeSourceId = routeSourceIdRef.current;
    const clustersLayerId = clustersLayerIdRef.current;
    const clusterCountLayerId = clusterCountLayerIdRef.current;
    const pinsLayerId = pinsLayerIdRef.current;
    const pinLabelLayerId = pinLabelLayerIdRef.current;
    const routeLayerId = routeLayerIdRef.current;
    const featureCollection = buildFeatureCollection(mappablePoints);
    const routeCoordinates = mappablePoints.map((point) => [point.longitude, point.latitude]);

    const removeLayer = (layerId: string) => { if (map.getLayer(layerId)) map.removeLayer(layerId); };
    const removeSource = (id: string) => { if (map.getSource(id)) map.removeSource(id); };

    removeLayer(clusterCountLayerId);
    removeLayer(clustersLayerId);
    removeLayer(pinLabelLayerId);
    removeLayer(pinsLayerId);
    removeLayer(routeLayerId);
    removeSource(sourceId);
    removeSource(routeSourceId);
    popupRef.current?.remove();

    map.addSource(sourceId, {
      type: "geojson",
      data: featureCollection,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    });

    if (showRouteLine && routeCoordinates.length > 1) {
      map.addSource(routeSourceId, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: routeCoordinates },
        },
      });
      map.addLayer({
        id: routeLayerId,
        type: "line",
        source: routeSourceId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#509AE6", "line-width": 4, "line-opacity": 0.85 },
      });
    }

    map.addLayer({
      id: clustersLayerId,
      type: "circle",
      source: sourceId,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#509AE6", 5, "#f97316", 13, "#b42318"],
        "circle-radius": ["step", ["get", "point_count"], 22, 5, 27, 13, 32],
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
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 14 },
      paint: { "text-color": "#ffffff" },
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
      layout: { "text-field": ["get", "label"], "text-size": 11, "text-allow-overlap": true },
      paint: { "text-color": "#ffffff" },
    });

    const setPointer = () => { map.getCanvas().style.cursor = "pointer"; };
    const clearPointer = () => { map.getCanvas().style.cursor = ""; };

    const handleClusterClick = (event: any) => {
      const features = map.queryRenderedFeatures(event.point, { layers: [clustersLayerId] });
      const cluster = features[0];
      const clusterId = cluster?.properties?.cluster_id;
      const source = map.getSource(sourceId);
      if (!cluster || !source || typeof clusterId === "undefined") return;

      source.getClusterExpansionZoom(clusterId, (error: Error | null, zoom: number) => {
        if (!error) map.easeTo({ center: cluster.geometry.coordinates, zoom });
      });
    };

    const handlePinClick = (event: any) => {
      const feature = event.features?.[0];
      const id = feature?.properties?.id;
      const point = mappablePoints.find((mapPoint) => mapPoint.id === id);
      if (point) onSelectPoint?.(point);
    };

    const handlePinEnter = async (event: any) => {
      setPointer();
      const feature = event.features?.[0];
      if (!feature) return;
      const tt = await import("@tomtom-international/web-sdk-maps");
      popupRef.current?.remove();
      popupRef.current = new tt.Popup({ closeButton: false, closeOnClick: false, className: "bpd-tomtom-popup", offset: 18 })
        .setLngLat(feature.geometry.coordinates)
        .setHTML(feature.properties.tooltip || "")
        .addTo(map);
    };

    const handlePinLeave = () => {
      clearPointer();
      popupRef.current?.remove();
    };

    map.on("click", clustersLayerId, handleClusterClick);
    map.on("click", pinsLayerId, handlePinClick);
    map.on("mouseenter", clustersLayerId, setPointer);
    map.on("mouseleave", clustersLayerId, clearPointer);
    map.on("mouseenter", pinsLayerId, handlePinEnter);
    map.on("mouseleave", pinsLayerId, handlePinLeave);

    if (routeCoordinates.length === 1) {
      map.flyTo({ center: routeCoordinates[0], zoom: Math.max(map.getZoom(), 14) });
    } else if (routeCoordinates.length > 1) {
      map.fitBounds(boundsFromCoordinates(routeCoordinates), { padding: 52, maxZoom: 14 });
    }

    return () => {
      map.off("click", clustersLayerId, handleClusterClick);
      map.off("click", pinsLayerId, handlePinClick);
      map.off("mouseenter", clustersLayerId, setPointer);
      map.off("mouseleave", clustersLayerId, clearPointer);
      map.off("mouseenter", pinsLayerId, handlePinEnter);
      map.off("mouseleave", pinsLayerId, handlePinLeave);
      popupRef.current?.remove();
    };
  }, [mapReady, mappablePoints, onSelectPoint, showRouteLine]);

  useEffect(() => {
    return () => {
      popupRef.current?.remove();
      mapRef.current?.remove();
    };
  }, []);

  return (
    <div className="bpd-tomtom-map" style={{ display: "grid", gap: 10 }}>
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
        }}
      >
        {activeApiKey ? <div ref={mapElementRef} style={{ height: "100%", width: "100%" }} /> : null}

        <div style={{ position: "absolute", inset: 14, pointerEvents: "none", zIndex: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            <span style={{ background: "rgba(255,255,255,0.94)", padding: "7px 10px", borderRadius: 999, fontWeight: 800, fontSize: 13, color: "#323841", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>{title}</span>
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

export type { RouteMapPoint };
