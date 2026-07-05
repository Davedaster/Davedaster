import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useRevalidator } from "@remix-run/react";
import { useEffect, useState } from "react";

import { EstimatedVanProgress } from "../components/EstimatedVanProgress";
import { getCustomerTrackingSettings } from "../lib/customerTrackingSettings.server";
import { formatEtaSlot } from "../lib/etaSlots";
import { getCustomerTracking } from "../lib/tracking.server";

const TRACKING_REFRESHED_KEY = "routeBuddyTrackingRefreshed";
const AUTO_REFRESH_MS = 60000;

type Tracking = NonNullable<Awaited<ReturnType<typeof getCustomerTracking>>>;
type TrackingSettings = Awaited<ReturnType<typeof getCustomerTrackingSettings>>;

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const routeId = params.routeId;
  const url = new URL(request.url);
  const shopifyOrderId = url.searchParams.get("order");

  if (!routeId || !shopifyOrderId) throw new Response("Tracking link is missing details", { status: 404 });

  const [tracking, settings] = await Promise.all([getCustomerTracking(routeId, shopifyOrderId), getCustomerTrackingSettings()]);
  if (!tracking) throw new Response("Tracking details not found", { status: 404 });

  return json({ tracking, settings });
};

function isReturnTracking(tracking: Tracking) {
  return tracking.serviceType === "collection";
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value?: string | Date | null) {
  if (!value) return "Not recorded yet";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatLastUpdatedTime(value: Date | null) {
  if (!value) return "Checking now";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(value);
}

function formatSlot(estimatedArrival: string | Date | null, slotMinutes = 60, isReturn = false) {
  if (!estimatedArrival) return isReturn ? "Your return slot is being confirmed" : "Your delivery slot is being confirmed";
  const start = new Date(estimatedArrival);
  const end = new Date(start.getTime() + slotMinutes * 60 * 1000);
  return formatEtaSlot(start, end);
}

function statusLabel(status: string, isReturn = false) {
  if (status === "NOTIFICATIONS_SENT") return isReturn ? "Return booked" : "Delivery booked";
  if (status === "OUT_FOR_DELIVERY") return isReturn ? "Return out today" : "Out for delivery";
  if (status === "COMPLETED") return isReturn ? "Return completed" : "Delivery completed";
  if (status === "CANCELLED") return isReturn ? "Return cancelled" : "Delivery cancelled";
  if (status === "PUBLISHED") return "Route planned";
  return status.replaceAll("_", " ").toLowerCase();
}

function normaliseStopsBeforeCustomer(stopsBeforeCustomer: number) {
  return Math.max(0, Number.isFinite(stopsBeforeCustomer) ? stopsBeforeCustomer : 0);
}

function stopsBeforeLabel(stopsBeforeCustomer: number, isNextDrop: boolean, isReturn = false) {
  const dropsBefore = normaliseStopsBeforeCustomer(stopsBeforeCustomer);
  if (isNextDrop || dropsBefore === 0) return "You are next";
  if (isReturn) return dropsBefore === 1 ? "1 stop" : `${dropsBefore} stops`;
  if (dropsBefore === 1) return "1 delivery";
  return `${dropsBefore} deliveries`;
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
  const parts = (name || "Driver").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "D";
}

function trackingStatusMessage({ routeStatus, stopStatus, isNextDrop, stopsBeforeCustomer, settings, isReturn }: { routeStatus: string; stopStatus: string; isNextDrop: boolean; stopsBeforeCustomer: number; settings: TrackingSettings; isReturn: boolean }) {
  const dropsBefore = normaliseStopsBeforeCustomer(stopsBeforeCustomer);

  if (isReturn) {
    if (stopStatus === "DELIVERED") return "Your return has been completed. The returned items will be checked before any refund, replacement or further action is confirmed.";
    if (stopStatus === "FAILED") return "We attempted your return but could not complete it. Please contact our team and we will help arrange the next step.";
    if (routeStatus === "OUT_FOR_DELIVERY" && (isNextDrop || dropsBefore === 0)) return "Your driver is on the way for your return.";
    if (routeStatus === "OUT_FOR_DELIVERY") return "Your return is on today's route. We will update this page as your driver gets closer.";
    if (routeStatus === "CANCELLED") return "This return route is no longer active. Please contact our team if you need help.";
    return "Your return is booked and will be updated here.";
  }

  if (stopStatus === "DELIVERED") return settings.deliveredMessage;
  if (stopStatus === "FAILED") return settings.attemptedMessage;
  if (routeStatus === "OUT_FOR_DELIVERY" && (isNextDrop || dropsBefore === 0)) return settings.outForDeliveryMessage;
  if (routeStatus === "OUT_FOR_DELIVERY") return settings.notNextMessage;
  if (routeStatus === "CANCELLED") return "This route is no longer active. Please contact our team if you need help.";
  return settings.notNextMessage;
}

function pageHeading({ routeStatus, stopStatus, settings, isReturn }: { routeStatus: string; stopStatus: string; isNextDrop: boolean; settings: TrackingSettings; isReturn: boolean }) {
  if (isReturn) {
    if (stopStatus === "DELIVERED") return "Return completed";
    if (stopStatus === "FAILED") return "Return attempted";
    if (routeStatus === "OUT_FOR_DELIVERY") return "Your return is out today";
    return "Your return is booked";
  }

  if (stopStatus === "DELIVERED") return settings.heroDeliveredTitle;
  if (stopStatus === "FAILED") return settings.heroAttemptedTitle;
  if (routeStatus === "OUT_FOR_DELIVERY") return settings.heroOutForDeliveryTitle;
  return settings.heroPlannedTitle;
}

function progressMessage(routeStatus: string, stopStatus: string, isNextDrop: boolean, stopsBeforeCustomer: number, settings: TrackingSettings, isReturn = false) {
  const dropsBefore = normaliseStopsBeforeCustomer(stopsBeforeCustomer);

  if (isReturn) {
    if (stopStatus === "DELIVERED") return "Return completed. The live progress has ended.";
    if (stopStatus === "FAILED") return "Return attempted. The live progress has ended.";
    if (routeStatus !== "OUT_FOR_DELIVERY") return "Return progress appears once the driver starts the route.";
    if (isNextDrop || dropsBefore === 0) return "You are next for your return.";
    if (dropsBefore === 1) return "There is 1 stop before your return. Live progress appears when you are next.";
    return `There are ${dropsBefore} stops before your return. Live progress appears when you are next.`;
  }

  if (stopStatus === "DELIVERED") return "Delivery completed. The live progress has ended.";
  if (stopStatus === "FAILED") return "Delivery attempted. The live progress has ended.";
  if (routeStatus !== "OUT_FOR_DELIVERY") return "Delivery progress appears once the driver starts the route.";
  if (isNextDrop || dropsBefore === 0) return settings.outForDeliveryMessage;
  if (dropsBefore === 1) return "There is 1 delivery before yours. Live progress appears when you are next.";
  return `There are ${dropsBefore} deliveries before yours. Live progress appears when you are next.`;
}

function ProofPhotoThumbs({ photos, altPrefix = "Photo" }: { photos: Array<{ id: string; url: string; label?: string | null }>; altPrefix?: string }) {
  if (!photos.length) return null;
  return <div className="bpd-proof-grid">{photos.map((photo, index) => <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" className="bpd-proof-card"><img src={photo.url} alt={photo.label || `${altPrefix} ${index + 1}`} /><span>View photo {index + 1}</span></a>)}</div>;
}

function CompletionCard({ tracking, primaryColour, proofPhotos }: { tracking: Tracking; primaryColour: string; proofPhotos: Array<{ id: string; url: string; label?: string | null }> }) {
  const { stop, deliveryGroup, collection } = tracking;
  const isReturn = isReturnTracking(tracking);
  const pod = deliveryGroup.proofOfDelivery;
  const mapUrl = buildMapUrl(pod.location);
  const completedAt = isReturn ? collection?.collectedAt || stop.actualArrival || null : stop.actualArrival || pod.receiverMark?.createdAt || null;
  const signatureUrl = isReturn ? collection?.customerSignature : pod.receiverMark?.url;

  return <section className="bpd-card bpd-proof-section"><div className="bpd-card-heading-row"><div><p className="bpd-success-label">{isReturn ? "Returned" : "Delivered"}</p><h2>{isReturn ? "Proof of return" : "Proof of delivery"}</h2></div><button type="button" onClick={() => window.print()} className="bpd-outline-button" style={{ color: primaryColour, borderColor: primaryColour }}>Download proof</button></div><div className="bpd-detail-grid"><div><span>{isReturn ? "Returned on" : "Delivered on"}</span><strong>{formatDateTime(completedAt)}</strong></div><div><span>{isReturn ? "Returned by" : "Received by"}</span><strong>{isReturn ? "Customer / safe place" : pod.receiverName || "Recorded by driver"}</strong></div><div><span>Location</span><strong>{mapUrl ? <a href={mapUrl} target="_blank" rel="noreferrer" style={{ color: primaryColour }}>View on map</a> : "Not recorded"}</strong></div></div>{proofPhotos.length ? <><h3>{isReturn ? "Return photos" : "Delivery photos"}</h3><ProofPhotoThumbs photos={proofPhotos} altPrefix={isReturn ? "Return photo" : "Delivery photo"} /></> : null}{signatureUrl ? <div className="bpd-signature-card"><h3>{isReturn ? "Customer return signature" : "Customer signature"}</h3><a href={signatureUrl} target="_blank" rel="noreferrer"><img src={signatureUrl} alt={isReturn ? "Customer return signature" : "Customer signature"} /></a></div> : null}</section>;
}

function AttemptedCard({ tracking }: { tracking: Tracking; primaryColour: string }) {
  const { stop, deliveryGroup, collection } = tracking;
  const isReturn = isReturnTracking(tracking);
  const attemptedAt = stop.actualArrival || null;
  const note = isReturn ? collection?.driverNote || deliveryGroup.deliveryNote || deliveryGroup.safePlaceNote || null : deliveryGroup.deliveryNote || deliveryGroup.safePlaceNote || null;
  return <section className="bpd-card bpd-attempted-card"><p className="bpd-warning-label">{isReturn ? "Return attempted" : "Delivery attempted"}</p><h2>{isReturn ? "We could not complete your return this time" : "We could not complete your delivery this time"}</h2><p>{isReturn ? "Our team has recorded an attempted return. Please contact us and we will help arrange the next step." : "Our team has recorded an attempted delivery. Please contact us and we will help arrange the next step."}</p><div className="bpd-detail-grid"><div><span>Attempt recorded</span><strong>{formatDateTime(attemptedAt)}</strong></div><div><span>What happens next</span><strong>Please contact the team</strong></div></div>{note ? <div className="bpd-note-card"><strong>Driver note</strong><p>{note}</p></div> : null}{deliveryGroup.proofPhotos.length ? <><h3>{isReturn ? "Return attempt photos" : "Attempt photos"}</h3><ProofPhotoThumbs photos={deliveryGroup.proofPhotos} altPrefix={isReturn ? "Return attempt photo" : "Attempt photo"} /></> : null}</section>;
}

function styles(primaryColour: string, customCss: string) {
  return `
    .bpd-track-page { min-height: 100vh; background: #f6f8fb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #323841; }
    .bpd-track-wrap { max-width: 900px; margin: 0 auto; padding: 24px 16px 38px; }
    .bpd-brand-row { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:14px; }
    .bpd-logo { max-height: 48px; max-width: 190px; object-fit: contain; display:block; }
    .bpd-company-name { font-size:16px; font-weight:650; color:${primaryColour}; }
    .bpd-refresh-button, .bpd-outline-button { border:1px solid #dce5ef; background:rgba(255,255,255,.82); color:#323841; border-radius:999px; padding:9px 13px; font-weight:650; cursor:pointer; box-shadow:0 8px 24px rgba(16,24,40,.05); }
    .bpd-hero { background:#ffffff; color:#323841; border-radius:28px; padding:22px; box-shadow:0 18px 50px rgba(16,24,40,.07); margin-bottom:14px; border:1px solid #e7edf4; }
    .bpd-hero h1 { margin:0; font-size:31px; line-height:1.08; letter-spacing:-.45px; font-weight:680; }
    .bpd-hero p { margin:10px 0 0; font-size:15px; font-weight:450; color:#667085; line-height:1.45; }
    .bpd-eta-box { margin-top:16px; background:linear-gradient(180deg, rgba(80,154,230,.11), rgba(80,154,230,.055)); border:1px solid rgba(80,154,230,.22); border-radius:21px; padding:15px; display:grid; gap:5px; }
    .bpd-eta-box span { font-size:12px; text-transform:uppercase; letter-spacing:.45px; font-weight:650; color:#667085; }
    .bpd-eta-box strong { font-size:25px; line-height:1.12; font-weight:680; color:#323841; }
    .bpd-card { background:#fff; border-radius:24px; padding:17px; box-shadow:0 14px 44px rgba(16,24,40,.06); margin-bottom:14px; border:1px solid #e7edf4; }
    .bpd-driver-card { display:flex; gap:13px; align-items:center; }
    .bpd-driver-photo, .bpd-driver-initials { width:54px; height:54px; min-width:54px; max-width:54px; min-height:54px; max-height:54px; aspect-ratio:1/1; border-radius:50%; flex:0 0 54px; overflow:hidden; border:1px solid #e7edf4; box-shadow:0 8px 18px rgba(16,24,40,.06); }
    .bpd-driver-photo { object-fit:cover; object-position:center; display:block; }
    .bpd-driver-initials { display:grid; place-items:center; background:rgba(80,154,230,.10); color:${primaryColour}; font-weight:640; font-size:17px; line-height:1; }
    .bpd-driver-card h2, .bpd-card h2 { margin:0; font-size:20px; line-height:1.18; font-weight:650; letter-spacing:-.18px; }
    .bpd-driver-card p, .bpd-card p { margin:7px 0 0; color:#667085; line-height:1.45; font-weight:400; }
    .bpd-action-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; margin-bottom:14px; }
    .bpd-action-button { border-radius:17px; padding:13px 12px; text-align:center; text-decoration:none; font-weight:650; color:#fff; box-shadow:0 10px 28px rgba(16,24,40,.08); }
    .bpd-email-button { background:#323841; }
    .bpd-call-button { background:${primaryColour}; }
    .bpd-progress-layout { display:grid; grid-template-columns:minmax(0, 1.35fr) minmax(260px, .85fr); gap:14px; align-items:start; }
    .bpd-detail-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(145px, 1fr)); gap:9px; margin-top:13px; }
    .bpd-detail-grid div, .bpd-order-box, .bpd-note-card { background:#f8fafc; border-radius:16px; padding:11px 12px; border:1px solid #edf1f5; }
    .bpd-detail-grid span { display:block; color:#7b8794; font-size:12px; margin-bottom:4px; }
    .bpd-detail-grid strong { display:block; font-size:14px; font-weight:620; color:#323841; }
    .bpd-order-box ul { margin:8px 0 0; padding-left:18px; color:#667085; line-height:1.45; }
    .bpd-proof-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:10px; }
    .bpd-proof-card { display:block; text-decoration:none; color:#323841; border:1px solid #e1e7ef; border-radius:15px; padding:8px; background:#f8fafc; }
    .bpd-proof-card img { width:100%; height:92px; object-fit:cover; border-radius:11px; display:block; }
    .bpd-proof-card span { display:block; margin-top:7px; color:${primaryColour}; font-weight:620; font-size:13px; }
    .bpd-signature-card img { width:100%; max-height:140px; object-fit:contain; border-radius:12px; background:#f8fafc; border:1px solid #e1e7ef; }
    .bpd-success-label { color:#12803b !important; font-weight:650; text-transform:uppercase; font-size:12px; letter-spacing:.45px; }
    .bpd-warning-label { color:#c2410c !important; font-weight:650; text-transform:uppercase; font-size:12px; letter-spacing:.45px; }
    .bpd-card-heading-row { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:14px; }
    .bpd-footer-custom { margin-top:16px; white-space:pre-wrap; color:#667085; font-size:13px; line-height:1.5; }
    @media (max-width: 760px) { .bpd-track-wrap { padding:16px 12px 28px; } .bpd-brand-row { align-items:center; } .bpd-hero { padding:18px; border-radius:24px; } .bpd-hero h1 { font-size:25px; } .bpd-hero p { font-size:14px; } .bpd-eta-box strong { font-size:21px; } .bpd-card { padding:14px; border-radius:21px; } .bpd-driver-card { gap:11px; align-items:flex-start; } .bpd-driver-photo, .bpd-driver-initials { width:48px; height:48px; min-width:48px; max-width:48px; min-height:48px; max-height:48px; flex-basis:48px; font-size:16px; } .bpd-driver-card h2, .bpd-card h2 { font-size:18px; } .bpd-progress-layout, .bpd-action-grid { grid-template-columns:1fr; } }
    ${customCss || ""}
  `;
}

export default function CustomerTrackingPage() {
  const { tracking, settings } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const { route, stop, deliveryGroup, order, collection, isNextDrop, progress } = tracking;
  const isReturn = isReturnTracking(tracking);
  const slot = formatSlot(stop.estimatedArrival, 60, isReturn);
  const stopsBeforeCustomer = normaliseStopsBeforeCustomer(progress.stopsBeforeCustomer);
  const showProof = route.status === "COMPLETED" || stop.status === "DELIVERED";
  const showAttempted = stop.status === "FAILED";
  const progressActive = route.status === "OUT_FOR_DELIVERY" && stop.status === "PENDING" && isNextDrop;
  const autoRefreshActive = route.status === "OUT_FOR_DELIVERY" && stop.status === "PENDING";
  const isRefreshing = revalidator.state !== "idle";
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const proofPhotos = deliveryGroup.proofPhotos?.length ? deliveryGroup.proofPhotos : deliveryGroup.proofPhotoUrl ? [{ id: "primary", url: deliveryGroup.proofPhotoUrl, label: isReturn ? "Return photo" : "Proof photo" }] : collection?.proofPhotoUrl ? [{ id: "return-primary", url: collection.proofPhotoUrl, label: "Return photo" }] : [];
  const primaryColour = settings.primaryColour || "#509AE6";
  const pageTitle = pageHeading({ routeStatus: route.status, stopStatus: stop.status, isNextDrop, settings, isReturn });
  const statusMessage = trackingStatusMessage({ routeStatus: route.status, stopStatus: stop.status, isNextDrop, stopsBeforeCustomer, settings, isReturn });
  const progressPanelMessage = progressMessage(route.status, stop.status, isNextDrop, stopsBeforeCustomer, settings, isReturn);
  const callHref = phoneHref(settings.supportPhone);
  const emailHref = mailHref(settings.supportEmail);
  const progressVisuals = { progressLineColour: settings.progressLineColour, vanLabel: settings.vanLabel, vanIconUrl: settings.vanIconUrl, vanBackgroundColour: settings.vanBackgroundColour, vanTextColour: settings.vanTextColour, homeLabel: settings.homeLabel, homeIconUrl: settings.homeIconUrl, homeBackgroundColour: settings.homeBackgroundColour, homeBorderColour: settings.homeBorderColour, homeTextColour: settings.homeTextColour };
  const detailStatus = showProof ? isReturn ? "Returned" : "Delivered" : showAttempted ? isReturn ? "Return attempted" : "Delivery attempted" : statusLabel(route.status, isReturn);
  const itemLines = isReturn ? collection?.items || [] : order.items;

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

  useEffect(() => {
    if (revalidator.state === "idle") {
      setLastUpdatedAt(new Date());
    }
  }, [revalidator.state, route.status, stop.estimatedArrival, stop.status]);

  useEffect(() => {
    if (!autoRefreshActive) return undefined;

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") {
        revalidator.revalidate();
      }
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [autoRefreshActive, revalidator]);

  function handleRefreshTracking() {
    window.sessionStorage.setItem(TRACKING_REFRESHED_KEY, "true");
    window.location.reload();
  }

  return (
    <main className="bpd-track-page">
      <style>{styles(primaryColour, settings.customCss)}</style>
      <section className="bpd-track-wrap">
        <div className="bpd-brand-row"><div>{settings.logoUrl ? <img className="bpd-logo" src={settings.logoUrl} alt={settings.companyName} /> : <div className="bpd-company-name">{settings.companyName}</div>}</div><button type="button" onClick={handleRefreshTracking} className="bpd-refresh-button">{isRefreshing ? "Updating..." : "Refresh"}</button></div>
        <section className="bpd-hero"><h1>{pageTitle}</h1><p>{statusMessage}</p><div className="bpd-eta-box"><span>{isReturn ? "Estimated return" : "Estimated arrival"}</span><strong>{showProof ? isReturn ? "Returned" : "Delivered" : showAttempted ? isReturn ? "Return attempt recorded" : "Attempt recorded" : slot}</strong><span>{isReturn ? "Return order" : "Order"} {order.shopifyOrderNumber} · Last updated {formatLastUpdatedTime(lastUpdatedAt)}</span>{isRefreshing ? <span>Checking for the latest update</span> : refreshMessage ? <span>{refreshMessage}</span> : null}</div></section>
        <section className="bpd-card bpd-driver-card">{route.driver?.photoUrl ? <img src={route.driver.photoUrl} alt={route.driver.name} className="bpd-driver-photo" /> : <div className="bpd-driver-initials">{customerInitials(route.driver?.name)}</div>}<div><h2>Your driver today is {route.driver?.name || "being confirmed"}</h2><p>{isReturn ? "Your driver will pick up the return items listed below." : settings.roomOfChoiceText}</p></div></section>
        <div className="bpd-action-grid">{callHref ? <a href={callHref} className="bpd-action-button bpd-call-button">Call our team</a> : null}{emailHref ? <a href={emailHref} className="bpd-action-button bpd-email-button">Email our team</a> : null}</div>
        {showProof ? <CompletionCard tracking={tracking} primaryColour={primaryColour} proofPhotos={proofPhotos} /> : null}{showAttempted ? <AttemptedCard tracking={tracking} primaryColour={primaryColour} /> : null}
        <section className="bpd-progress-layout"><div className="bpd-card"><EstimatedVanProgress active={progressActive} estimatedArrival={stop.estimatedArrival} currentTime={currentTime} message={progressPanelMessage} visuals={progressVisuals} /><p>{progressPanelMessage}</p></div><aside className="bpd-card"><h2>{isReturn ? "Return details" : "Delivery details"}</h2><div className="bpd-detail-grid"><div><span>Status</span><strong>{detailStatus}</strong></div><div><span>{isReturn ? "Return date" : "Delivery date"}</span><strong>{formatDate(route.date)}</strong></div><div><span>{isReturn ? "Your return" : "Your drop"}</span><strong>Number {stop.orderIndex}</strong></div><div><span>Before you</span><strong>{stopsBeforeLabel(stopsBeforeCustomer, isNextDrop, isReturn)}</strong></div><div><span>Postcode</span><strong>{deliveryGroup.postcode || "Not shown"}</strong></div><div><span>Route updates</span><strong>{progress.failedStops ? `${progress.failedStops} issue${progress.failedStops === 1 ? "" : "s"}` : "None"}</strong></div></div>{deliveryGroup.deliveryNote || collection?.driverNote ? <div className="bpd-note-card" style={{ marginTop: 12 }}><strong>{isReturn ? "Return note" : "Delivery note"}</strong><p>{collection?.driverNote || deliveryGroup.deliveryNote}</p></div> : null}{deliveryGroup.safePlaceNote ? <div className="bpd-note-card" style={{ marginTop: 12 }}><strong>{isReturn ? "Return safe place note" : "Safe place note"}</strong><p>{deliveryGroup.safePlaceNote}</p></div> : null}{itemLines.length ? <div className="bpd-order-box" style={{ marginTop: 12 }}><strong>{isReturn ? "Items to return" : "Your order"}</strong><ul>{itemLines.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}{showProof && proofPhotos.length ? <div style={{ marginTop: 14 }}><h3>{isReturn ? "Return proof photos" : "Proof photos"}</h3><ProofPhotoThumbs photos={proofPhotos} altPrefix={isReturn ? "Return proof photo" : "Proof photo"} /></div> : null}</aside></section>
        {settings.customFooterHtml ? <div className="bpd-footer-custom">{settings.customFooterHtml}</div> : null}
      </section>
    </main>
  );
}
