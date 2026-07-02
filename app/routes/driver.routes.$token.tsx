import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useRevalidator, useSubmit } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent, PointerEvent } from "react";

import { RouteMap } from "../components/RouteMap";
import { getOfflineShopifyAdmin } from "../lib/driverShopifyAdmin.server";
import { buildWazeUrl } from "../lib/waze";
import {
  canStartDriverRoute,
  completeDriverStopFromToken,
  getDriverRouteByToken,
  markDriverStopMissedFromToken,
  startDriverRouteFromToken,
} from "../lib/driverRouteAccess.server";
import { formatEtaSlot } from "../lib/etaSlots";
import { isProofPhotoStorageEnabled, uploadProofPhoto } from "../lib/proofPhotoStorage.server";
import { sendFirstOutForDeliveryNotification } from "../lib/routeNotifications.server";
import { recalculateFirstPendingEtaFromPoint } from "../lib/trafficEta.server";

const FIRST_OUT_FOR_DELIVERY_LEAD_MS = 60 * 60 * 1000;
const DRIVER_ROUTE_REFRESH_MS = 15000;

function isEtaDueForFirstNotification(value: string | Date | null | undefined) {
  if (!value) return true;
  const etaMs = new Date(value).getTime();
  if (!Number.isFinite(etaMs)) return true;
  return etaMs - Date.now() <= FIRST_OUT_FOR_DELIVERY_LEAD_MS;
}

