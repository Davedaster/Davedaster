import type { ReactNode } from "react";

type EstimatedVanProgressVisuals = {
  progressLineColour?: string;
  vanLabel?: string;
  vanIconUrl?: string;
  vanBackgroundColour?: string;
  vanTextColour?: string;
  homeLabel?: string;
  homeIconUrl?: string;
  homeBackgroundColour?: string;
  homeBorderColour?: string;
  homeTextColour?: string;
};

type EstimatedVanProgressProps = {
  estimatedArrival?: string | Date | null;
  currentTime: Date;
  active: boolean;
  message: string;
  visuals?: EstimatedVanProgressVisuals;
  previewPercent?: number;
};

function deliveryProgressPercent(estimatedArrival: string | Date | null | undefined, currentTime: Date) {
  if (!estimatedArrival) return 30;

  const etaStart = new Date(estimatedArrival);
  const etaEnd = new Date(etaStart.getTime() + 60 * 60 * 1000);
  const total = etaEnd.getTime() - etaStart.getTime();
  const elapsed = currentTime.getTime() - etaStart.getTime();

  if (!Number.isFinite(total) || total <= 0) return 30;

  if (elapsed <= 0) {
    const minutesUntilStart = Math.abs(elapsed) / 60000;
    return Math.round(Math.max(10, Math.min(34, 34 - minutesUntilStart / 4)));
  }

  return Math.min(92, Math.max(36, Math.round(36 + (elapsed / total) * 56)));
}

function visualValue(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function VanIcon({ colour }: { colour: string }) {
  return (
    <svg width="32" height="32" viewBox="0 0 64 64" role="img" aria-label="Van" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 21C7 17.6863 9.68629 15 13 15H39C42.3137 15 45 17.6863 45 21V25H50.1716C51.7629 25 53.289 25.6321 54.4142 26.7574L59 31.3431V43C59 46.3137 56.3137 49 53 49H11C8.79086 49 7 47.2091 7 45V21Z" fill={colour} />
      <path d="M45 29H50L55 34V37H45V29Z" fill="white" opacity="0.92" />
      <path d="M13 22H38V35H13V22Z" fill="white" opacity="0.92" />
      <circle cx="19" cy="49" r="6" fill="#323841" />
      <circle cx="49" cy="49" r="6" fill="#323841" />
      <circle cx="19" cy="49" r="2.5" fill="white" opacity="0.95" />
      <circle cx="49" cy="49" r="2.5" fill="white" opacity="0.95" />
    </svg>
  );
}

function HouseIcon({ colour }: { colour: string }) {
  return (
    <svg width="31" height="31" viewBox="0 0 64 64" role="img" aria-label="Home" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 29.5L32 11L54 29.5" stroke={colour} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 29V53H47V29" stroke={colour} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M27 53V39H37V53" stroke={colour} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MarkerIcon({ imageUrl, label, fallback }: { imageUrl?: string; label: string; fallback: ReactNode }) {
  if (imageUrl?.trim()) {
    return <img src={imageUrl.trim()} alt={label} style={{ width: 34, height: 34, objectFit: "contain", display: "block" }} />;
  }

  return <>{fallback}</>;
}

function LockedProgressPanel({ message }: { message: string }) {
  return (
    <div style={{ minHeight: 240, borderRadius: 22, background: "#fbfdff", border: "1px solid #e5eaf0", display: "grid", placeItems: "center", padding: 22, textAlign: "center" }}>
      <div>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#edf2f7", display: "grid", placeItems: "center", margin: "0 auto 12px", fontSize: 18, fontWeight: 700, color: "#7b8794" }}>•</div>
        <h2 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 650, color: "#323841" }}>Delivery progress is not active yet</h2>
        <p style={{ margin: 0, color: "#667085", maxWidth: 420, lineHeight: 1.45 }}>{message}</p>
      </div>
    </div>
  );
}

