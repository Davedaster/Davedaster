type RouteMapPoint = {
  id: string;
  label: string;
  title?: string;
  latitude: number | null;
  longitude: number | null;
  selected?: boolean;
  status?: string;
};

type RouteMapProps = {
  points: RouteMapPoint[];
  height?: number;
  title?: string;
  badge?: string;
  showRouteLine?: boolean;
  onSelectPoint?: (point: RouteMapPoint) => void;
};

const TILE_SIZE = 256;
const MAP_WIDTH = 1024;
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
    return 11;
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const latSpan = Math.max(...latitudes) - Math.min(...latitudes);
  const lngSpan = Math.max(...longitudes) - Math.min(...longitudes);
  const span = Math.max(latSpan, lngSpan);

  if (span < 0.15) return 12;
  if (span < 0.35) return 11;
  if (span < 0.8) return 10;
  if (span < 1.6) return 9;
  if (span < 3.2) return 8;
  return 7;
}

function normalisedPoints(points: RouteMapPoint[]) {
  return points.filter((point): point is RouteMapPoint & { latitude: number; longitude: number } => (
    typeof point.latitude === "number" &&
    typeof point.longitude === "number" &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude)
  ));
}

export function RouteMap({
  points,
  height = 520,
  title = "Route map",
  badge,
  showRouteLine = true,
  onSelectPoint,
}: RouteMapProps) {
  const mappablePoints = normalisedPoints(points);
  const zoom = chooseZoom(mappablePoints);
  const centerLatitude = mappablePoints.length
    ? mappablePoints.reduce((total, point) => total + point.latitude, 0) / mappablePoints.length
    : DEFAULT_CENTER.latitude;
  const centerLongitude = mappablePoints.length
    ? mappablePoints.reduce((total, point) => total + point.longitude, 0) / mappablePoints.length
    : DEFAULT_CENTER.longitude;
  const center = project(centerLatitude, centerLongitude, zoom);
  const topLeft = {
    x: center.x - MAP_WIDTH / 2,
    y: center.y - height / 2,
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

  return (
    <div style={{ display: "grid", gap: 10 }}>
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
        <div style={{ position: "absolute", inset: 0, left: "50%", width: MAP_WIDTH, transform: "translateX(-50%)" }}>
          {tiles.map((tile) => (
            <img
              key={`${tile.x}-${tile.y}`}
              src={tile.src}
              alt=""
              loading="lazy"
              width={TILE_SIZE}
              height={TILE_SIZE}
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

            return (
              <button
                key={point.id}
                type="button"
                disabled={!onSelectPoint}
                onClick={() => onSelectPoint?.(point)}
                aria-label={point.title || point.label}
                title={point.title || point.label}
                style={{
                  position: "absolute",
                  left: point.left,
                  top: point.top,
                  transform: "translate(-50%, -100%)",
                  border: 0,
                  background: "transparent",
                  cursor: onSelectPoint ? "pointer" : "default",
                  padding: 0,
                  zIndex: point.selected ? 5 : 4,
                }}
              >
                <span
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: point.selected ? 38 : 32,
                    height: point.selected ? 38 : 32,
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
                      fontSize: 12,
                      fontWeight: 800,
                      lineHeight: 1,
                    }}
                  >
                    {point.label || index + 1}
                  </span>
                </span>
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
