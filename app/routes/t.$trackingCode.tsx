import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";

import { ProfileCard } from "../components/ProfileCard";
import { getCustomerTrackingByCode } from "../lib/customerTracking.server";
import { getCustomerTrackingSettings, type CustomerTrackingSettings } from "../lib/customerTrackingSettings.server";
import { formatEtaSlot } from "../lib/etaSlots";
import { createSignedProofPhotoUrls } from "../lib/proofPhotoStorage.server";

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function formatSlot(estimatedArrival: string | Date | null | undefined, slotMinutes = 60) {
  if (!estimatedArrival) {
    return "Time to be confirmed";
  }

  const start = new Date(estimatedArrival);
  const end = new Date(start.getTime() + Math.max(15, slotMinutes) * 60 * 1000);

  return formatEtaSlot(start, end);
}

function cleanStatus(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}

function pageHeading(input: { routeStatus: string; stopStatus: string; settings: CustomerTrackingSettings }) {
  if (input.stopStatus === "DELIVERED") return input.settings.heroDeliveredTitle;
  if (input.stopStatus === "FAILED") return input.settings.heroAttemptedTitle;
  if (input.routeStatus === "OUT_FOR_DELIVERY") return input.settings.heroOutForDeliveryTitle;
  return input.settings.heroPlannedTitle;
}

function pageMessage(input: { routeStatus: string; stopStatus: string; settings: CustomerTrackingSettings }) {
  if (input.stopStatus === "DELIVERED") return input.settings.deliveredMessage;
  if (input.stopStatus === "FAILED") return input.settings.attemptedMessage;
  if (input.routeStatus === "OUT_FOR_DELIVERY") return input.settings.outForDeliveryMessage;
  return input.settings.notNextMessage;
}

type ProofPhoto = {
  id: string;
  url: string;
  label?: string | null;
};

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const trackingCode = params.trackingCode || "";
  const url = new URL(request.url);

  if (!trackingCode) {
    throw new Response("Tracking details not found", { status: 404 });
  }

  const [tracking, settings] = await Promise.all([
    getCustomerTrackingByCode(trackingCode),
    getCustomerTrackingSettings(),
  ]);
  const stop = tracking?.deliveryGroup?.stops?.[0];
  const route = stop?.route;

  if (!tracking || !stop || !route) {
    throw new Response("Tracking details not found", { status: 404 });
  }

  const proofPhotos = await createSignedProofPhotoUrls(tracking.deliveryGroup?.proofPhotos || []);
  const deliveryPhotos = proofPhotos.filter((photo) => !photo.label?.toLowerCase().includes("signature"));
  const signaturePhotos = proofPhotos.filter((photo) => photo.label?.toLowerCase().includes("signature"));

  return json({
    settings,
    trackingCode,
    saved: url.searchParams.get("instructions") === "saved",
    missing: url.searchParams.get("instructions") === "missing",
    closed: url.searchParams.get("instructions") === "closed",
    orderNumber: tracking.shopifyOrderNumber,
    customerName: tracking.customerName || "Customer",
    itemsSummary: tracking.lineItemSummary || "",
    postcode: tracking.postcode || tracking.deliveryGroup?.postcode || "",
    address: tracking.deliveryGroup?.formattedAddress || tracking.deliveryGroup?.manualAddress || tracking.deliveryGroup?.address || "",
    safePlaceNote: tracking.deliveryGroup?.safePlaceNote || "",
    routeDate: route.date,
    routeStatus: route.status,
    stopStatus: stop.status,
    stopNumber: stop.orderIndex,
    etaSlot: formatSlot(stop.estimatedArrival, route.customerSlotMinutes || 60),
    driverName: route.driver?.name || "your driver",
    driverPhotoUrl: route.driver?.photoUrl || "",
    proofPhotos,
    deliveryPhotos,
    signaturePhotos,
  });
};

function ProofImageViewer({ photo, onClose }: { photo: ProofPhoto; onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={photo.label || "Proof image"} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.92)", padding: "max(14px, env(safe-area-inset-top)) max(14px, env(safe-area-inset-right)) max(14px, env(safe-area-inset-bottom)) max(14px, env(safe-area-inset-left))", display: "grid", placeItems: "center" }}>
      <div onClick={(event) => event.stopPropagation()} style={{ position: "relative", width: "min(1100px, 100%)", maxHeight: "100%", display: "grid", gap: 10 }}>
        <button type="button" onClick={onClose} aria-label="Close image" style={{ position: "absolute", right: -8, top: -8, width: 42, height: 42, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.35)", background: "#ffffff", color: "#111827", fontSize: 24, lineHeight: "38px", fontWeight: 900, cursor: "pointer", boxShadow: "0 10px 24px rgba(0,0,0,0.25)" }}>×</button>
        <img src={photo.url} alt={photo.label || "Proof image"} style={{ display: "block", width: "100%", maxWidth: "100%", maxHeight: "calc(100dvh - 86px)", objectFit: "contain", borderRadius: 18, background: "#ffffff", boxShadow: "0 18px 44px rgba(0,0,0,0.34)", touchAction: "pinch-zoom" }} />
        <p style={{ margin: 0, color: "#ffffff", textAlign: "center", fontSize: 13, fontWeight: 800 }}>{photo.label || "Proof image"}. On mobile, hold the image to save it.</p>
      </div>
    </div>
  );
}