export function EstimatedVanProgress({ estimatedArrival, currentTime, active, message, visuals, previewPercent }: EstimatedVanProgressProps) {
  if (!active) return <LockedProgressPanel message={message} />;

  const percent = typeof previewPercent === "number" ? Math.min(92, Math.max(10, previewPercent)) : deliveryProgressPercent(estimatedArrival, currentTime);
  const progressLineColour = visualValue(visuals?.progressLineColour, "#509AE6");
  const vanLabel = visualValue(visuals?.vanLabel, "Van");
  const vanIconUrl = visuals?.vanIconUrl;
  const vanBackgroundColour = visualValue(visuals?.vanBackgroundColour, "#509AE6");
  const vanTextColour = visualValue(visuals?.vanTextColour, "#ffffff");
  const homeLabel = visualValue(visuals?.homeLabel, "Home");
  const homeIconUrl = visuals?.homeIconUrl;
  const homeBackgroundColour = visualValue(visuals?.homeBackgroundColour, "#ffffff");
  const homeBorderColour = visualValue(visuals?.homeBorderColour, "#16a34a");
  const homeTextColour = visualValue(visuals?.homeTextColour, "#16a34a");

  return (
    <div style={{ minHeight: 270, borderRadius: 24, background: "linear-gradient(180deg, #ffffff 0%, #f7fbff 100%)", border: "1px solid #e3eaf2", display: "grid", placeItems: "center", padding: "clamp(16px, 3vw, 24px)" }}>
      <div style={{ width: "100%", maxWidth: 660 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 24 }}>
          <strong style={{ fontSize: 17, color: "#323841", fontWeight: 650 }}>Your driver is on the way</strong>
          <span style={{ background: "#ecfdf3", color: "#12803b", border: "1px solid #bbf7d0", borderRadius: 999, padding: "7px 11px", fontSize: 12, fontWeight: 650 }}>Live progress</span>
        </div>

        <div style={{ position: "relative", height: 112, margin: "4px 12px 18px" }}>
          <div style={{ position: "absolute", left: 16, right: 54, top: 52, height: 6, borderRadius: 999, background: "#dde5ee", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${percent}%`, background: progressLineColour, borderRadius: 999, transition: "width 900ms ease" }} />
          </div>
          <div style={{ position: "absolute", left: 8, top: 49, width: 12, height: 12, borderRadius: "50%", background: progressLineColour, opacity: 0.35 }} />
          <div title={homeLabel} style={{ position: "absolute", right: 0, top: 25, width: 58, height: 58, borderRadius: 18, background: homeBackgroundColour, border: `1.5px solid ${homeBorderColour}`, display: "grid", placeItems: "center", color: homeTextColour, boxShadow: "0 8px 22px rgba(50,56,65,0.08)" }}>
            <MarkerIcon imageUrl={homeIconUrl} label={homeLabel} fallback={<HouseIcon colour={homeTextColour} />} />
          </div>
          <div title={vanLabel} style={{ position: "absolute", left: `${percent}%`, transform: "translateX(-50%)", top: 18, width: 66, height: 66, borderRadius: 21, background: vanBackgroundColour, color: vanTextColour, display: "grid", placeItems: "center", boxShadow: "0 14px 34px rgba(80,154,230,0.22)", transition: "left 900ms ease" }}>
            <MarkerIcon imageUrl={vanIconUrl} label={vanLabel} fallback={<VanIcon colour={vanTextColour} />} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))", gap: 10 }}>
          <div style={{ background: "rgba(255,255,255,0.86)", borderRadius: 16, padding: "11px 12px", border: "1px solid #e8edf3" }}><div style={{ color: "#667085", fontSize: 13 }}>Progress</div><div style={{ fontWeight: 650, color: "#323841" }}>{percent}%</div></div>
          <div style={{ background: "rgba(255,255,255,0.86)", borderRadius: 16, padding: "11px 12px", border: "1px solid #e8edf3" }}><div style={{ color: "#667085", fontSize: 13 }}>Status</div><div style={{ fontWeight: 650, color: "#12803b" }}>Driver on the way</div></div>
        </div>
        <p style={{ margin: "14px 0 0", color: "#667085", fontSize: 13, lineHeight: 1.45, textAlign: "center" }}>Estimated from the current route ETA and driver updates.</p>
      </div>
    </div>
  );
}
