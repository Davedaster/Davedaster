import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import { formatEtaSlot } from "../lib/etaSlots.server";
import { getCustomerTracking } from "../lib/tracking.server";

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

function customerStatusMessage(routeStatus: string, stopStatus: string, isNextDrop: boolean, stopsBeforeCustomer: number) {
  if (stopStatus === "DELIVERED") {
    return "Your delivery has been completed.";
  }

  if (stopStatus === "FAILED") {
    return "Delivery update available. Please contact us if you need help.";
  }

  if (routeStatus === "OUT_FOR_DELIVERY" && isNextDrop) {
    return "You are the next delivery. Please keep your phone nearby.";
  }

  if (routeStatus === "OUT_FOR_DELIVERY") {
    return stopsBeforeCustomer === 1
      ? "There is 1 delivery before yours."
      : `There are ${stopsBeforeCustomer} deliveries before yours.`;
  }

  if (routeStatus === "CANCELLED") {
    return "This route is no longer active. Please contact us if you need help.";
  }

  return "Your delivery has been planned and this page will update as the route progresses.";
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
          <h2 style={{ margin: 0, fontSize: 22 }}>Delivery confirmation</h2>
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

export default function CustomerTrackingPage() {
  const { tracking } = useLoaderData<typeof loader>();
  const { route, stop, deliveryGroup, order, isNextDrop, progress } = tracking;
  const slot = formatSlot(stop.estimatedArrival);
  const showProof = route.status === "COMPLETED" || stop.status === "DELIVERED";
  const proofPhotos = deliveryGroup.proofPhotos?.length
    ? deliveryGroup.proofPhotos
    : deliveryGroup.proofPhotoUrl
      ? [{ id: "primary", url: deliveryGroup.proofPhotoUrl, label: "Proof photo" }]
      : [];
  const customerMessage = customerStatusMessage(route.status, stop.status, isNextDrop, progress.stopsBeforeCustomer);

  return (
    <main style={{ minHeight: "100vh", background: "#f4f7fb", fontFamily: "Arial, sans-serif", color: "#323841" }}>
      <section style={{ maxWidth: 980, margin: "0 auto", padding: "28px 16px" }}>
        <div style={{ background: "#ffffff", borderRadius: 18, padding: 22, boxShadow: "0 14px 40px rgba(50,56,65,0.12)", marginBottom: 18 }}>
          <p style={{ margin: "0 0 8px", color: "#509AE6", fontWeight: 700, letterSpacing: 0.4 }}>Bathroom Panels Direct</p>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.15 }}>{showProof ? "Your delivery has been completed" : `We expect to be with you ${slot}`}</h1>
          <p style={{ margin: "12px 0 0", color: "#667085" }}>{formatDate(route.date)} · Order {order.shopifyOrderNumber}</p>
          <p style={{ margin: "14px 0 0", fontWeight: 700, color: isNextDrop || showProof ? "#16a34a" : "#323841" }}>{customerMessage}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", marginTop: 16, paddingTop: 14, borderTop: "1px solid #e5e7eb" }}>
            <p style={{ margin: 0, color: "#667085", fontSize: 14 }}>Refresh this page for the latest driver update.</p>
            <button type="button" onClick={() => window.location.reload()} style={{ border: "1px solid #509AE6", color: "#ffffff", background: "#509AE6", borderRadius: 999, padding: "9px 14px", fontWeight: 800, cursor: "pointer" }}>
              Refresh tracking
            </button>
          </div>
        </div>

        {showProof ? <DeliveryConfirmationCard tracking={tracking} /> : null}

        <div style={{ background: "#ffffff", borderRadius: 18, padding: 18, boxShadow: "0 8px 24px rgba(50,56,65,0.08)", marginBottom: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 20 }}>Route progress</h2>
              <p style={{ margin: "6px 0 0", color: "#667085" }}>{progress.completedStops} of {progress.totalStops} drops completed</p>
            </div>
            <strong style={{ color: "#509AE6", fontSize: 22 }}>{progress.progressPercent}%</strong>
          </div>
          <div style={{ height: 12, borderRadius: 999, background: "#e5e7eb", overflow: "hidden" }}>
            <div style={{ width: `${progress.progressPercent}%`, height: "100%", background: "#509AE6", borderRadius: 999 }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginTop: 14 }}>
            <div style={{ background: "#f8fafc", borderRadius: 14, padding: 12 }}><dt style={{ color: "#667085", fontSize: 13 }}>Your drop</dt><dd style={{ margin: 0, fontWeight: 700 }}>Number {stop.orderIndex}</dd></div>
            <div style={{ background: "#f8fafc", borderRadius: 14, padding: 12 }}><dt style={{ color: "#667085", fontSize: 13 }}>Before you</dt><dd style={{ margin: 0, fontWeight: 700 }}>{progress.stopsBeforeCustomer}</dd></div>
            <div style={{ background: "#f8fafc", borderRadius: 14, padding: 12 }}><dt style={{ color: "#667085", fontSize: 13 }}>Remaining</dt><dd style={{ margin: 0, fontWeight: 700 }}>{progress.remainingStops}</dd></div>
            <div style={{ background: "#f8fafc", borderRadius: 14, padding: 12 }}><dt style={{ color: "#667085", fontSize: 13 }}>Updates</dt><dd style={{ margin: 0, fontWeight: 700 }}>{progress.failedStops}</dd></div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(280px, 0.8fr)", gap: 18 }}>
          <div style={{ background: "#ffffff", borderRadius: 18, padding: 18, boxShadow: "0 8px 24px rgba(50,56,65,0.08)" }}>
            <div style={{ minHeight: 360, borderRadius: 14, background: "linear-gradient(180deg, #e8f3ff 0%, #d6ecff 100%)", border: "1px solid #d0d5dd", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 18, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <span style={{ background: "#ffffff", color: "#323841", padding: "7px 10px", borderRadius: 999, fontSize: 13, fontWeight: 700 }}>Map view</span>
                <span style={{ background: isNextDrop ? "#16a34a" : "#ffffff", color: isNextDrop ? "#ffffff" : "#323841", padding: "7px 10px", borderRadius: 999, fontSize: 13, fontWeight: 700 }}>{isNextDrop ? "Live tracking active" : "Live tracking hidden"}</span>
              </div>

              <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden="true">
                <path d="M52 4 C42 10 39 22 41 32 C31 36 30 50 37 59 C29 65 31 79 41 84 C52 90 66 84 68 72 C78 66 78 51 69 44 C72 31 66 15 52 4 Z" fill="#eef7ef" stroke="#b7d7c2" strokeWidth="1" />
                <path d="M46 54 C38 59 38 72 47 76 C56 80 65 74 64 64 C63 55 54 50 46 54 Z" fill="#e5f4e9" stroke="#b7d7c2" strokeWidth="0.8" />
              </svg>

              <div style={{ position: "absolute", left: "58%", top: "50%", transform: "translate(-50%, -100%)" }}>
                <div style={{ width: 36, height: 36, borderRadius: "50% 50% 50% 0", transform: "rotate(-45deg)", background: "#509AE6", border: "3px solid white", boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
                  <span style={{ display: "grid", placeItems: "center", height: "100%", transform: "rotate(45deg)", color: "#ffffff", fontSize: 14, fontWeight: 700 }}>You</span>
                </div>
              </div>

              {isNextDrop ? <div style={{ position: "absolute", left: "35%", top: "42%", transform: "translate(-50%, -50%)", background: "#323841", color: "#ffffff", padding: "10px 12px", borderRadius: 12, fontWeight: 700 }}>Driver nearby</div> : null}
            </div>
          </div>

          <aside style={{ background: "#ffffff", borderRadius: 18, padding: 18, boxShadow: "0 8px 24px rgba(50,56,65,0.08)" }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 20 }}>Delivery details</h2>
            <dl style={{ margin: 0, display: "grid", gap: 12 }}>
              <div><dt style={{ color: "#667085", fontSize: 13 }}>Status</dt><dd style={{ margin: 0, fontWeight: 700 }}>{showProof ? "Delivered" : statusLabel(route.status)}</dd></div>
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
