import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker, Polyline as LeafletPolyline } from "leaflet";

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
};

const DEFAULT_CENTER: [number, number] = [50.5293, -3.6119];

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
    .bpd-leaflet-map .leaflet-container { height: 100%; width: 100%; font-family: inherit; }
    .bpd-leaflet-map .leaflet-control-zoom a { color: #323841; font-weight: 800; }
    .bpd-leaflet-pin { display: grid; place-items: center; color: #fff; width: 46px; height: 46px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); border: 3px solid #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.24); font-size: 11px; font-weight: 800; line-height: 1; }
    .bpd-leaflet-pin span { transform: rotate(45deg); max-width: 34px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bpd-leaflet-tooltip { background: rgba(255,255,255,0.98); color: #323841; border: 1px solid #d0d5dd; border-radius: 14px; padding: 10px 12px; box-shadow: 0 10px 24px rgba(0,0,0,0.22); min-width: 210px; }
    .bpd-leaflet-tooltip::before { display: none; }
    .bpd-tooltip-heading { font-size: 13px; font-weight: 800; line-height: 1.35; }
    .bpd-tooltip-line { margin-top: 3px; font-size: 12px; font-weight: 500; line-height: 1.35; color: #475467; }
  `;
}

export function RouteMap({
  points,
  height = 520,
  title = "Route map",
  badge,
  showRouteLine = true,
  onSelectPoint,
}: RouteMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LeafletMarker[]>([]);
  const lineRef = useRef<LeafletPolyline | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const mappablePoints = useMemo(() => normalisedPoints(points), [points]);

  useEffect(() => {
    let cancelled = false;

    async function setupMap() {
      if (!mapElementRef.current || mapRef.current) {
        return;
      }

      const leaflet = await import("leaflet");

      if (cancelled || !mapElementRef.current) {
        return;
      }

      const map = leaflet.map(mapElementRef.current, {
        center: DEFAULT_CENTER,
        zoom: 10,
        zoomControl: true,
        scrollWheelZoom: true,
        dragging: true,
        tap: true,
      });

      leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);

      mapRef.current = map;
      setMapReady(true);
    }

    setupMap();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function renderPoints() {
      const map = mapRef.current;

      if (!map || !mapReady) {
        return;
      }

      const leaflet = await import("leaflet");

      if (cancelled) {
        return;
      }

      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      lineRef.current?.remove();
      lineRef.current = null;

      const markerPositions: [number, number][] = [];

      mappablePoints.forEach((point, index) => {
        const position: [number, number] = [point.latitude, point.longitude];
        const label = cleanPinLabel(point, index + 1);
        const icon = leaflet.divIcon({
          className: "",
          html: `<div class="bpd-leaflet-pin" style="background:${markerColour(point)}"><span>${escapeHtml(label)}</span></div>`,
          iconSize: [46, 46],
          iconAnchor: [23, 46],
        });
        const marker = leaflet.marker(position, { icon }).addTo(map);

        marker.bindTooltip(tooltipHtml(point), {
          className: "bpd-leaflet-tooltip",
          direction: "top",
          offset: [0, -42],
          opacity: 1,
          sticky: true,
        });

        marker.on("click", () => onSelectPoint?.(point));
        markersRef.current.push(marker);
        markerPositions.push(position);
      });

      if (showRouteLine && markerPositions.length > 1) {
        lineRef.current = leaflet.polyline(markerPositions, {
          color: "#509AE6",
          weight: 4,
          opacity: 0.9,
          dashArray: "10 8",
        }).addTo(map);
      }

      if (markerPositions.length === 1) {
        map.setView(markerPositions[0], Math.max(map.getZoom(), 14), { animate: true });
      } else if (markerPositions.length > 1) {
        map.fitBounds(leaflet.latLngBounds(markerPositions), { padding: [42, 42], maxZoom: 14, animate: true });
      }
    }

    renderPoints();

    return () => {
      cancelled = true;
    };
  }, [mapReady, mappablePoints, onSelectPoint, showRouteLine]);

  useEffect(() => {
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      lineRef.current?.remove();
      mapRef.current?.remove();
    };
  }, []);

  return (
    <div className="bpd-leaflet-map" style={{ display: "grid", gap: 10 }}>
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
        <div ref={mapElementRef} style={{ height: "100%", width: "100%" }} />

        <div style={{ position: "absolute", inset: 14, pointerEvents: "none", zIndex: 500 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            <span style={{ background: "rgba(255,255,255,0.94)", padding: "7px 10px", borderRadius: 999, fontWeight: 800, fontSize: 13, color: "#323841", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>{title}</span>
            {badge ? <span style={{ background: "rgba(255,255,255,0.94)", padding: "7px 10px", borderRadius: 999, fontWeight: 800, fontSize: 13, color: "#509AE6", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>{badge}</span> : null}
          </div>
        </div>
      </div>

      {mappablePoints.length === 0 ? (
        <p style={{ margin: 0, color: "#667085", fontSize: 14 }}>No usable coordinates yet. Check the address lookup for these stops.</p>
      ) : null}
    </div>
  );
}

export type { RouteMapPoint };