function ProofImages({ photos, title, onOpen }: { photos: ProofPhoto[]; title: string; onOpen: (photo: ProofPhoto) => void }) {
  if (!photos.length) return null;

  return (
    <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16, marginBottom: 18 }}>
      <p style={{ margin: "0 0 10px", fontWeight: 900 }}>{title}</p>
      <div style={{ display: "grid", gap: 12 }}>
        {photos.map((photo) => (
          <button key={photo.id} type="button" onClick={() => onOpen(photo)} style={{ display: "block", width: "100%", padding: 0, border: 0, background: "transparent", textAlign: "left", color: "inherit", cursor: "zoom-in" }}>
            <img src={photo.url} alt={photo.label || title} style={{ display: "block", width: "100%", maxHeight: 420, objectFit: "contain", borderRadius: 16, border: "1px solid #d0d5dd", background: "#ffffff" }} />
            <p style={{ margin: "6px 0 0", color: "#667085", fontWeight: 700, fontSize: 13 }}>Tap to open larger. Hold the larger image to save it.</p>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CustomerTrackingPage() {
  const data = useLoaderData<typeof loader>();
  const { settings } = data;
  const [selectedProofPhoto, setSelectedProofPhoto] = useState<ProofPhoto | null>(null);
  const [safePlaceOption, setSafePlaceOption] = useState("side_gate");
  const routeStarted = data.routeStatus === "OUT_FOR_DELIVERY";
  const complete = data.stopStatus === "DELIVERED";
  const missed = data.stopStatus === "FAILED";
  const requiresExtraDetails = safePlaceOption === "other";
  const primaryColour = settings.primaryColour || "#509AE6";
  const heading = pageHeading({ routeStatus: data.routeStatus, stopStatus: data.stopStatus, settings });
  const message = pageMessage({ routeStatus: data.routeStatus, stopStatus: data.stopStatus, settings });
  const callHref = settings.supportPhone ? `tel:${settings.supportPhone.replace(/[^+\d]/g, "")}` : null;
  const emailHref = settings.supportEmail ? `mailto:${settings.supportEmail}` : null;

  return (
    <main style={{ minHeight: "100vh", background: "#f3f6fb", padding: "24px 14px", fontFamily: "Arial, sans-serif", color: "#1f2937" }}>
      {settings.customCss ? <style>{settings.customCss}</style> : null}
      <section style={{ maxWidth: 720, margin: "0 auto", background: "#ffffff", borderRadius: 20, padding: 24, boxShadow: "0 10px 30px rgba(15,23,42,0.10)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          {settings.logoUrl ? <img src={settings.logoUrl} alt={settings.companyName} style={{ maxHeight: 52, maxWidth: 210, objectFit: "contain" }} /> : <p style={{ margin: 0, color: primaryColour, fontWeight: 900 }}>{settings.companyName}</p>}
        </div>
        <h1 style={{ margin: "8px 0 10px", fontSize: 30, lineHeight: 1.1 }}>{heading}</h1>
        <p style={{ margin: "0 0 8px", color: "#667085", fontWeight: 700 }}>{message}</p>
        <p style={{ margin: "0 0 18px", color: "#667085", fontWeight: 700 }}>Order {data.orderNumber}</p>

        {data.saved ? <div style={{ background: "#dcfce7", color: "#166534", borderRadius: 12, padding: 12, marginBottom: 16, fontWeight: 800 }}>Safe place instructions saved.</div> : null}
        {data.missing ? <div style={{ background: "#fef3c7", color: "#92400e", borderRadius: 12, padding: 12, marginBottom: 16, fontWeight: 800 }}>Please add extra details for the driver before saving other safe place.</div> : null}
        {data.closed ? <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 12, padding: 12, marginBottom: 16, fontWeight: 800 }}>This delivery is already closed, so instructions cannot be changed.</div> : null}

        <div style={{ display: "grid", gap: 12, marginBottom: 18 }}>
          <div style={{ background: "#eef6ff", borderRadius: 16, padding: 16 }}><p style={{ margin: "0 0 4px", fontSize: 13, color: "#475467", fontWeight: 800 }}>Delivery date</p><p style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>{formatDate(data.routeDate)}</p></div>
          <div style={{ background: "#eef6ff", borderRadius: 16, padding: 16 }}><p style={{ margin: "0 0 4px", fontSize: 13, color: "#475467", fontWeight: 800 }}>Booked slot</p><p style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>{data.etaSlot}</p></div>
          <div style={{ background: "#f8fafc", borderRadius: 16, padding: 16 }}><p style={{ margin: "0 0 4px", fontSize: 13, color: "#475467", fontWeight: 800 }}>Status</p><p style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{complete ? "Delivered" : missed ? "Delivery missed" : routeStarted ? "Out for delivery" : "Booked"}</p><p style={{ margin: "8px 0 0", color: "#667085", fontWeight: 700 }}>Stop {data.stopNumber}, {cleanStatus(data.stopStatus)}</p></div>
        </div>

        <ProfileCard name={data.driverName} imageUrl={data.driverPhotoUrl} />
        {settings.roomOfChoiceText ? <p style={{ margin: "8px 0 18px", color: "#667085", fontWeight: 700 }}>{settings.roomOfChoiceText}</p> : null}

        {(callHref || emailHref) ? <div style={{ display: "grid", gridTemplateColumns: callHref && emailHref ? "1fr 1fr" : "1fr", gap: 10, marginBottom: 18 }}>{callHref ? <a href={callHref} style={{ background: primaryColour, color: "#ffffff", borderRadius: 14, padding: "13px 14px", textAlign: "center", textDecoration: "none", fontWeight: 900 }}>Call our team</a> : null}{emailHref ? <a href={emailHref} style={{ background: "#323841", color: "#ffffff", borderRadius: 14, padding: "13px 14px", textAlign: "center", textDecoration: "none", fontWeight: 900 }}>Email our team</a> : null}</div> : null}

        {complete || missed ? (data.proofPhotos.length ? <div style={{ background: "#ecfdf3", color: "#166534", borderRadius: 16, padding: 14, marginBottom: 18, fontWeight: 900 }}>Proof of delivery is available below.</div> : <div style={{ background: "#fff7ed", color: "#c2410c", borderRadius: 16, padding: 14, marginBottom: 18, fontWeight: 900 }}>Proof images are being processed. Refresh this page shortly.</div>) : null}

        <ProofImages photos={data.deliveryPhotos} title="Delivery photo" onOpen={setSelectedProofPhoto} />
        <ProofImages photos={data.signaturePhotos} title="Customer signature" onOpen={setSelectedProofPhoto} />

        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16, marginBottom: 18 }}><p style={{ margin: "0 0 8px", fontWeight: 900 }}>Delivery address</p><p style={{ margin: 0, color: "#475467", fontWeight: 700 }}>{data.address || data.postcode || "Address held on your order"}</p></div>

        {data.itemsSummary ? <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16, marginBottom: 18 }}><p style={{ margin: "0 0 8px", fontWeight: 900 }}>Items</p><p style={{ margin: 0, color: "#475467", fontWeight: 700 }}>{data.itemsSummary}</p></div> : null}

        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16 }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>Safe place instructions</h2>
          {data.safePlaceNote ? <p style={{ margin: "0 0 12px", color: "#166534", fontWeight: 800 }}>Current instruction: {data.safePlaceNote}</p> : null}
          <form method="post" action={`/t/${encodeURIComponent(data.trackingCode)}/safe-place`}>
            <label style={{ display: "block", fontWeight: 900, marginBottom: 8 }}>
              Choose a safe place
              <select name="safePlaceOption" value={safePlaceOption} onChange={(event) => setSafePlaceOption(event.currentTarget.value)} style={{ display: "block", marginTop: 6, width: "100%", borderRadius: 12, border: "1px solid #cbd5e1", padding: 12, fontSize: 16 }}>
                <option value="side_gate">Leave behind side gate</option>
                <option value="rear_garden">Leave in rear garden</option>
                <option value="garage">Leave in garage</option>
                <option value="other">Other safe place</option>
              </select>
            </label>
            <label style={{ display: "block", fontWeight: 900, marginBottom: 12 }}>
              Extra details {requiresExtraDetails ? <span style={{ color: "#dc2626" }}>*</span> : <span style={{ color: "#667085", fontWeight: 700 }}>(optional)</span>}
              <textarea name="safePlaceDetails" rows={3} maxLength={500} required={requiresExtraDetails} aria-invalid={requiresExtraDetails ? "true" : undefined} placeholder={requiresExtraDetails ? "Please tell us where the driver should leave the panels" : "Example, where to place the panels"} style={{ display: "block", marginTop: 6, width: "100%", borderRadius: 12, border: requiresExtraDetails ? "2px solid #dc2626" : "1px solid #cbd5e1", padding: 12, fontSize: 16 }} />
              {requiresExtraDetails ? <span style={{ display: "block", marginTop: 6, color: "#dc2626", fontSize: 13 }}>Please add instructions for the driver.</span> : null}
            </label>
            <button type="submit" disabled={complete || missed} style={{ width: "100%", border: 0, borderRadius: 14, padding: "14px 16px", background: complete || missed ? "#d0d5dd" : primaryColour, color: "#ffffff", fontSize: 16, fontWeight: 900 }}>Save instructions</button>
          </form>
        </div>

        {settings.customFooterHtml ? <div style={{ marginTop: 18 }} dangerouslySetInnerHTML={{ __html: settings.customFooterHtml }} /> : null}
      </section>
      {selectedProofPhoto ? <ProofImageViewer photo={selectedProofPhoto} onClose={() => setSelectedProofPhoto(null)} /> : null}
    </main>
  );
}
