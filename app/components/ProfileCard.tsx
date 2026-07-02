function initials(value: string) {
  const parts = value.split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") : "BPD";
}

export function ProfileCard({ name, imageUrl }: { name: string; imageUrl?: string | null }) {
  return (
    <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16, marginBottom: 18 }}>
      <p style={{ margin: "0 0 10px", fontWeight: 900 }}>Your delivery contact</p>
      <div style={{ display: "flex", alignItems: "center", gap: 14, background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 18, padding: 14 }}>
        {imageUrl ? (
          <img src={imageUrl} alt="" style={{ width: 68, height: 68, borderRadius: "50%", objectFit: "cover", flex: "0 0 auto" }} />
        ) : (
          <div style={{ width: 68, height: 68, borderRadius: "50%", background: "#509AE6", color: "#ffffff", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 18, flex: "0 0 auto" }}>{initials(name)}</div>
        )}
        <div>
          <p style={{ margin: 0, color: "#667085", fontWeight: 800, fontSize: 13 }}>Your delivery contact today is</p>
          <p style={{ margin: "2px 0 0", color: "#1f2937", fontWeight: 900, fontSize: 22, lineHeight: 1.15 }}>{name}</p>
        </div>
      </div>
    </div>
  );
}
