import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";

import { EstimatedVanProgress } from "../components/EstimatedVanProgress";
import { getCustomerTrackingSettings } from "../lib/customerTrackingSettings.server";
import { formatEtaSlot } from "../lib/etaSlots";
import { getCustomerTracking } from "../lib/tracking.server";

const TRACKING_REFRESHED_KEY = "routeBuddyTrackingRefreshed";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const routeId = params.routeId;
  const url = new URL(request.url);
  const shopifyOrderId = url.searchParams.get("order");

  if (!routeId || !shopifyOrderId) {
    throw new Response("Tracking link is missing details", { status: 404 });
  }

  const [tracking, settings] = await Promise.all([
    getCustomerTracking(routeId, shopifyOrderId),
    getCustomerTrackingSettings(),
  ]);

  if (!tracking) {
    throw new Response("Tracking details not found", { status: 404 });
  }

  return json({ tracking, settings });
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return "Not recorded yet";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatLastUpdatedTime(value: Date | null) {
  if (!value) return "Checking now";

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatSlot(estimatedArrival: string | Date | null, slotMinutes = 60) {
  if (!estimatedArrival) return "Your delivery slot is being confirmed";

  const start = new Date(estimatedArrival);
  const end = new Date(start.getTime() + slotMinutes * 60 * 1000);

  return formatEtaSlot(start, end);
}

function statusLabel(status: string) {
  if (status === "NOTIFICATIONS_SENT") return "Delivery booked";
  if (status === "OUT_FOR_DELIVERY") return "Out for delivery";
  if (status === "COMPLETED") return "Delivery completed";
  if (status === "CANCELLED") return "Delivery cancelled";
  if (status === "PUBLISHED") return "Route planned";
  return status.replaceAll("_", " ").toLowerCase();
}

function normaliseStopsBeforeCustomer(stopsBeforeCustomer: number) {
  return Math.max(0, Number.isFinite(stopsBeforeCustomer) ? stopsBeforeCustomer : 0);
}

function stopsBeforeLabel(stopsBeforeCustomer: number, isNextDrop: boolean) {
  const dropsBefore = normaliseStopsBeforeCustomer(stopsBeforeCustomer);

  if (isNextDrop || dropsBefore === 0) return "You are next";
  if (dropsBefore === 1) return "1 panel delivery";
  return `${dropsBefore} panel deliveries`;
}

function buildMapUrl(location?: { latitude: number; longitude: number } | null) {
  if (!location) return null;
  return `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
}

function phoneHref(phone: string) {
  const cleanPhone = phone.replace(/[^+\d]/g, "");
  return cleanPhone ? `tel:${cleanPhone}` : null;
}

function mailHref(email: string) {
  return email ? `mailto:${email}` : null;
}

function customerInitials(name?: string | null) {
  const cleanName = (name || "Driver").trim();
  const parts = cleanName.split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "D";
}

function trackingStatusMessage({
  routeStatus,
  stopStatus,
  isNextDrop,
  stopsBeforeCustomer,
  settings,
}: {
  routeStatus: string;
  stopStatus: string;
  isNextDrop: boolean;
  stopsBeforeCustomer: number;
  settings: Awaited<ReturnType<typeof getCustomerTrackingSettings>>;
}) {
  const dropsBefore = normaliseStopsBeforeCustomer(stopsBeforeCustomer);

  if (stopStatus === "DELIVERED") return settings.deliveredMessage;
  if (stopStatus === "FAILED") return settings.attemptedMessage;
  if (routeStatus === "OUT_FOR_DELIVERY" && (isNextDrop || dropsBefore === 0)) return settings.outForDeliveryMessage;
  if (routeStatus === "OUT_FOR_DELIVERY") return settings.notNextMessage;
  if (routeStatus === "CANCELLED") return "This route is no longer active. Please contact our team if you need help.";
  return settings.notNextMessage;
}

function pageHeading({
  routeStatus,
  stopStatus,
  isNextDrop,
  settings,
}: {
  routeStatus: string;
  stopStatus: string;
  isNextDrop: boolean;
  settings: Awaited<ReturnType<typeof getCustomerTrackingSettings>>;
}) {
  if (stopStatus === "DELIVERED") return settings.heroDeliveredTitle;
  if (stopStatus === "FAILED") return settings.heroAttemptedTitle;
  if (routeStatus === "OUT_FOR_DELIVERY" && isNextDrop) return settings.heroOutForDeliveryTitle;
  if (routeStatus === "OUT_FOR_DELIVERY") return settings.heroOutForDeliveryTitle;
  return settings.heroPlannedTitle;
}

function progressMessage(routeStatus: string, stopStatus: string, isNextDrop: boolean, stopsBeforeCustomer: number, settings: Awaited<ReturnType<typeof getCustomerTrackingSettings>>) {
  const dropsBefore = normaliseStopsBeforeCustomer(stopsBeforeCustomer);

  if (stopStatus === "DELIVERED") return "Delivery completed. The live delivery progress has ended.";
  if (stopStatus === "FAILED") return "Delivery attempted. The live delivery progress has ended.";
  if (routeStatus !== "OUT_FOR_DELIVERY") return "Delivery progress will become available once the driver starts the route.";
  if (isNextDrop || dropsBefore === 0) return settings.outForDeliveryMessage;
  if (dropsBefore === 1) return "There is 1 panel delivery before yours. Live progress appears when you are next.";
  return `There are ${dropsBefore} panel deliveries before yours. Live progress appears when you are next.`;
}

function ProofPhotoThumbs({ photos }: { photos: Array<{ id: string; url: string; label?: string | null }> }) {
  if (!photos.length) return null;

  return (
    <div className="bpd-proof-grid">
      {photos.map((photo, index) => (
        <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" className="bpd-proof-card">
          <img src={photo.url} alt={photo.label || `Delivery photo ${index + 1}`} />
          <span>View photo {index + 1}</span>
        </a>
      ))}
    </div>
  );
}

function DeliveryConfirmationCard({ tracking, primaryColour }: { tracking: Awaited<ReturnType<typeof getCustomerTracking>>; primaryColour: string }) {
  if (!tracking) return null;

  const { stop, deliveryGroup } = tracking;
  const pod = deliveryGroup.proofOfDelivery;
  const mapUrl = buildMapUrl(pod.location);
  const deliveredAt = stop.actualArrival || pod.receiverMark?.createdAt || deliveryGroup.proofPhotos[0]?.createdAt || null;

  return (
    <section className="bpd-card bpd-proof-section">
      <div className="bpd-card-heading-row">
        <div>
          <p className="bpd-success-label">Delivered</p>
          <h2>Proof of delivery</h2>
        </div>
        <button type="button" onClick={() => window.print()} className="bpd-outline-button" style={{ color: primaryColour, borderColor: primaryColour }}>Download proof</button>
      </div>
      <div className="bpd-detail-grid">
        <div><span>Delivered on</span><strong>{formatDateTime(deliveredAt)}</strong></div>
        <div><span>Received by</span><strong>{pod.receiverName || "Recorded by driver"}</strong></div>
        <div><span>Location</span><strong>{mapUrl ? <a href={mapUrl} target="_blank" rel="noreferrer" style={{ color: primaryColour }}>View on map</a> : "Not recorded"}</strong></div>
      </div>
      {deliveryGroup.proofPhotos.length ? <><h3>Delivery photos</h3><ProofPhotoThumbs photos={deliveryGroup.proofPhotos} /></> : null}
      {pod.receiverMark ? (
        <div className="bpd-signature-card">
          <h3>Customer signature</h3>
          <a href={pod.receiverMark.url} target="_blank" rel="noreferrer"><img src={pod.receiverMark.url} alt="Customer signature" /></a>
        </div>
      ) : null}
    </section>
  );
}

function FailedDeliveryCard({ tracking, primaryColour }: { tracking: Awaited<ReturnType<typeof getCustomerTracking>>; primaryColour: string }) {
  if (!tracking) return null;

  const { stop, deliveryGroup } = tracking;
  const attemptedAt = stop.actualArrival || deliveryGroup.proofPhotos[0]?.createdAt || null;
  const note = deliveryGroup.deliveryNote || deliveryGroup.safePlaceNote || null;

  return (
    <section className="bpd-card bpd-attempted-card">
      <p className="bpd-warning-label">Panel delivery attempted</p>
      <h2>We could not complete your delivery this time</h2>
      <p>Our team has recorded an attempted panel delivery. Please contact us and we will help arrange the next step.</p>
      <div className="bpd-detail-grid">
        <div><span>Attempt recorded</span><strong>{formatDateTime(attemptedAt)}</strong></div>
        <div><span>What happens next</span><strong>Please contact the team</strong></div>
      </div>
      {note ? <div className="bpd-note-card"><strong>Driver note</strong><p>{note}</p></div> : null}
      {deliveryGroup.proofPhotos.length ? <><h3>Attempt photos</h3><ProofPhotoThumbs photos={deliveryGroup.proofPhotos} /></> : null}
    </section>
  );
}

function styles(primaryColour: string, customCss: string) {
  return `
    .bpd-track-page { min-height: 100vh; background: #eef4fb; font-family: Arial, sans-serif; color: #323841; }
    .bpd-track-wrap { max-width: 920px; margin: 0 auto; padding: 22px 14px 34px; }
    .bpd-brand-row { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:14px; }
    .bpd-logo { max-height: 54px; max-width: 210px; object-fit: contain; display:block; }
    .bpd-company-name { font-size:18px; font-weight:900; color:${primaryColour}; }
    .bpd-refresh-button, .bpd-outline-button { border:1px solid ${primaryColour}; background:#fff; color:${primaryColour}; border-radius:999px; padding:10px 14px; font-weight:900; cursor:pointer; }
    .bpd-hero { background: linear-gradient(135deg, ${primaryColour} 0%, #2578bd 100%); color:#fff; border-radius:26px; padding:24px; box-shadow:0 18px 44px rgba(50,56,65,.18); margin-bottom:16px; }
    .bpd-hero h1 { margin:0; font-size:34px; line-height:1.05; letter-spacing:-.6px; }
    .bpd-hero p { margin:12px 0 0; font-size:16px; font-weight:700; color:rgba(255,255,255,.92); }
    .bpd-eta-box { margin-top:18px; background:rgba(255,255,255,.16); border:1px solid rgba(255,255,255,.28); border-radius:20px; padding:16px; display:grid; gap:5px; }
    .bpd-eta-box span { font-size:13px; text-transform:uppercase; letter-spacing:.5px; font-weight:900; opacity:.9; }
    .bpd-eta-box strong { font-size:28px; line-height:1.1; }
    .bpd-card { background:#fff; border-radius:22px; padding:18px; box-shadow:0 10px 28px rgba(50,56,65,.1); margin-bottom:16px; border:1px solid #e5e7eb; }
    .bpd-driver-card { display:flex; gap:14px; align-items:center; }
    .bpd-driver-photo, .bpd-driver-initials { width:74px; height:74px; border-radius:50%; flex:0 0 74px; border:3px solid #fff; box-shadow:0 8px 22px rgba(50,56,65,.16); }
    .bpd-driver-photo { object-fit:cover; }
    .bpd-driver-initials { display:grid; place-items:center; background:${primaryColour}; color:#fff; font-weight:900; font-size:24px; }
    .bpd-driver-card h2, .bpd-card h2 { margin:0; font-size:22px; line-height:1.15; }
    .bpd-driver-card p, .bpd-card p { margin:7px 0 0; color:#667085; line-height:1.45; }
    .bpd-action-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; margin-bottom:16px; }
    .bpd-action-button { border:0; border-radius:18px; padding:15px 13px; text-align:center; text-decoration:none; font-weight:900; color:#fff; box-shadow:0 8px 20px rgba(50,56,65,.16); }
    .bpd-email-button { background:#323841; }
    .bpd-call-button { background:${primaryColour}; }
    .bpd-progress-layout { display:grid; grid-template-columns:minmax(0, 1.4fr) minmax(260px, .8fr); gap:16px; align-items:start; }
    .bpd-detail-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px; margin-top:14px; }
    .bpd-detail-grid div, .bpd-order-box, .bpd-note-card { background:#f8fafc; border-radius:16px; padding:12px; border:1px solid #e5e7eb; }
    .bpd-detail-grid span { display:block; color:#667085; font-size:13px; margin-bottom:4px; }
    .bpd-detail-grid strong { display:block; font-size:15px; }
    .bpd-order-box ul { margin:8px 0 0; padding-left:20px; color:#667085; }
    .bpd-proof-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:10px; }
    .bpd-proof-card { display:block; text-decoration:none; color:#323841; border:1px solid #d0d5dd; border-radius:14px; padding:8px; background:#fff; }
    .bpd-proof-card img { width:100%; height:92px; object-fit:cover; border-radius:10px; display:block; }
    .bpd-proof-card span { display:block; margin-top:7px; color:${primaryColour}; font-weight:800; font-size:13px; }
    .bpd-signature-card img { width:100%; max-height:140px; object-fit:contain; border-radius:12px; background:#f8fafc; border:1px solid #d0d5dd; }
    .bpd-success-label { color:#16a34a !important; font-weight:900; text-transform:uppercase; font-size:13px; letter-spacing:.5px; }
    .bpd-warning-label { color:#ea580c !important; font-weight:900; text-transform:uppercase; font-size:13px; letter-spacing:.5px; }
    .bpd-card-heading-row { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:14px; }
    .bpd-footer-custom { margin-top:16px; }
    @media (max-width: 760px) { .bpd-track-wrap { padding:16px 12px 28px; } .bpd-hero { padding:20px; border-radius:22px; } .bpd-hero h1 { font-size:29px; } .bpd-eta-box strong { font-size:24px; } .bpd-progress-layout, .bpd-action-grid { grid-template-columns:1fr; } .bpd-brand-row { align-items:flex-start; } }
    ${customCss || ""}
  `;
}

export default function CustomerTrackingPage() {
  const { tracking, settings } = useLoaderData<typeof loader>();
  const { route, stop, deliveryGroup, order, isNextDrop, progress } = tracking;
  const slot = formatSlot(stop.estimatedArrival);
  const stopsBeforeCustomer = normaliseStopsBeforeCustomer(progress.stopsBeforeCustomer);
  const showProof = route.status === "COMPLETED" || stop.status === "DELIVERED";
  const showFailedDelivery = stop.status === "FAILED";
  const progressActive = route.status === "OUT_FOR_DELIVERY" && stop.status === "PENDING" && isNextDrop;
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const proofPhotos = deliveryGroup.proofPhotos?.length ? deliveryGroup.proofPhotos : deliveryGroup.proofPhotoUrl ? [{ id: "primary", url: deliveryGroup.proofPhotoUrl, label: "Proof photo" }] : [];
  const primaryColour = settings.primaryColour || "#509AE6";
  const pageTitle = pageHeading({ routeStatus: route.status, stopStatus: stop.status, isNextDrop, settings });
  const statusMessage = trackingStatusMessage({ routeStatus: route.status, stopStatus: stop.status, isNextDrop, stopsBeforeCustomer, settings });
  const progressPanelMessage = progressMessage(route.status, stop.status, isNextDrop, stopsBeforeCustomer, settings);
  const callHref = phoneHref(settings.supportPhone);
  const emailHref = mailHref(settings.supportEmail);

  useEffect(() => {
    setLastUpdatedAt(new Date());
    const timer = window.setInterval(() => setCurrentTime(new Date()), 30000);

    if (window.sessionStorage.getItem(TRACKING_REFRESHED_KEY) === "true") {
      window.sessionStorage.removeItem(TRACKING_REFRESHED_KEY);
      setRefreshMessage("Tracking updated");
      window.setTimeout(() => setRefreshMessage(null), 2500);
    }

    return () => window.clearInterval(timer);
  }, []);

  function handleRefreshTracking() {
    window.sessionStorage.setItem(TRACKING_REFRESHED_KEY, "true");
    window.location.reload();
  }

  return (
    <main className="bpd-track-page">
      <style>{styles(primaryColour, settings.customCss)}</style>
      <section className="bpd-track-wrap">
        <div className="bpd-brand-row">
          <div>{settings.logoUrl ? <img className="bpd-logo" src={settings.logoUrl} alt={settings.companyName} /> : <div className="bpd-company-name">{settings.companyName}</div>}</div>
          <button type="button" onClick={handleRefreshTracking} className="bpd-refresh-button">Refresh</button>
        </div>

        <section className="bpd-hero">
          <h1>{pageTitle}</h1>
          <p>{statusMessage}</p>
          <div className="bpd-eta-box">
            <span>Estimated arrival</span>
            <strong>{showProof ? "Delivered" : showFailedDelivery ? "Attempt recorded" : slot}</strong>
            <span>Order {order.shopifyOrderNumber} · Last updated {formatLastUpdatedTime(lastUpdatedAt)}</span>
            {refreshMessage ? <span>{refreshMessage}</span> : null}
          </div>
        </section>

        <section className="bpd-card bpd-driver-card">
          {route.driver?.photoUrl ? <img src={route.driver.photoUrl} alt={route.driver.name} className="bpd-driver-photo" /> : <div className="bpd-driver-initials">{customerInitials(route.driver?.name)}</div>}
          <div>
            <h2>Your driver today is {route.driver?.name || "being confirmed"}</h2>
            <p>{settings.roomOfChoiceText}</p>
          </div>
        </section>

        <div className="bpd-action-grid">
          {callHref ? <a href={callHref} className="bpd-action-button bpd-call-button">Call our team</a> : null}
          {emailHref ? <a href={emailHref} className="bpd-action-button bpd-email-button">Email our team</a> : null}
        </div>

        {showProof ? <DeliveryConfirmationCard tracking={tracking} primaryColour={primaryColour} /> : null}
        {showFailedDelivery ? <FailedDeliveryCard tracking={tracking} primaryColour={primaryColour} /> : null}

        <section className="bpd-progress-layout">
          <div className="bpd-card">
            <EstimatedVanProgress active={progressActive} estimatedArrival={stop.estimatedArrival} currentTime={currentTime} message={progressPanelMessage} />
            <p>{progressPanelMessage}</p>
          </div>

          <aside className="bpd-card">
            <h2>Delivery details</h2>
            <div className="bpd-detail-grid">
              <div><span>Status</span><strong>{showProof ? "Delivered" : showFailedDelivery ? "Delivery attempted" : statusLabel(route.status)}</strong></div>
              <div><span>Delivery date</span><strong>{formatDate(route.date)}</strong></div>
              <div><span>Your drop</span><strong>Number {stop.orderIndex}</strong></div>
              <div><span>Before you</span><strong>{stopsBeforeLabel(stopsBeforeCustomer, isNextDrop)}</strong></div>
              <div><span>Postcode</span><strong>{deliveryGroup.postcode || "Not shown"}</strong></div>
              <div><span>Route updates</span><strong>{progress.failedStops ? `${progress.failedStops} issue${progress.failedStops === 1 ? "" : "s"}` : "None"}</strong></div>
            </div>
            {deliveryGroup.deliveryNote ? <div className="bpd-note-card" style={{ marginTop: 12 }}><strong>Delivery note</strong><p>{deliveryGroup.deliveryNote}</p></div> : null}
            {deliveryGroup.safePlaceNote ? <div className="bpd-note-card" style={{ marginTop: 12 }}><strong>Safe place note</strong><p>{deliveryGroup.safePlaceNote}</p></div> : null}
            {order.items.length ? <div className="bpd-order-box" style={{ marginTop: 12 }}><strong>Your order</strong><ul>{order.items.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
            {showProof && proofPhotos.length ? <div style={{ marginTop: 14 }}><h3>Proof photos</h3><ProofPhotoThumbs photos={proofPhotos} /></div> : null}
          </aside>
        </section>

        {settings.customFooterHtml ? <div className="bpd-footer-custom" dangerouslySetInnerHTML={{ __html: settings.customFooterHtml }} /> : null}
      </section>
    </main>
  );
}
