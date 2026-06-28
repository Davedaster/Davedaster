import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as TomTomMap, Marker as TomTomMarker, Popup as TomTomPopup } from "@tomtom-international/web-sdk-maps";

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

function styles() {
  return `
    .bpd-tomtom-map .mapboxgl-map { font-family: inherit; }
    .bpd-tomtom-map .mapboxgl-ctrl-group button { width: 36px; height: 36px; }
    .bpd-tomtom-pin { display: grid; place-items: center; color: #fff; width: 46px; height: 46px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 3px solid #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.24); font-size: 11px; font-weight: 800; line-height: 1; cursor: pointer; }
    .bpd-tomtom-pin span { transform: rotate(45deg); max-width: 34px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bpd-tomtom-popup .mapboxgl-popup-content { background: rgba(255,255,255,0.98); color: #323841; border: 1px solid #d0d5dd; border-radius: 14px; padding: 10px 12px; box-shadow: 0 10px 24px rgba(0,0,0,0.22); min-width: 210px; }
    .bpd-tomtom-popup .mapboxgl-popup-tip { display: none; }
    .bpd-tooltip-heading { font-size: 13px; font-weight: 800; line-height: 1.35; }
    .bpd-tooltip-line { margin-top: 3px; font-size: 12px; font-weight: 500; line-height: 1.35; color: #475467; }
  `;
}

function makeMarkerElement(point: RouteMapPoint, label: string) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "bpd-tomtom-pin";
  element.style.background = markerColour(point);
  element.innerHTML = `<span>${escapeHtml(label)}</span>`;

  return element;
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
  const mapRef = useRef<TomTomMap | null>(null);
  const markersRef = useRef<TomTomMarker[]>([]);
  const popupsRef = useRef<TomTomPopup[]>([]);
  const routeSourceIdRef = useRef(`route-${Math.random().toString(36).slice(2)}`);
  const routeLayerIdRef = useRef(`route-layer-${Math.random().toString(36).slice(2)}`);
  const [loadedApiKey, setLoadedApiKey] = useState(apiKey || "");
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
      mapRef.current = map;
    }

    setupMap();

    return () => {
      cancelled = true;
    };
  }, [activeApiKey]);

  useEffect(() => {
    let cancelled = false;

    async function renderPoints() {
      const map = mapRef.current;

      if (!map || !activeApiKey) {
        return;
      }

      const tt = await import("@tomtom-international/web-sdk-maps");

      if (cancelled) {
        return;
      }

      markersRef.current.forEach((marker) => marker.remove());
      popupsRef.current.forEach((popup) => popup.remove());
      markersRef.current = [];
      popupsRef.current = [];

      const sourceId = routeSourceIdRef.current;
      const layerId = routeLayerIdRef.current;
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }
      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }

      const coordinates = mappablePoints.map((point) => [point.longitude, point.latitude] as [number, number]);

      mappablePoints.forEach((point, index) => {
        const label = cleanPinLabel(point, index + 1);
        const element = makeMarkerElement(point, label);
        const popup = new tt.Popup({ closeButton: false, closeOnClick: false, className: "bpd-tomtom-popup", offset: 38 }).setHTML(tooltipHtml(point));
        const marker = new tt.Marker({ element, anchor: "bottom" })
          .setLngLat([point.longitude, point.latitude])
          .addTo(map);

        element.addEventListener("mouseenter", () => popup.setLngLat([point.longitude, point.latitude]).addTo(map));
        element.addEventListener("mouseleave", () => popup.remove());
        element.addEventListener("focus", () => popup.setLngLat([point.longitude, point.latitude]).addTo(map));
        element.addEventListener("blur", () => popup.remove());
        element.addEventListener("click", () => onSelectPoint?.(point));

        markersRef.current.push(marker);
        popupsRef.current.push(popup);
      });

      if (showRouteLine && coordinates.length > 1) {
        map.addSource(sourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates,
            },
          },
        });
        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-color": "#509AE6",
            "line-width": 4,
            "line-opacity": 0.9,
          },
        });
      }

      if (coordinates.length === 1) {
        map.flyTo({ center: coordinates[0], zoom: Math.max(map.getZoom(), 14) });
      } else if (coordinates.length > 1) {
        const bounds = coordinates.reduce((lngLatBounds, coordinate) => lngLatBounds.extend(coordinate), new tt.LngLatBounds(coordinates[0], coordinates[0]));
        map.fitBounds(bounds, { padding: 52, maxZoom: 14 });
      }
    }

    if (mapRef.current?.loaded()) {
      renderPoints();
    } else {
      mapRef.current?.once("load", renderPoints);
    }

    return () => {
      cancelled = true;
    };
  }, [activeApiKey, mappablePoints, onSelectPoint, showRouteLine]);

  useEffect(() => {
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      popupsRef.current.forEach((popup) => popup.remove());
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