function numberFromFormValue(value: FormDataEntryValue | null) {
  const parsed = Number(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const token = params.token;

  if (!token) {
    throw new Response("Driver route not found", { status: 404 });
  }

  const route = await getDriverRouteByToken(token);

  if (!route) {
    throw new Response("Driver route not found", { status: 404 });
  }

  return json({ route, canStart: canStartDriverRoute(route.date), proofPhotoStorageEnabled: await isProofPhotoStorageEnabled() });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const token = params.token;

  if (!token) {
    throw new Response("Driver route not found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "startRoute");

  try {
    if (intent === "startRoute") {
      const routeBeforeStart = await getDriverRouteByToken(token);
      const route = await startDriverRouteFromToken(token);
      const startLat = numberFromFormValue(formData.get("startLat"));
      const startLng = numberFromFormValue(formData.get("startLng"));
      let firstEta = routeBeforeStart?.stops.find((stop) => stop.status === "PENDING")?.estimatedArrival || null;

      if (startLat !== null && startLng !== null) {
        const updatedEta = await recalculateFirstPendingEtaFromPoint(route.id, { latitude: startLat, longitude: startLng });
        if (updatedEta.estimatedArrival) {
          firstEta = updatedEta.estimatedArrival;
        }
      }

      if (isEtaDueForFirstNotification(firstEta)) {
        await sendFirstOutForDeliveryNotification(route.id);
      }

      return redirect(`/driver/routes/${token}`);
    }

    const stopId = String(formData.get("stopId") || "").trim();

    if (!stopId) {
      throw new Error("Stop is missing.");
    }

    const admin = await getOfflineShopifyAdmin();

    if (intent === "completeStop") {
      const proofPhotoFiles = formData.getAll("proofPhotoFiles").filter((file): file is File => file instanceof File && file.size > 0);
      const fallbackProofPhotoUrl = String(formData.get("proofPhotoUrl") || "").trim();
      const proofPhotoUrls = fallbackProofPhotoUrl ? [fallbackProofPhotoUrl] : [];
      const podLatValue = numberFromFormValue(formData.get("podLat"));
      const podLngValue = numberFromFormValue(formData.get("podLng"));

      for (const proofPhotoFile of proofPhotoFiles) {
        proofPhotoUrls.push(await uploadProofPhoto(proofPhotoFile, stopId));
      }

      await completeDriverStopFromToken({
        token,
        stopId,
        admin,
        proofPhotoUrls,
        deliveryNote: String(formData.get("deliveryNote") || "").trim(),
        safePlaceNote: String(formData.get("safePlaceNote") || "").trim(),
        leftInSafePlace: String(formData.get("leftInSafePlace") || "") === "true",
        podImage: String(formData.get("podImage") || "").trim(),
        podName: String(formData.get("podName") || "").trim(),
        podTicked: String(formData.get("podTicked") || "") === "true",
        podLat: podLatValue,
        podLng: podLngValue,
      });

      return redirect(`/driver/routes/${token}#next-stop`);
    }

    if (intent === "missedStop") {
      await markDriverStopMissedFromToken({
        token,
        stopId,
        admin,
        reason: String(formData.get("failedReason") || "").trim(),
        note: String(formData.get("failedNote") || "").trim(),
      });

      return redirect(`/driver/routes/${token}#next-stop`);
    }

    return redirect(`/driver/routes/${token}`);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Driver route action failed." }, { status: 400 });
  }
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function formatStart(value: string | Date) {
  if (typeof value === "string" && /^\d{2}:\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "Time pending");

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatSlot(estimatedArrival: string | Date | null) {
  if (!estimatedArrival) return "Target arrival pending";
  const start = new Date(estimatedArrival);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return formatEtaSlot(start, end);
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ").toLowerCase();
}

function splitLineItems(summary?: string | null) {
  return (summary || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function removeUkTrunkZero(digits: string) {
  return digits.startsWith("440") ? `44${digits.slice(3)}` : digits;
}

function tidyPhone(phone?: string | null) {
  const compact = (phone || "").trim().replace(/[^\d+]/g, "");
  if (!compact) return "";
  if (compact.startsWith("+")) return `+${removeUkTrunkZero(compact.slice(1).replace(/\D/g, ""))}`;
  const digits = compact.replace(/\D/g, "");
  if (digits.startsWith("00")) return `+${removeUkTrunkZero(digits.slice(2))}`;
  if (digits.startsWith("44")) return `+${removeUkTrunkZero(digits)}`;
  if (digits.startsWith("0")) return `+44${digits.slice(1)}`;
  return digits;
}

function cleanDeliveryAddress(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !["gb", "england", "united kingdom", "uk"].includes(part.toLowerCase()))
    .join(", ");
}

function highlightItemText(item: string) {
  const wordsToHighlight = new Set(["white", "grey", "gray", "beige", "black", "chrome", "clear", "anthracite", "silver", "matt", "matte", "gloss", "marble", "concrete", "sparkle", "herringbone", "metro", "tile", "natural"]);
  const parts = item.split(/(\s+)/);

  return parts.map((part, index) => {
    const clean = part.toLowerCase().replace(/[^a-z]/g, "");
    return wordsToHighlight.has(clean) ? <strong key={`${part}-${index}`}>{part}</strong> : <span key={`${part}-${index}`}>{part}</span>;
  });
}

function buttonStyle(background: string, color = "#ffffff") {
  return { border: 0, borderRadius: 16, padding: "15px 14px", background, color, fontSize: 16, fontWeight: 900, textAlign: "center" as const, textDecoration: "none", boxShadow: "0 6px 16px rgba(0,0,0,0.14)" };
}

function secondaryButtonStyle() {
  return { border: "1px solid #d0d5dd", borderRadius: 16, padding: "14px 12px", background: "#ffffff", color: "#323841", fontSize: 15, fontWeight: 900, textAlign: "center" as const, textDecoration: "none" };
}

function StartRouteForm({ canStart, routeDate }: { canStart: boolean; routeDate: string | Date }) {
  const submit = useSubmit();
  const [starting, setStarting] = useState(false);

  function submitForm(form: HTMLFormElement) {
    submit(form, { method: "post" });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    if (!canStart || starting) return;
    setStarting(true);

    const latInput = form.elements.namedItem("startLat") as HTMLInputElement | null;
    const lngInput = form.elements.namedItem("startLng") as HTMLInputElement | null;

    if (!("geolocation" in navigator)) {
      submitForm(form);
      return;
    }

    navigator.geolocation.getCurrentPosition((position) => {
      if (latInput) latInput.value = String(position.coords.latitude);
      if (lngInput) lngInput.value = String(position.coords.longitude);
      submitForm(form);
    }, () => submitForm(form), { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 });
  }

  return (
    <Form method="post" onSubmit={handleSubmit}>
      <input type="hidden" name="intent" value="startRoute" />
      <input type="hidden" name="startLat" value="" />
      <input type="hidden" name="startLng" value="" />
      <button type="submit" disabled={!canStart || starting} style={{ width: "100%", ...buttonStyle(canStart && !starting ? "#16a34a" : "#d0d5dd", canStart && !starting ? "#ffffff" : "#667085"), fontSize: 22, padding: "18px 16px" }}>{starting ? "Starting route..." : "Start route"}</button>
      <p style={{ margin: "10px 0 0", color: "#667085", fontWeight: 800 }}>{canStart ? "We will check your current location once to improve the first drop ETA." : `This route can only be started on ${formatDate(routeDate)}.`}</p>
    </Form>
  );
}

function SignatureModal({ customerName, disabled, onSave, onClose }: { customerName: string; disabled: boolean; onSave: (image: string) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasSignature, setHasSignature] = useState(false);

  function getCanvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * canvas.width, y: ((event.clientY - rect.top) / rect.height) * canvas.height };
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    lastPointRef.current = getCanvasPoint(event);
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled || !lastPointRef.current) return;
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    const nextPoint = getCanvasPoint(event);
    if (!context) return;
    context.lineWidth = 5;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111827";
    context.beginPath();
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    context.lineTo(nextPoint.x, nextPoint.y);
    context.stroke();
    lastPointRef.current = nextPoint;
    setHasSignature(true);
  }

  function handlePointerUp(event: PointerEvent<HTMLCanvasElement>) {
    lastPointRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }

  function submitSignature() {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) return;
    onSave(canvas.toDataURL("image/png"));
    onClose();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.92)", zIndex: 9999, padding: 14, display: "grid", alignItems: "center" }}>
      <div style={{ background: "#ffffff", borderRadius: 22, padding: 16, display: "grid", gap: 12, maxWidth: 900, margin: "0 auto", width: "100%" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24 }}>Customer signature</h2>
          <p style={{ margin: "6px 0 0", color: "#667085", fontWeight: 700 }}>Turn the phone sideways if possible, then ask the customer to sign in the white box.</p>
        </div>
        <p style={{ margin: 0, background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, fontWeight: 800, lineHeight: 1.45 }}>By signing, I, {customerName || "the customer"}, confirm that the items received today match my order and have been received in good condition.</p>
        <canvas ref={canvasRef} width={900} height={360} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} style={{ width: "100%", height: "min(42vh, 360px)", border: "2px solid #111827", borderRadius: 16, background: "#ffffff", touchAction: "none" }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button type="button" onClick={clearSignature} style={secondaryButtonStyle()}>Clear</button>
          <button type="button" onClick={submitSignature} disabled={!hasSignature} style={buttonStyle(hasSignature ? "#16a34a" : "#d0d5dd", hasSignature ? "#ffffff" : "#667085")}>Submit signature</button>
        </div>
        <button type="button" onClick={onClose} style={{ ...secondaryButtonStyle(), borderRadius: 12 }}>Cancel</button>
      </div>
    </div>
  );
}

function DriverStopActions({ stopId, customerName, isDisabled, routeStarted, proofPhotoStorageEnabled, customerSafePlaceNote }: { stopId: string; customerName: string; isDisabled: boolean; routeStarted: boolean; proofPhotoStorageEnabled: boolean; customerSafePlaceNote?: string | null }) {
  const [deliveryMode, setDeliveryMode] = useState<"customer" | "safe" | "missed" | null>(null);
  const [proofPhotoCount, setProofPhotoCount] = useState(0);
  const [proofPhotoUrl, setProofPhotoUrl] = useState("");
  const [proofPreviewUrl, setProofPreviewUrl] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [safePlaceNote, setSafePlaceNote] = useState(customerSafePlaceNote || "");
  const [podImage, setPodImage] = useState("");
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [failedReason, setFailedReason] = useState("No answer");
  const [failedNote, setFailedNote] = useState("");
  const [podLat, setPodLat] = useState("");
  const [podLng, setPodLng] = useState("");
  const updatesDisabled = isDisabled || !routeStarted;
  const hasProofPhoto = proofPhotoCount > 0 || proofPhotoUrl.trim().length > 0;
  const canCompleteCustomer = !updatesDisabled && deliveryMode === "customer" && hasProofPhoto && podImage.length > 0;
  const canCompleteSafePlace = !updatesDisabled && deliveryMode === "safe" && hasProofPhoto && safePlaceNote.trim().length > 0;

  useEffect(() => {
    if (!customerSafePlaceNote || safePlaceNote.trim()) return;
    setSafePlaceNote(customerSafePlaceNote);
  }, [customerSafePlaceNote, safePlaceNote]);

  useEffect(() => {
    if (!routeStarted || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition((position) => {
      setPodLat(String(position.coords.latitude));
      setPodLng(String(position.coords.longitude));
    }, () => undefined, { enableHighAccuracy: true, timeout: 5000 });
  }, [routeStarted]);

  function handleProofPhotoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.currentTarget.files;
    setProofPhotoCount(files?.length || 0);
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    setProofPreviewUrl(files?.[0] ? URL.createObjectURL(files[0]) : "");
  }

  if (!routeStarted) return <p style={{ margin: "12px 0 0", color: "#667085", fontWeight: 800 }}>Start the route before completing stops.</p>;
  if (updatesDisabled) return <p style={{ margin: "12px 0 0", color: "#667085", fontWeight: 800 }}>Only the next active stop can be updated.</p>;

  return (
    <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <button type="button" onClick={() => setDeliveryMode("customer")} style={buttonStyle(deliveryMode === "customer" ? "#16a34a" : "#eff6ff", deliveryMode === "customer" ? "#ffffff" : "#2563eb")}>Customer received</button>
        <button type="button" onClick={() => setDeliveryMode("safe")} style={buttonStyle(deliveryMode === "safe" ? "#f97316" : "#fff7ed", deliveryMode === "safe" ? "#ffffff" : "#c2410c")}>Left safe</button>
      </div>
      <button type="button" onClick={() => setDeliveryMode("missed")} style={buttonStyle(deliveryMode === "missed" ? "#b42318" : "#fef3f2", deliveryMode === "missed" ? "#ffffff" : "#b42318")}>Could not deliver</button>

      {deliveryMode === "customer" || deliveryMode === "safe" ? (
        <Form method="post" encType="multipart/form-data" style={{ display: "grid", gap: 12, border: "1px solid #e5e7eb", borderRadius: 18, padding: 12, background: "#f8fafc" }}>
          <input type="hidden" name="intent" value="completeStop" />
          <input type="hidden" name="stopId" value={stopId} />
          <input type="hidden" name="leftInSafePlace" value={deliveryMode === "safe" ? "true" : "false"} />
          <input type="hidden" name="podName" value={customerName} />
          <input type="hidden" name="podImage" value={podImage} />
          <input type="hidden" name="podTicked" value={deliveryMode === "customer" && podImage ? "true" : "false"} />
          <input type="hidden" name="podLat" value={podLat} />
          <input type="hidden" name="podLng" value={podLng} />
          <label style={{ display: "grid", gap: 8, fontWeight: 900 }}>Add proof photo<input type="file" name="proofPhotoFiles" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" multiple={false} disabled={!proofPhotoStorageEnabled} onChange={handleProofPhotoChange} style={{ fontSize: 16, padding: 12, border: "1px solid #d0d5dd", borderRadius: 14, background: "#ffffff" }} /></label>
          {!proofPhotoStorageEnabled ? <input name="proofPhotoUrl" type="url" placeholder="Paste proof photo link" value={proofPhotoUrl} onChange={(event) => setProofPhotoUrl(event.currentTarget.value)} style={{ fontSize: 16, padding: 12, border: "1px solid #d0d5dd", borderRadius: 14 }} /> : null}
          {proofPreviewUrl ? <img src={proofPreviewUrl} alt="Proof preview" style={{ width: 120, height: 120, borderRadius: 14, objectFit: "cover", border: "1px solid #d0d5dd" }} /> : null}
          {deliveryMode === "customer" ? <div style={{ display: "grid", gap: 8 }}><button type="button" onClick={() => setSignatureOpen(true)} style={buttonStyle(podImage ? "#16a34a" : "#323841")}>{podImage ? "Signature added" : "Get customer signature"}</button>{podImage ? <img src={podImage} alt="Customer signature" style={{ width: "100%", maxHeight: 120, objectFit: "contain", borderRadius: 12, background: "#ffffff", border: "1px solid #d0d5dd" }} /> : null}{signatureOpen ? <SignatureModal customerName={customerName} disabled={updatesDisabled} onSave={setPodImage} onClose={() => setSignatureOpen(false)} /> : null}</div> : null}
          {deliveryMode === "safe" ? <label style={{ display: "grid", gap: 8, fontWeight: 900 }}>Safe place note<textarea name="safePlaceNote" rows={2} value={safePlaceNote} onChange={(event) => setSafePlaceNote(event.currentTarget.value)} placeholder="Example: Behind side gate, under covered porch" style={{ fontSize: 16, padding: 12, border: "1px solid #d0d5dd", borderRadius: 14 }} /></label> : null}
          <label style={{ display: "grid", gap: 8, fontWeight: 900 }}>Driver note optional<textarea name="deliveryNote" rows={2} value={deliveryNote} onChange={(event) => setDeliveryNote(event.currentTarget.value)} style={{ fontSize: 16, padding: 12, border: "1px solid #d0d5dd", borderRadius: 14 }} /></label>
          <button type="submit" disabled={deliveryMode === "customer" ? !canCompleteCustomer : !canCompleteSafePlace} style={buttonStyle((deliveryMode === "customer" ? canCompleteCustomer : canCompleteSafePlace) ? "#16a34a" : "#d0d5dd", (deliveryMode === "customer" ? canCompleteCustomer : canCompleteSafePlace) ? "#ffffff" : "#667085")}>Complete delivery</button>
          <p style={{ margin: 0, color: "#667085", fontWeight: 700, fontSize: 13 }}>{deliveryMode === "customer" ? "Needs photo and customer signature." : "Needs photo and safe place note."}</p>
        </Form>
      ) : null}

      {deliveryMode === "missed" ? <Form method="post" style={{ display: "grid", gap: 12, border: "1px solid #fecdca", borderRadius: 18, padding: 12, background: "#fff7f5" }}><input type="hidden" name="intent" value="missedStop" /><input type="hidden" name="stopId" value={stopId} /><label style={{ display: "grid", gap: 8, fontWeight: 900 }}>Reason<select name="failedReason" value={failedReason} onChange={(event) => setFailedReason(event.currentTarget.value)} style={{ fontSize: 16, padding: 12, border: "1px solid #d0d5dd", borderRadius: 14, background: "#ffffff" }}><option>No answer</option><option>Access issue</option><option>Customer unavailable</option><option>Wrong address</option><option>Customer refused</option><option>Other</option></select></label><label style={{ display: "grid", gap: 8, fontWeight: 900 }}>Note optional<textarea name="failedNote" rows={2} value={failedNote} onChange={(event) => setFailedNote(event.currentTarget.value)} style={{ fontSize: 16, padding: 12, border: "1px solid #d0d5dd", borderRadius: 14 }} /></label><button type="submit" style={buttonStyle("#b42318")}>Mark missed</button></Form> : null}
    </div>
  );
}

function SafePlaceRequestCard({ note }: { note?: string | null }) {
  if (!note) return null;

  return (
    <div style={{ background: "#fff7ed", border: "2px solid #f97316", borderRadius: 18, padding: 12 }}>
      <p style={{ margin: "0 0 6px", color: "#c2410c", fontWeight: 900 }}>Customer safe place request</p>
      <p style={{ margin: 0, color: "#323841", fontSize: 17, lineHeight: 1.45, fontWeight: 900 }}>{note}</p>
    </div>
  );
}

function ProofCard({ proofPhotos }: { proofPhotos: Array<{ id: string; url: string; label?: string | null }> }) {
  if (!proofPhotos.length) return null;
  return <div style={{ marginTop: 12, display: "grid", gap: 8 }}><p style={{ margin: 0, fontWeight: 900 }}>Delivery card</p><div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>{proofPhotos.map((photo) => <figure key={photo.id} style={{ margin: 0, minWidth: 104 }}><img src={photo.url} alt={photo.label || "Proof"} style={{ width: 104, height: 84, objectFit: "cover", borderRadius: 12, border: "1px solid #d0d5dd", background: "#ffffff" }} /><figcaption style={{ fontSize: 11, color: "#667085", marginTop: 4, fontWeight: 700 }}>{photo.label || "Proof"}</figcaption></figure>)}</div></div>;
}

export default function DriverRoutePage() {
  const { route, canStart, proofPhotoStorageEnabled } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();
  const firstEta = route.stops.find((stop) => stop.estimatedArrival)?.estimatedArrival || route.date;
  const plannedStart = route.plannedStartTime || firstEta;
  const routeStarted = route.status === "OUT_FOR_DELIVERY" || route.status === "COMPLETED";
  const nextStop = route.stops.find((stop) => stop.status === "PENDING");
  const deliveredStops = route.stops.filter((stop) => stop.status === "DELIVERED").length;
  const failedStops = route.stops.filter((stop) => stop.status === "FAILED").length;
  const completedStops = deliveredStops + failedStops;
  const mapPoints = route.stops.filter((stop) => typeof stop.deliveryGroup?.latitude === "number" && typeof stop.deliveryGroup?.longitude === "number").map((stop) => ({ id: stop.id, label: String(stop.orderIndex), title: `Drop ${stop.orderIndex} · ${stop.deliveryGroup?.postcode || "No postcode"}`, latitude: stop.deliveryGroup?.latitude ?? null, longitude: stop.deliveryGroup?.longitude ?? null, selected: nextStop?.id === stop.id, status: stop.status }));

  useEffect(() => {
    if (!routeStarted) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        revalidator.revalidate();
      }
    }, DRIVER_ROUTE_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [routeStarted, revalidator]);

  return (
    <main style={{ minHeight: "100vh", background: "#eef4fb", fontFamily: "Arial, sans-serif", color: "#323841" }}>
      <section style={{ maxWidth: 720, margin: "0 auto", padding: "14px 12px 32px" }}>
        <header style={{ background: "#ffffff", borderRadius: 24, padding: 18, boxShadow: "0 10px 28px rgba(50,56,65,0.12)", marginBottom: 14 }}>
          <p style={{ margin: 0, color: "#509AE6", fontWeight: 900, fontSize: 14 }}>Bathroom Panels Direct</p>
          <h1 style={{ margin: "8px 0 0", fontSize: 30, lineHeight: 1.05 }}>{route.driver?.name || "Driver"}</h1>
          <p style={{ margin: "10px 0 0", fontSize: 20, fontWeight: 900 }}>{route.name}</p>
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ background: "#eff6ff", borderRadius: 16, padding: 12 }}><p style={{ margin: 0, color: "#667085", fontWeight: 800, fontSize: 12 }}>Planned start</p><p style={{ margin: "4px 0 0", color: "#2563eb", fontWeight: 900 }}>{formatStart(plannedStart)}</p></div>
            <div style={{ background: routeStarted ? "#ecfdf3" : "#fff7ed", borderRadius: 16, padding: 12 }}><p style={{ margin: 0, color: "#667085", fontWeight: 800, fontSize: 12 }}>Route status</p><p style={{ margin: "4px 0 0", color: routeStarted ? "#16a34a" : "#f97316", fontWeight: 900 }}>{statusLabel(route.status)}</p></div>
          </div>
          <p style={{ margin: "12px 0 0", fontWeight: 900 }}>{route.stops.length} drops · {completedStops} done · {failedStops} missed</p>
        </header>

        <section style={{ background: "#ffffff", borderRadius: 22, padding: 10, boxShadow: "0 8px 24px rgba(50,56,65,0.08)", marginBottom: 14 }}><RouteMap title="Driver route" badge={`${mapPoints.length} pins`} points={mapPoints} height={315} /></section>

        <section style={{ background: "#ffffff", borderRadius: 22, padding: 14, boxShadow: "0 8px 24px rgba(50,56,65,0.08)", marginBottom: 14 }}>
          {actionData && "error" in actionData ? <p style={{ margin: "0 0 10px", color: "#b42318", fontWeight: 900 }}>{actionData.error}</p> : null}
          {routeStarted ? <p style={{ margin: 0, fontWeight: 900, color: "#16a34a", fontSize: 18 }}>Route started. Next active drop is highlighted below.</p> : <StartRouteForm canStart={canStart} routeDate={route.date} />}
        </section>

        <section style={{ display: "grid", gap: 14 }}>{route.stops.map((stop) => {
          const group = stop.deliveryGroup;
          const customerName = group?.orders.map((order) => order.customerName).filter(Boolean).join(", ") || "Customer name missing";
          const orders = group?.orders.map((order) => order.shopifyOrderNumber).join(", ") || "No linked orders";
          const lineItems = group?.orders.flatMap((order) => splitLineItems(order.lineItemSummary)) || [];
          const phone = group?.orders.map((order) => order.customerPhone).filter(Boolean)[0] || "";
          const cleanPhone = tidyPhone(phone);
          const address = cleanDeliveryAddress(group?.formattedAddress || group?.address || "No address");
          const wazeUrl = buildWazeUrl(group);
          const isDelivered = stop.status === "DELIVERED";
          const isFailed = stop.status === "FAILED";
          const isNextStop = nextStop?.id === stop.id;
          const proofPhotos = group?.proofPhotos || [];
          const actionDisabled = !routeStarted || isDelivered || isFailed || !isNextStop;
          const customerSafePlaceNote = group?.safePlaceNote || "";

          return <article id={isNextStop ? "next-stop" : undefined} key={stop.id} style={{ background: "#ffffff", border: isDelivered ? "2px solid #16a34a" : isFailed ? "2px solid #b42318" : isNextStop ? "3px solid #509AE6" : "1px solid #e5e7eb", borderRadius: 24, overflow: "hidden", boxShadow: "0 10px 28px rgba(50,56,65,0.1)" }}>
            <div style={{ background: isDelivered ? "#16a34a" : isFailed ? "#b42318" : isNextStop ? "#509AE6" : "#f8fafc", color: isDelivered || isFailed || isNextStop ? "#ffffff" : "#323841", padding: 16, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div><h2 style={{ margin: 0, fontSize: 26 }}>Drop {stop.orderIndex}{isNextStop ? " · NEXT" : ""}</h2><p style={{ margin: "6px 0 0", fontWeight: 800 }}>{formatSlot(stop.estimatedArrival)}</p></div>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(255,255,255,0.22)", display: "grid", placeItems: "center", fontSize: 25, fontWeight: 900 }}>{isDelivered ? "✓" : isFailed ? "!" : stop.orderIndex}</div>
            </div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 8 }}><p style={{ margin: 0, fontSize: 21 }}><strong>{customerName}</strong></p><p style={{ margin: 0, color: "#667085", fontWeight: 900 }}>Order {orders}</p>{cleanPhone ? <a href={`tel:${cleanPhone}`} style={buttonStyle("#2563eb")}>Call customer</a> : <p style={{ margin: 0, color: "#667085", fontWeight: 800 }}>No phone number</p>}</div>
              <SafePlaceRequestCard note={customerSafePlaceNote} />
              <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 18, padding: 12 }}><p style={{ margin: "0 0 6px", fontWeight: 900 }}>Address</p><p style={{ margin: 0, lineHeight: 1.45, fontWeight: 700 }}>{address}</p><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}><button type="button" onClick={(event) => { navigator.clipboard.writeText(address); const target = event.currentTarget; target.innerText = "Copied"; setTimeout(() => { target.innerText = "Copy address"; }, 1200); }} style={secondaryButtonStyle()}>Copy address</button>{wazeUrl ? <a href={wazeUrl} target="_blank" rel="noreferrer" style={buttonStyle("#509AE6")}>Open map</a> : null}</div></div>
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 12 }}><p style={{ margin: "0 0 8px", fontWeight: 900 }}>Items to deliver</p>{lineItems.length ? <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 7 }}>{lineItems.map((item, index) => <li key={`${item}-${index}`} style={{ fontSize: 16, lineHeight: 1.35 }}>{highlightItemText(item)}</li>)}</ul> : <p style={{ margin: 0, color: "#667085" }}>No item details stored for this order.</p>}</div>
              <ProofCard proofPhotos={proofPhotos} />
              {isDelivered ? <p style={{ margin: 0, color: "#16a34a", fontWeight: 900, fontSize: 18 }}>✓ Delivery complete</p> : null}
              {isFailed ? <p style={{ margin: 0, color: "#b42318", fontWeight: 900, fontSize: 18 }}>Delivery marked missed</p> : null}
              {!isDelivered && !isFailed ? <DriverStopActions stopId={stop.id} customerName={customerName} isDisabled={actionDisabled} routeStarted={routeStarted} proofPhotoStorageEnabled={proofPhotoStorageEnabled} customerSafePlaceNote={customerSafePlaceNote} /> : null}
            </div>
          </article>;
        })}</section>
      </section>
    </main>
  );
}
