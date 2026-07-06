import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function Index() {
  return (
    <main style={{ minHeight: "100vh", background: "#f3f6fb", fontFamily: "Arial, sans-serif", color: "#1f2937", display: "grid", placeItems: "center", padding: 20 }}>
      <section style={{ width: "min(760px, 100%)", background: "#ffffff", borderRadius: 24, padding: "32px 24px", boxShadow: "0 16px 42px rgba(15,23,42,0.12)", textAlign: "center", border: "1px solid #e5e7eb" }}>
        <div style={{ width: 74, height: 74, borderRadius: "50%", background: "#eef6ff", display: "grid", placeItems: "center", margin: "0 auto 18px", color: "#509AE6", fontSize: 32, fontWeight: 900 }}>BPD</div>
        <p style={{ margin: "0 0 8px", color: "#509AE6", fontWeight: 900, letterSpacing: 0.4, textTransform: "uppercase" }}>Bathroom Panels Direct</p>
        <h1 style={{ margin: "0 0 12px", fontSize: "clamp(32px, 6vw, 54px)", lineHeight: 1.02 }}>Delivery and returns portal</h1>
        <p style={{ margin: "0 auto 24px", maxWidth: 560, color: "#667085", fontWeight: 700, fontSize: 18, lineHeight: 1.5 }}>
          This secure page is used for Bathroom Panels Direct delivery tracking, return collections and driver route access.
        </p>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 22 }}>
          <div style={{ background: "#eef6ff", borderRadius: 18, padding: 16, textAlign: "left" }}>
            <p style={{ margin: "0 0 6px", fontWeight: 900 }}>Customers</p>
            <p style={{ margin: 0, color: "#667085", fontWeight: 700, lineHeight: 1.4 }}>Open the tracking link sent by SMS or email.</p>
          </div>
          <div style={{ background: "#f8fafc", borderRadius: 18, padding: 16, textAlign: "left" }}>
            <p style={{ margin: "0 0 6px", fontWeight: 900 }}>Drivers</p>
            <p style={{ margin: 0, color: "#667085", fontWeight: 700, lineHeight: 1.4 }}>Use your secure route link from the app.</p>
          </div>
        </div>
        <a href="/app" style={{ display: "inline-flex", marginTop: 26, background: "#509AE6", color: "#ffffff", borderRadius: 14, padding: "13px 18px", textDecoration: "none", fontWeight: 900 }}>Open admin login</a>
      </section>
    </main>
  );
}
