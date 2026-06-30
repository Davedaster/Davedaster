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
  if (!estimatedArrival) return 28;

  const etaStart = new Date(estimatedArrival);
  const etaEnd = new Date(etaStart.getTime() + 60 * 60 * 1000);
  const total = etaEnd.getTime() - etaStart.getTime();
  const elapsed = currentTime.getTime() - etaStart.getTime();

  if (!Number.isFinite(total) || total <= 0) return 28;

  if (elapsed <= 0) {
    const minutesUntilStart = Math.abs(elapsed) / 60000;
    return Math.round(Math.max(8, Math.min(28, 28 - minutesUntilStart / 5)));
  }

  return Math.min(100, Math.max(32, Math.round(32 + (elapsed / total) * 68)));
}

function visualValue(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function VanIcon({ colour }: { colour: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 64 64" role="img" aria-label="Van" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 22C7 18.6863 9.68629 16 13 16H39C42.3137 16 45 18.6863 45 22V26H50.1716C51.7629 26 53.289 26.6321 54.4142 27.7574L59 32.3431V43C59 46.3137 56.3137 49 53 49H11C8.79086 49 7 47.2091 7 45V22Z" fill={colour} />
      <path d="M45 30H50L55 35V38H45V30Z" fill="white" opacity="0.92" />
      <path d="M13 23H38V35H13V23Z" fill="white" opacity="0.92" />
      <circle cx="19" cy="49" r="5.5" fill="#323841" />
      <circle cx="49" cy="49" r="5.5" fill="#323841" />
      <circle cx="19" cy="49" r="2.25" fill="white" opacity="0.95" />
      <circle cx="49" cy="49" r="2.25" fill="white" opacity="0.95" />
    </svg>
  );
}

function HouseIcon({ colour }: { colour: string }) {
  return (
    <svg width="23" height="23" viewBox="0 0 64 64" role="img" aria-label="Home" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 29.5L32 11L54 29.5" stroke={colour} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 29V53H47V29" stroke={colour} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M27 53V39H37V53" stroke={colour} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MarkerIcon({ imageUrl, label, fallback, size = 25 }: { imageUrl?: string; label: string; fallback: ReactNode; size?: number }) {
  if (imageUrl?.trim()) {
    return <img src={imageUrl.trim()} alt={label} style={{ width: size, height: size, objectFit: "contain", display: "block" }} />;
  }

  return <>{fallback}</>;
}

function LockedProgressPanel({ message }: { message: string }) {
  return (
    <div style={{ minHeight: 210, borderRadius: 22, background: "#fbfdff", border: "1px solid #e6ecf2", display: "grid", placeItems: "center", padding: 20, textAlign: "center" }}>
      <div>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#edf2f7", display: "grid", placeItems: "center", margin: "0 auto 10px", fontSize: 16, fontWeight: 600, color: "#7b8794" }}>•</div>
        <h2 style={{ margin: "0 0 7px", fontSize: 17, fontWeight: 620, color: "#323841" }}>Delivery progress is not active yet</h2>
        <p style={{ margin: 0, color: "#667085", maxWidth: 420, lineHeight: 1.45, fontSize: 13 }}>{message}</p>
      </div>
    </div>
  );
}

export function EstimatedVanProgress({ estimatedArrival, currentTime, active, message, visuals, previewPercent }: EstimatedVanProgressProps) {
  if (!active) return <LockedProgressPanel message={message} />;

  const percent = typeof previewPercent === "number" ? Math.min(100, Math.max(0, previewPercent)) : deliveryProgressPercent(estimatedArrival, currentTime);
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
    <div style={{ minHeight: 230, borderRadius: 22, background: "linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)", border: "1px solid #e6ecf2", display: "grid", placeItems: "center", padding: "clamp(14px, 3vw, 21px)" }}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 19 }}>
          <strong style={{ fontSize: 16, color: "#323841", fontWeight: 620, letterSpacing: "-0.1px" }}>Your driver is on the way</strong>
          <span style={{ background: "#f0fdf4", color: "#12803b", border: "1px solid #bbf7d0", borderRadius: 999, padding: "6px 9px", fontSize: 11, fontWeight: 620 }}>Live</span>
        </div>

        <div style={{ position: "relative", height: 82, margin: "0 4px 15px" }}>
          <div style={{ position: "absolute", left: 18, right: 20, top: 39, height: 4, borderRadius: 999, background: "#dfe8f1", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${percent}%`, background: progressLineColour, borderRadius: 999, transition: "width 900ms ease" }} />
          </div>

          <div title={homeLabel} style={{ position: "absolute", right: 0, top: 21, width: 40, height: 40, borderRadius: 14, background: homeBackgroundColour, border: `1.25px solid ${homeBorderColour}`, display: "grid", placeItems: "center", color: homeTextColour, boxShadow: "0 6px 16px rgba(16,24,40,0.055)", zIndex: 2 }}>
            <MarkerIcon imageUrl={homeIconUrl} label={homeLabel} fallback={<HouseIcon colour={homeTextColour} />} size={24} />
          </div>

          <div title={vanLabel} style={{ position: "absolute", left: `calc(18px + (${percent} * (100% - 38px)) / 100)`, transform: "translateX(-50%)", top: 18, width: 44, height: 44, borderRadius: 15, background: vanBackgroundColour, color: vanTextColour, display: "grid", placeItems: "center", boxShadow: "0 10px 22px rgba(80,154,230,0.18)", transition: "left 900ms ease", zIndex: 3 }}>
            <MarkerIcon imageUrl={vanIconUrl} label={vanLabel} fallback={<VanIcon colour={vanTextColour} />} size={26} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(125px, 1fr))", gap: 8 }}>
          <div style={{ background: "rgba(255,255,255,0.78)", borderRadius: 14, padding: "10px 11px", border: "1px solid #edf1f5" }}><div style={{ color: "#7b8794", fontSize: 12 }}>Progress</div><div style={{ fontWeight: 620, color: "#323841", fontSize: 14 }}>{percent}%</div></div>
          <div style={{ background: "rgba(255,255,255,0.78)", borderRadius: 14, padding: "10px 11px", border: "1px solid #edf1f5" }}><div style={{ color: "#7b8794", fontSize: 12 }}>Status</div><div style={{ fontWeight: 620, color: "#12803b", fontSize: 14 }}>Driver on the way</div></div>
        </div>
        <p style={{ margin: "12px 0 0", color: "#667085", fontSize: 12, lineHeight: 1.42, textAlign: "center" }}>Estimated from the current route ETA and driver updates.</p>
      </div>
    </div>
  );
}