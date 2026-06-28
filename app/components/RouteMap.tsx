import { useState } from "react";

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

type DragState = {
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
  hasMoved: boolean;
} | null;

const TILE_SIZE = 256;
const MAP_WIDTH = 1024;
const MIN_ZOOM = 5;
const MAX_ZOOM = 18;
const DEFAULT_CENTER = {
  latitude: 50.5293,
  longitude: -3.6119,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function wrapTileX(x: number, zoom: number) {
  const max = 2 ** zoom;
  return ((x % max) + max) % max;
}

function project(latitude: number, longitude: number, zoom: number) {
  const sinLatitude = Math.sin((clamp(latitude, -85.05112878, 85.05112878) * Math.PI) / 180);
  const scale = TILE_SIZE * 2 ** zoom;

  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * scale,
  };
}

function chooseZoom(points: Array<{ latitude: number; longitude: number }>) {
  if (points.length <= 1) {
    return 15;
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const latSpan = Math.max(...latitudes) - Math.min(...latitudes);
  const lngSpan = Math.max(...longitudes) - Math.min(...longitudes);
  const span = Math.max(latSpan, lngSpan);

  if (span < 0.04) return 15;
  if (span < 0.08) return 14;
  if (span < 0.15) return 13;
  if (span < 0.35) return 12;
  if (span < 0.8) return 11;
  if (span < 1.6) return 10;
  if (span < 3.2) return 9;
  return 8;
}

function normalisedPoints(points: RouteMapPoint[]) {
  return points.filter((point): point is RouteMapPoint & { latitude: number; longitude: number } => (
    typeof point.latitude === "number" &&
    typeof point.longitude === "number" &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude)
  ));
}

