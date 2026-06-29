import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useEffect, useState } from "react";

import { CustomerEtaConfidenceCard } from "../components/CustomerEtaConfidenceCard";
import { CustomerSupportCard } from "../components/CustomerSupportCard";
import { EstimatedVanProgress } from "../components/EstimatedVanProgress";
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

  const tracking = await getCustomerTracking(routeId, shopifyOrderId);

  if (!tracking) {
    throw new Response("Tracking details not found", { status: 404 });
  }

  return json({ tracking });
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
  if (!value) {
    return "Not recorded yet";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatLastUpdatedTime(value: Date | null) {
  if (!value) {
    return "Checking now";
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatSlot(estimatedArrival: string | Date | null, slotMinutes = 60) {
  if (!estimatedArrival) {
    return "Your delivery slot is being confirmed";
  }

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

function trackingStatusLabel(routeStatus: string, stopStatus: string, progressActive: boolean) {
  if (stopStatus === "DELIVERED" || routeStatus === "COMPLETED") return "Delivery completed";
  if (stopStatus === "FAILED") return "Delivery attempted";
  if (routeStatus === "CANCELLED") return "Route inactive";
  if (progressActive) return "Delivery progress active";
  if (routeStatus === "OUT_FOR_DELIVERY") return "Route active, progress not live yet";
  return "Progress not live yet";
}

function normaliseStopsBeforeCustomer(stopsBeforeCustomer: number) {
  return Math.max(0, Number.isFinite(stopsBeforeCustomer) ? stopsBeforeCustomer : 0);
}

function customerStatusMessage(routeStatus: string, stopStatus: string, isNextDrop: boolean, stopsBeforeCustomer: number) {
  const dropsBefore = normaliseStopsBeforeCustomer(stopsBeforeCustomer);

  if (stopStatus === "DELIVERED") {
    return "Your panel delivery has been completed.";
  }

  if (stopStatus === "FAILED") {
    return "We attempted your panel delivery and an update has been recorded below.";
  }

  if (routeStatus === "OUT_FOR_DELIVERY" && (isNextDrop || dropsBefore === 0)) {
    return "Your panel delivery is next. Please keep your phone nearby.";
  }

  if (routeStatus === "OUT_FOR_DELIVERY") {
    return dropsBefore === 1
      ? "There is 1 panel delivery before yours."
      : `There are ${dropsBefore} panel deliveries before yours.`;
  }

  if (routeStatus === "CANCELLED") {
    return "This route is no longer active. Please contact us if you need help.";
  }

  return "Your panel delivery has been planned and this page will update as the route progresses.";
}

function progressSummary(routeStatus: string, stopStatus: string, isNextDrop: boolean, stopsBeforeCustomer: number) {
  const dropsBefore = normaliseStopsBeforeCustomer(stopsBeforeCustomer);

  if (stopStatus === "DELIVERED") return "Panel delivery completed. Delivery progress has ended.";
  if (stopStatus === "FAILED") return "Panel delivery attempted. Delivery progress has ended.";
  if (routeStatus !== "OUT_FOR_DELIVERY") return "Your route is planned and will update once the driver starts.";
  if (isNextDrop || dropsBefore === 0) return "You are next. Delivery progress is active.";
  if (dropsBefore === 1) return "1 panel delivery before yours. Delivery progress will activate when you are next.";
  return `${dropsBefore} panel deliveries before yours. Delivery progress will activate when you are next.`;
}

function stopsBeforeLabel(stopsBeforeCustomer: number, isNextDrop: boolean) {
  const dropsBefore = normaliseStopsBeforeCustomer(stopsBeforeCustomer);

  if (isNextDrop || dropsBefore === 0) return "You are next";
  if (dropsBefore === 1) return "1 panel delivery";
  return `${dropsBefore} panel deliveries`;
}

function liveTrackingMessage(routeStatus: string, stopStatus: string, isNextDrop: boolean, stopsBeforeCustomer: number) {
  const dropsBefore = normaliseStopsBeforeCustomer(stopsBeforeCustomer);

  if (stopStatus === "DELIVERED") return "This panel delivery is complete, so delivery progress has ended.";
  if (stopStatus === "FAILED") return "This panel delivery has been attempted, so delivery progress has ended.";
  if (routeStatus !== "OUT_FOR_DELIVERY") return "Delivery progress will become available once the driver is out for delivery and your panel delivery is next.";
  if (isNextDrop || dropsBefore === 0) return "Your driver is on the way. Keep this page open for the latest update.";
  if (dropsBefore === 1) return "For privacy, the progress tracker appears when there is 1 panel delivery left and you become the next delivery.";
  return "For privacy, the progress tracker appears when your panel delivery becomes the next delivery.";
}

function buildMapUrl(location?: { latitude: number; longitude: number } | null) {
  if (!location) {
    return null;
  }

  return `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
}

function ProofPhotoThumbs({ photos }: { photos: Array<{ id: string; url: string; label?: string | null }> }) {
  if (!photos.length) {
    return null;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
      {photos.map((photo, index) => (
        <a
          key={photo.id}
          href={photo.url}
          target="_blank"
          rel="noreferrer"
          style={{ display: "block", color: "#323841", textDecoration: "none", border: "1px solid #d0d5dd", borderRadius: 14, padding: 8, background: "#ffffff" }}
        >
          <img
            src={photo.url}
            alt={photo.label || `Delivery photo ${index + 1}`}
            style={{ width: "100%", height: 92, objectFit: "cover", borderRadius: 10, display: "block" }}
          />
          <span style={{ display: "block", marginTop: 7, color: "#509AE6", fontWeight: 700, fontSize: 13 }}>
            View photo {index + 1}
          </span>
        </a>
      ))}
    </div>
  );
}

function DeliveryConfirmationCard({ tracking }: { tracking: Awaited<ReturnType<typeof getCustomerTracking>> }) {
  if (!tracking) {
    return null;
  }

  const { stop, deliveryGroup } = tracking;
  const pod = deliveryGroup.proofOfDelivery;
  const mapUrl = buildMapUrl(pod.location);
  const deliveredAt = stop.actualArrival || pod.receiverMark?.createdAt || deliveryGroup.proofPhotos[0]?.createdAt || null;

  return (
    <div style={{ marginBottom: 18, background: "#ffffff", borderRadius: 18, padding: 18, boxShadow: "0 8px 24px rgba(50,56,65,0.08)", border: "1px solid #dcfce7" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <p style={{ margin: "0 0 6px", color: "#16a34a", fontWeight: 800, letterSpacing: 0.4 }}>Delivered</p>
          <h2 style={{ margin: 0, fontSize: 22 }}>Panel delivery confirmation</h2>
        </div>
        <button type="button" onClick={() => window.print()} style={{ border: "1px solid #509AE6", color: "#509AE6", background: "#ffffff", borderRadius: 999, padding: "9px 13px", fontWeight: 800, cursor: "pointer" }}>
          Download proof
        </button>
      </div>

      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <div style={{ background: "#f8fafc", borderRadius: 14, padding: 12 }}><dt style={{ color: "#667085", fontSize: 13 }}>Delivered on</dt><dd style={{ margin: 0, fontWeight: 800 }}>{formatDateTime(deliveredAt)}</dd></div>
        <div style={{ background: "#f8fafc", borderRadius: 14, padding: 12 }}><dt style={{ color: "#667085", fontSize: 13 }}>Received by</dt><dd style={{ margin: 0, fontWeight: 800 }}>{pod.receiverName || "Recorded by driver"}</dd></div>
        <div style={{ background: "#f8fafc", borderRadius: 14, padding: 12 }}><dt style={{ color: "#667085", fontSize: 13 }}>Location</dt><dd style={{ margin: 0, fontWeight: 800 }}>{mapUrl ? <a href={mapUrl} target="_blank" rel="noreferrer" style={{ color: "#509AE6" }}>View on map</a> : "Not recorded"}</dd></div>
      </dl>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 14 }}>
        {deliveryGroup.proofPhotos.length ? (
          <div>
            <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Delivery photos</h3>
            <ProofPhotoThumbs photos={deliveryGroup.proofPhotos} />
          </div>
        ) : null}

        {pod.receiverMark ? (
          <div>
            <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Receiver mark</h3>
            <a href={pod.receiverMark.url} target="_blank" rel="noreferrer" style={{ display: "block", border: "1px solid #d0d5dd", borderRadius: 14, padding: 8, background: "#ffffff" }}>
              <img src={pod.receiverMark.url} alt="Receiver mark" style={{ width: "100%", height: 120, objectFit: "contain", borderRadius: 10, background: "#f8fafc", display: "block" }} />
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FailedDeliveryCard({ tracking }: { tracking: Awaited<ReturnType<typeof getCustomerTracking>> }) {
  if (!tracking) {
    return null;
  }

  const { stop, deliveryGroup } = tracking;
  const attemptedAt = stop.actualArrival || deliveryGroup.proofPhotos[0]?.createdAt || null;
  const note = deliveryGroup.deliveryNote || deliveryGroup.safePlaceNote || null;

  return (
    <div style={{ marginBottom: 18, background: "#ffffff", borderRadius: 18, padding: 18, boxShadow: "0 8px 24px rgba(50,56,65,0.08)", border: "1px solid #fed7aa" }}>
      <p style={{ margin: "0 0 6px", color: "#ea580c", fontWeight: 800, letterSpacing: 0.4 }}>Panel delivery attempted</p>
      <h2 style={{ margin: "0 0 10px", fontSize: 22 }}>We could not complete your delivery this time</h2>
      <p style={{ margin: "0 0 14px", color: "#667085" }}>
        Our team has recorded an attempted panel delivery. Please contact us and we will help arrange the next step.
      </p>

      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        <div style={{ background: "#fff7ed", borderRadius: 14, padding: 12 }}><dt style={{ color: "#9a3412", fontSize: 13 }}>Attempt recorded</dt><dd style={{ margin: 0, fontWeight: 800 }}>{formatDateTime(attemptedAt)}</dd></div>
        <div style={{ background: "#fff7ed", borderRadius: 14, padding: 12 }}><dt style={{ color: "#9a3412", fontSize: 13 }}>What happens next</dt><dd style={{ margin: 0, fontWeight: 800 }}>Please contact the team</dd></div>
      </dl>

      {note ? (
        <div style={{ marginTop: 14, padding: 14, background: "#f8fafc", borderRadius: 14 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Driver note</h3>
          <p style={{ margin: 0, color: "#667085", whiteSpace: "pre-wrap" }}>{note}</p>
        </div>
      ) : null}

      {deliveryGroup.proofPhotos.length ? (
        <div style={{ marginTop: 14 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Attempt photos</h3>
          <ProofPhotoThumbs photos={deliveryGroup.proofPhotos} />
        </div>
      ) : null}
    </div>
  );
}

export default function CustomerTrackingPage() {
  const { tracking } = useLoaderData<typeof loader>();
  const { route, stop, deliveryGroup, order, isNextDrop, progress } = tracking;
  const slot = formatSlot(stop.estimatedArrival);
  const stopsBeforeCustomer = normaliseStopsBeforeCustomer(progress.stopsBeforeCustomer);
  const showProof = route.status === "COMPLETED" || stop.status === "DELIVERED";
  const showFailedDelivery = stop.status === "FAILED";
  const progressActive = route.status === "OUT_FOR_DELIVERY" && stop.status === "PENDING" && isNextDrop;
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const proofPhotos = deliveryGroup.proofPhotos?.length
    ? deliveryGroup.proofPhotos
    : deliveryGroup.proofPhotoUrl
      ? [{ id: "primary", url: deliveryGroup.proofPhotoUrl, label: "Proof photo" }]
      : [];
  const customerMessage = customerStatusMessage(route.status, stop.status, isNextDrop, stopsBeforeCustomer);
  const pageTitle = showProof
    ? "Your panel delivery has been completed"
    : showFailedDelivery
      ? "We attempted your panel delivery"
      : `We expect to be with you ${slot}`;
  const customerProgressSummary = progressSummary(route.status, stop.status, isNextDrop, stopsBeforeCustomer);
  const customerLiveTrackingMessage = liveTrackingMessage(route.status, stop.status, isNextDrop, stopsBeforeCustomer);

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
    <main style={{ minHeight: "100vh", background: "#f4f7fb", fontFamily: "Arial, sans-serif", color: "#323841" }}>
      <section style={{ maxWidth: 980, margin: "0 auto", padding: "28px 16px" }}>
        <div style={{ background: "#ffffff", borderRadius: 18, padding: 22, boxShadow: "0 14px 40px rgba(50,56,65,0.12)", marginBottom: 18 }}>
          <p style={{ margin: "0 0 8px", color: "#509AE6", fontWeight: 700, letterSpacing: 0.4 }}>Bathroom Panels Direct</p>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.15 }}>{pageTitle}</h1>
          <p style={{ margin: "12px 0 0", color: "#667085" }}>{formatDate(route.date)} · Order {order.shopifyOrderNumber}</p>
          <p style={{ margin: "14px 0 0", fontWeight: 700, color: isNextDrop || showProof ? "#16a34a" : showFailedDelivery ? "#ea580c" : "#323841" }}>{customerMessage}</p>
          <div style={{ marginTop: 16, padding: 14, borderTop: "1px solid #e5e7eb", background: "#f8fafc", borderRadius: 14 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <p style={{ margin: "0 0 4px", color: "#509AE6", fontSize: 13, fontWeight: 800 }}>Tracking status</p>
                <p style={{ margin: 0, color: "#667085", fontSize: 14 }}>
                  Last updated {formatLastUpdatedTime(lastUpdatedAt)} · {trackingStatusLabel(route.status, stop.status, progressActive)}
                </p>
                {refreshMessage ? <p style={{ margin: "6px 0 0", color: "#16a34a", fontSize: 13, fontWeight: 800 }}>{refreshMessage}</p> : null}
              </div>
              <button type="button" onClick={handleRefreshTracking} style={{ border: "1px solid #509AE6", color: "#ffffff", background: "#509AE6", borderRadius: 999, padding: "9px 14px", fontWeight: 800, cursor: "pointer" }}>
                Refresh tracking
              </button>
            </div>
          </div>
        </div>

        {showProof ? <DeliveryConfirmationCard tracking={tracking} /> : null}
        {showFailedDelivery ? <FailedDeliveryCard tracking={tracking} /> : null}
        {!showProof && !showFailedDelivery ? (
          <CustomerEtaConfidenceCard
            routeStatus={route.status}
            isNextDrop={isNextDrop}
            stopsBeforeCustomer={stopsBeforeCustomer}
            estimatedSlot={slot}
          />
        ) : null}
        <div style={{ marginBottom: 18 }}>
          <CustomerSupportCard />
        </div>

        <div style={{ background: "#ffffff", borderRadius: 18, padding: 18, boxShadow: "0 8px 24px rgba(50,56,65,0.08)", marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20 }}>Route progress</h2>
              <p style={{ margin: "6px 0 0", color: "#667085" }}>{customerProgressSummary}</p>
            </div>
            <strong style={{ color: "#509AE6", fontSize: 22 }}>{progress.progressPercent}%</strong>
          </div>
          <div style={{ height: 12, borderRadius: 999, background: "#e5e7eb", overflow: "hidden" }}>
            <div style={{ width: `${progress.progressPercent}%`, height: "100%", background: "#509AE6", borderRadius: 999 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginTop: 14 }}>
            <div style={{ background: "#f8fafc", borderRadius: 14, padding: 12 }}><dt style={{ color: "#667085", fontSize: 13 }}>Your drop</dt><dd style={{ margin: 0, fontWeight: 700 }}>Number {stop.orderIndex}</dd></div>
            <div style={{ background: "#f8fafc", borderRadius: 14, padding: 12 }}><dt style={{ color: "#667085", fontSize: 13 }}>Before you</dt><dd style={{ margin: 0, fontWeight: 700 }}>{stopsBeforeLabel(stopsBeforeCustomer, isNextDrop)}</dd></div>
            <div style={{ background: "#f8fafc", borderRadius: 14, padding: 12 }}><dt style={{ color: "#667085", fontSize: 13 }}>Remaining route</dt><dd style={{ margin: 0, fontWeight: 700 }}>{progress.remainingStops} drops</dd></div>
            <div style={{ background: "#f8fafc", borderRadius: 14, padding: 12 }}><dt style={{ color: "#667085", fontSize: 13 }}>Route updates</dt><dd style={{ margin: 0, fontWeight: 700 }}>{progress.failedStops ? `${progress.failedStops} issue${progress.failedStops === 1 ? "" : "s"}` : "None"}</dd></div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(280px, 0.8fr)", gap: 18 }}>
          <div style={{ background: "#ffffff", borderRadius: 18, padding: 18, boxShadow: "0 8px 24px rgba(50,56,65,0.08)" }}>
            <EstimatedVanProgress active={progressActive} estimatedArrival={stop.estimatedArrival} currentTime={currentTime} message={customerLiveTrackingMessage} />
            <p style={{ margin: "12px 0 0", color: "#667085", fontSize: 14 }}>{customerLiveTrackingMessage}</p>
          </div>

          <aside style={{ background: "#ffffff", borderRadius: 18, padding: 18, boxShadow: "0 8px 24px rgba(50,56,65,0.08)" }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Delivery details</h2>
            <dl style={{ margin: 0, display: "grid", gap: 12 }}>
              <div><dt style={{ color: "#667085", fontSize: 13 }}>Status</dt><dd style={{ margin: 0, fontWeight: 700 }}>{showProof ? "Delivered" : showFailedDelivery ? "Delivery attempted" : statusLabel(route.status)}</dd></div>
              <div><dt style={{ color: "#667085", fontSize: 13 }}>Driver</dt><dd style={{ margin: 0, fontWeight: 700 }}>{route.driver?.name || "To be confirmed"}</dd></div>
              <div><dt style={{ color: "#667085", fontSize: 13 }}>Postcode</dt><dd style={{ margin: 0, fontWeight: 700 }}>{deliveryGroup.postcode || "Not shown"}</dd></div>
              <div><dt style={{ color: "#667085", fontSize: 13 }}>Delivery note</dt><dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{deliveryGroup.deliveryNote || "No delivery note added"}</dd></div>
              {deliveryGroup.safePlaceNote ? <div><dt style={{ color: "#667085", fontSize: 13 }}>Safe place note</dt><dd style={{ margin: 0 }}>{deliveryGroup.safePlaceNote}</dd></div> : null}
            </dl>

            {order.items.length ? (
              <div style={{ marginTop: 18, padding: 14, background: "#f8fafc", borderRadius: 14 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Your order</h3>
                <ul style={{ margin: 0, paddingLeft: 20, color: "#667085" }}>
                  {order.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ) : null}

            <div style={{ marginTop: 18, padding: 14, background: "#f8fafc", borderRadius: 14 }}>
              <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Room of choice delivery</h3>
              <p style={{ margin: 0, color: "#667085" }}>Our own team will bring your order to a room of your choice where access allows.</p>
            </div>

            {showProof && proofPhotos.length ? (
              <div style={{ marginTop: 18 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>Proof of delivery</h3>
                <p style={{ margin: "0 0 10px", color: "#667085", fontSize: 14 }}>Tap a photo to view it full size.</p>
                <ProofPhotoThumbs photos={proofPhotos} />
              </div>
            ) : null}
          </aside>
        </div>
      </section>
    </main>
  );
}
