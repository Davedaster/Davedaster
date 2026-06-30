type EstimatedVanProgressVisuals = {
  progressLineColour?: string;
  vanLabel?: string;
  vanBackgroundColour?: string;
  vanTextColour?: string;
  homeLabel?: string;
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
  if (!estimatedArrival) {
    return 30;
  }

  const etaStart = new Date(estimatedArrival);
  const etaEnd = new Date(etaStart.getTime() + 60 * 60 * 1000);
  const total = etaEnd.getTime() - etaStart.getTime();
  const elapsed = currentTime.getTime() - etaStart.getTime();

  if (!Number.isFinite(total) || total <= 0) {
    return 30;
  }

  if (elapsed <= 0) {
    const minutesUntilStart = Math.abs(elapsed) / 60000;
    return Math.round(Math.max(12, Math.min(38, 38 - minutesUntilStart / 4)));
  }

  return Math.min(94, Math.max(40, Math.round(40 + (elapsed / total) * 54)));
}

function visualValue(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function LockedProgressPanel({ message }: { message: string }) {
  return (
    <div style={{ minHeight: 360, borderRadius: 14, background: "#f8fafc", border: "1px solid #d0d5dd", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div>
        <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#e5e7eb", display: "grid", placeItems: "center", margin: "0 auto 12px", fontSize: 22, fontWeight: 800, color: "#667085" }}>•</div>
        <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>Delivery progress is not active yet</h2>
        <p style={{ margin: 0, color: "#667085", maxWidth: 420 }}>{message}</p>
      </div>
    </div>
  );
}

export function EstimatedVanProgress({ estimatedArrival, currentTime, active, message, visuals, previewPercent }: EstimatedVanProgressProps) {
  if (!active) {
    return <LockedProgressPanel message={message} />;
  }

  const percent = typeof previewPercent === "number" ? Math.min(94, Math.max(10, previewPercent)) : deliveryProgressPercent(estimatedArrival, currentTime);
  const progressLineColour = visualValue(visuals?.progressLineColour, "#509AE6");
  const vanLabel = visualValue(visuals?.vanLabel, "VAN");
  const vanBackgroundColour = visualValue(visuals?.vanBackgroundColour, "#509AE6");
  const vanTextColour = visualValue(visuals?.vanTextColour, "#ffffff");
  const homeLabel = visualValue(visuals?.homeLabel, "HOME");
  const homeBackgroundColour = visualValue(visuals?.homeBackgroundColour, "#ffffff");
  const homeBorderColour = visualValue(visuals?.homeBorderColour, "#16a34a");
  const homeTextColour = visualValue(visuals?.homeTextColour, "#16a34a");

  return (
    <div style={{ minHeight: 360, borderRadius: 14, background: "linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%)", border: "1px solid #d0d5dd", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 680 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 26 }}>
          <strong style={{ fontSize: 18, color: "#323841" }}>Your driver is on the way</strong>
          <span style={{ background: "#16a34a", color: "#ffffff", borderRadius: 999, padding: "7px 10px", fontSize: 13, fontWeight: 800 }}>Delivery progress</span>
        </div>

        <div style={{ position: "relative", height: 132, margin: "10px 16px 18px" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 58, height: 12, borderRadius: 999, background: "#d0d5dd", overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(50,56,65,0.12)" }}>
            <div style={{ height: "100%", width: `${percent}%`, background: progressLineColour, borderRadius: 999, transition: "width 900ms ease" }} />
          </div>
          <div style={{ position: "absolute", left: 0, top: 35, width: 64, height: 64, borderRadius: 18, background: "#ffffff", border: "2px solid #d0d5dd", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 900, color: "#323841", boxShadow: "0 8px 20px rgba(50,56,65,0.14)" }}>{vanLabel}</div>
          <div style={{ position: "absolute", right: 0, top: 35, width: 64, height: 64, borderRadius: 18, background: homeBackgroundColour, border: `2px solid ${homeBorderColour}`, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 900, color: homeTextColour, boxShadow: "0 8px 20px rgba(50,56,65,0.14)" }}>{homeLabel}</div>
          <div style={{ position: "absolute", left: `calc(${percent}% - 28px)`, top: 28, width: 76, height: 76, borderRadius: 22, background: vanBackgroundColour, color: vanTextColour, display: "grid", placeItems: "center", fontSize: 13, fontWeight: 900, boxShadow: "0 12px 28px rgba(80,154,230,0.38)", transition: "left 900ms ease" }}>{vanLabel}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <div style={{ background: "#ffffff", borderRadius: 14, padding: 12, border: "1px solid #e5e7eb" }}><div style={{ color: "#667085", fontSize: 13 }}>Progress</div><div style={{ fontWeight: 900, color: "#323841" }}>{percent}%</div></div>
          <div style={{ background: "#ffffff", borderRadius: 14, padding: 12, border: "1px solid #e5e7eb" }}><div style={{ color: "#667085", fontSize: 13 }}>Status</div><div style={{ fontWeight: 900, color: "#16a34a" }}>Driver on the way</div></div>
        </div>
        <p style={{ margin: "14px 0 0", color: "#667085", fontSize: 14, textAlign: "center" }}>This is estimated delivery progress based on the current route ETA and driver updates.</p>
      </div>
    </div>
  );
}