function cleanPinLabel(label: string, fallback: number) {
  const cleaned = label.trim().replace(/^#/, "");

  return cleaned || String(fallback);
}

function tooltipLinesForPoint(point: RouteMapPoint) {
  if (point.tooltipLines?.length) {
    return point.tooltipLines.filter(Boolean);
  }

  if (!point.title) {
    return [];
  }

  return point.title
    .split("·")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function RouteMap({
  points,
  height = 520,
  title = "Route map",
  badge,
  showRouteLine = true,
  onSelectPoint,
}: RouteMapProps) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoomOffset, setZoomOffset] = useState(0);
  const [dragState, setDragState] = useState<DragState>(null);
  const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
  const mappablePoints = normalisedPoints(points);
  const baseZoom = chooseZoom(mappablePoints);
  const zoom = clamp(baseZoom + zoomOffset, MIN_ZOOM, MAX_ZOOM);
  const canZoomIn = zoom < MAX_ZOOM;
  const canZoomOut = zoom > MIN_ZOOM;
  const centerLatitude = mappablePoints.length
    ? mappablePoints.reduce((total, point) => total + point.latitude, 0) / mappablePoints.length
    : DEFAULT_CENTER.latitude;
  const centerLongitude = mappablePoints.length
    ? mappablePoints.reduce((total, point) => total + point.longitude, 0) / mappablePoints.length
    : DEFAULT_CENTER.longitude;
  const center = project(centerLatitude, centerLongitude, zoom);
  const topLeft = {
    x: center.x - MAP_WIDTH / 2 - pan.x,
    y: center.y - height / 2 - pan.y,
  };
  const firstTileX = Math.floor(topLeft.x / TILE_SIZE);
  const lastTileX = Math.floor((topLeft.x + MAP_WIDTH) / TILE_SIZE);
  const firstTileY = clamp(Math.floor(topLeft.y / TILE_SIZE), 0, 2 ** zoom - 1);
  const lastTileY = clamp(Math.floor((topLeft.y + height) / TILE_SIZE), 0, 2 ** zoom - 1);
  const tiles: Array<{ x: number; y: number; left: number; top: number; src: string }> = [];

  for (let x = firstTileX; x <= lastTileX; x += 1) {
    for (let y = firstTileY; y <= lastTileY; y += 1) {
      const wrappedX = wrapTileX(x, zoom);
      tiles.push({
        x,
        y,
        left: x * TILE_SIZE - topLeft.x,
        top: y * TILE_SIZE - topLeft.y,
        src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
      });
    }
  }

  const positionedPoints = mappablePoints.map((point) => {
    const projected = project(point.latitude, point.longitude, zoom);

    return {
      ...point,
      left: projected.x - topLeft.x,
      top: projected.y - topLeft.y,
    };
  });

  const path = positionedPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.left.toFixed(1)} ${point.top.toFixed(1)}`)
    .join(" ");

  const changeZoom = (amount: number) => {
    setZoomOffset((currentOffset) => clamp(baseZoom + currentOffset + amount, MIN_ZOOM, MAX_ZOOM) - baseZoom);
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div
        onWheel={(event) => {
          event.preventDefault();
          changeZoom(event.deltaY < 0 ? 1 : -1);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }

          event.currentTarget.setPointerCapture(event.pointerId);
          setDragState({
            startX: event.clientX,
            startY: event.clientY,
            startPanX: pan.x,
            startPanY: pan.y,
            hasMoved: false,
          });
        }}
        onPointerMove={(event) => {
          if (!dragState) {
            return;
          }

          const nextX = dragState.startPanX + event.clientX - dragState.startX;
          const nextY = dragState.startPanY + event.clientY - dragState.startY;
          const hasMoved = dragState.hasMoved || Math.abs(event.clientX - dragState.startX) > 4 || Math.abs(event.clientY - dragState.startY) > 4;

          setPan({ x: nextX, y: nextY });
          setDragState({ ...dragState, hasMoved });
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }

          window.setTimeout(() => setDragState(null), 0);
        }}
        onPointerCancel={() => setDragState(null)}
        style={{
          position: "relative",
          height,
          overflow: "hidden",
          borderRadius: 16,
          border: "1px solid #d0d5dd",
          background: "#d6ecff",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.4)",
          cursor: dragState ? "grabbing" : "grab",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <div style={{ position: "absolute", inset: 0, left: "50%", width: MAP_WIDTH, transform: "translateX(-50%)" }}>
          {tiles.map((tile) => (
            <img
              key={`${tile.x}-${tile.y}`}
              src={tile.src}
              alt=""
              loading="lazy"
              width={TILE_SIZE}
              height={TILE_SIZE}
              draggable={false}
              style={{
                position: "absolute",
                left: tile.left,
                top: tile.top,
                width: TILE_SIZE,
                height: TILE_SIZE,
                userSelect: "none",
                pointerEvents: "none",
              }}
            />
          ))}

          {showRouteLine && positionedPoints.length > 1 ? (
            <svg width={MAP_WIDTH} height={height} viewBox={`0 0 ${MAP_WIDTH} ${height}`} style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }} aria-hidden="true">
              <path d={path} fill="none" stroke="#323841" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.25" />
              <path d={path} fill="none" stroke="#509AE6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="10 8" />
            </svg>
          ) : null}

          {positionedPoints.map((point, index) => {
            const delivered = point.status === "DELIVERED" || point.status === "COLLECTED";
            const failed = point.status === "FAILED";
            const background = delivered ? "#16a34a" : failed ? "#b42318" : point.selected ? "#323841" : "#509AE6";
            const pinLabel = cleanPinLabel(point.label, index + 1);
            const pinSize = point.selected ? 50 : 46;
            const tooltipLines = tooltipLinesForPoint(point);
            const tooltipHeading = point.tooltipTitle || tooltipLines[0] || point.title || pinLabel;
            const tooltipBody = point.tooltipTitle ? tooltipLines : tooltipLines.slice(1);
            const showTooltip = hoveredPointId === point.id;

            return (
              <button
                key={point.id}
                type="button"
                onMouseEnter={() => setHoveredPointId(point.id)}
                onMouseLeave={() => setHoveredPointId((currentId) => currentId === point.id ? null : currentId)}
                onFocus={() => setHoveredPointId(point.id)}
                onBlur={() => setHoveredPointId((currentId) => currentId === point.id ? null : currentId)}
                onClick={() => {
                  if (dragState?.hasMoved) {
                    return;
                  }

                  onSelectPoint?.(point);
                }}
                aria-label={point.title || point.label}
                title={point.title || point.label}
                style={{
                  position: "absolute",
                  left: point.left,
                  top: point.top,
                  transform: "translate(-50%, -100%)",
                  border: 0,
                  background: "transparent",
                  cursor: onSelectPoint ? "pointer" : "grab",
                  padding: 0,
                  zIndex: showTooltip ? 20 : point.selected ? 5 : 4,
                  touchAction: "none",
                }}
              >
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: pinSize,
                    height: pinSize,
                    borderRadius: "50% 50% 50% 0",
                    transform: "rotate(-45deg)",
                    background,
                    boxShadow: point.selected ? "0 0 0 5px rgba(80,154,230,0.24), 0 4px 12px rgba(0,0,0,0.24)" : "0 4px 12px rgba(0,0,0,0.24)",
                    border: "3px solid #ffffff",
                  }}
                >
                  <span
                    style={{
                      transform: "rotate(45deg)",
                      color: "#ffffff",
                      fontSize: pinLabel.length > 4 ? 10 : 11,
                      fontWeight: 800,
                      lineHeight: 1,
                      maxWidth: pinSize - 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {pinLabel}
                  </span>
                </span>

                {showTooltip ? (
                  <span
                    style={{
                      position: "absolute",
                      left: "50%",
                      bottom: pinSize + 10,
                      transform: "translateX(-50%)",
                      minWidth: 210,
                      maxWidth: 270,
                      background: "rgba(255,255,255,0.98)",
                      border: "1px solid #d0d5dd",
                      borderRadius: 14,
                      boxShadow: "0 12px 30px rgba(50,56,65,0.22)",
                      padding: "10px 12px",
                      color: "#323841",
                      textAlign: "left",
                      pointerEvents: "none",
                    }}
                  >
                    <span style={{ display: "block", fontSize: 13, fontWeight: 800, marginBottom: tooltipBody.length ? 6 : 0 }}>{tooltipHeading}</span>
                    {tooltipBody.map((line, lineIndex) => (
                      <span key={`${point.id}-tooltip-${lineIndex}`} style={{ display: "block", fontSize: 12, lineHeight: 1.35, color: "#475467", marginTop: lineIndex === 0 ? 0 : 3 }}>{line}</span>
                    ))}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div style={{ position: "absolute", inset: 14, pointerEvents: "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            <span style={{ background: "rgba(255,255,255,0.94)", padding: "7px 10px", borderRadius: 999, fontWeight: 800, fontSize: 13, color: "#323841", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>{title}</span>
            {badge ? <span style={{ background: "rgba(255,255,255,0.94)", padding: "7px 10px", borderRadius: 999, fontWeight: 800, fontSize: 13, color: "#509AE6", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>{badge}</span> : null}
          </div>
        </div>

        <div
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          style={{ position: "absolute", right: 12, top: 58, display: "grid", gap: 8, zIndex: 30 }}
        >
          <button
            type="button"
            disabled={!canZoomIn}
            onClick={() => changeZoom(1)}
            aria-label="Zoom in"
            style={{ width: 38, height: 38, border: "1px solid #d0d5dd", borderRadius: 12, background: "rgba(255,255,255,0.96)", color: "#323841", fontSize: 22, fontWeight: 800, boxShadow: "0 4px 12px rgba(0,0,0,0.14)", cursor: canZoomIn ? "pointer" : "not-allowed" }}
          >
            +
          </button>
          <button
            type="button"
            disabled={!canZoomOut}
            onClick={() => changeZoom(-1)}
            aria-label="Zoom out"
            style={{ width: 38, height: 38, border: "1px solid #d0d5dd", borderRadius: 12, background: "rgba(255,255,255,0.96)", color: "#323841", fontSize: 24, fontWeight: 800, lineHeight: 1, boxShadow: "0 4px 12px rgba(0,0,0,0.14)", cursor: canZoomOut ? "pointer" : "not-allowed" }}
          >
            −
          </button>
        </div>

        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          style={{ position: "absolute", right: 8, bottom: 6, background: "rgba(255,255,255,0.9)", color: "#475467", fontSize: 11, padding: "3px 6px", borderRadius: 8, textDecoration: "none" }}
        >
          © OpenStreetMap
        </a>
      </div>

      {mappablePoints.length === 0 ? (
        <p style={{ margin: 0, color: "#667085", fontSize: 14 }}>No usable coordinates yet. Check the address lookup for these stops.</p>
      ) : null}
    </div>
  );
}

export type { RouteMapPoint };
