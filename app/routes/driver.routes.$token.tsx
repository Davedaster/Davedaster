import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useRevalidator, useSubmit } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, PointerEvent } from "react";

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
const COLLECTION_COLOUR = "#b42318";

type StopWithReturnTickets = {
  returnTickets?: Array<{
    lines?: Array<{
      itemName?: string | null;
      quantityExpected?: number | null;
    }>;
  }>;
};

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

async function tryGetOfflineShopifyAdmin() {
  try {
    return await getOfflineShopifyAdmin();
  } catch {
    return null;
  }
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

  return json({
    route,
    canStart: canStartDriverRoute(route.date),
    proofPhotoStorageEnabled: await isProofPhotoStorageEnabled(),
  });
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

    if (intent === "completeStop") {
      const proofPhotoFiles = formData.getAll("proofPhotoFiles").filter((file): file is File => file instanceof File && file.size > 0);
      const fallbackProofPhotoUrl = String(formData.get("proofPhotoUrl") || "").trim();
      const proofPhotoUrls = fallbackProofPhotoUrl ? [fallbackProofPhotoUrl] : [];
      const podLatValue = numberFromFormValue(formData.get("podLat"));
      const podLngValue = numberFromFormValue(formData.get("podLng"));
      const admin = await tryGetOfflineShopifyAdmin();

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
      const admin = await getOfflineShopifyAdmin();
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
    timeZone: "Europe/London",
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
    timeZone: "Europe/London",
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

function isCollectionStop(stop: StopWithReturnTickets) {
  return Boolean(stop.returnTickets?.length);
}

function returnCollectionItemLines(stop: StopWithReturnTickets) {
  return (stop.returnTickets || []).flatMap((ticket) => (ticket.lines || []).map((line) => {
    const quantity = Number(line.quantityExpected || 1);
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1;
    const itemName = line.itemName?.trim() || "Return item";

    return `${safeQuantity} × ${itemName}`;
  }));
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
  return {
    border: 0,
    borderRadius: 16,
    padding: "15px 14px",
    background,
    color,
    fontSize: 16,
    fontWeight: 900,
    textAlign: "center" as const,
    textDecoration: "none",
    boxShadow: "0 6px 16px rgba(0,0,0,0.14)",
    maxWidth: "100%",
    boxSizing: "border-box" as const,
  };
}

function secondaryButtonStyle() {
  return {
    border: "1px solid #d0d5dd",
    borderRadius: 16,
    padding: "14px 12px",
    background: "#ffffff",
    color: "#323841",
    fontSize: 15,
    fontWeight: 900,
    textAlign: "center" as const,
    textDecoration: "none",
    maxWidth: "100%",
    boxSizing: "border-box" as const,
  };
}

function proofPhotoSrc(value: string) {
  if (!value) return "";
  if (value.startsWith("http") || value.startsWith("data:image/")) return value;
  return `/driver/routes/proof-of-delivery/${encodeURIComponent(value.replace(/^proof-of-delivery\//, ""))}`;
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.92)", zIndex: 9999, padding: "max(8px, env(safe-area-inset-top)) 10px max(8px, env(safe-area-inset-bottom))", display: "grid", alignItems: "start", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ background: "#ffffff", borderRadius: 22, padding: 12, display: "grid", gap: 8, maxWidth: 900, margin: "0 auto", width: "100%", maxHeight: "calc(100dvh - 16px)", overflowY: "auto", WebkitOverflowScrolling: "touch", boxSizing: "border-box" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "clamp(20px, 5vw, 28px)" }}>Customer signature</h2>
          <p style={{ margin: "4px 0 0", color: "#667085", fontWeight: 700, fontSize: "clamp(13px, 3.8vw, 17px)", lineHeight: 1.25 }}>Ask the customer to sign in the white box.</p>
        </div>
        <p style={{ margin: 0, background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 14, padding: 10, fontWeight: 800, lineHeight: 1.3, fontSize: "clamp(13px, 3.8vw, 18px)" }}>By signing, I, {customerName || "the customer"}, confirm that the items received today match my order and have been received in good condition.</p>
        <canvas ref={canvasRef} width={900} height={360} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} style={{ width: "100%", height: "clamp(170px, 34dvh, 300px)", border: "2px solid #111827", borderRadius: 16, background: "#ffffff", touchAction: "none", boxSizing: "border-box" }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, position: "sticky", bottom: 0, background: "#ffffff", paddingTop: 8 }}>
          <button type="button" onClick={clearSignature} style={secondaryButtonStyle()}>Clear</button>
          <button type="button" onClick={submitSignature} disabled={!hasSignature} style={buttonStyle(hasSignature ? "#16a34a" : "#d0d5dd", hasSignature ? "#ffffff" : "#667085")}>Submit signature</button>
        </div>
        <button type="button" onClick={onClose} style={{ ...secondaryButtonStyle(), borderRadius: 12, padding: "11px 12px" }}>Cancel</button>
      </div>
    </div>
  );
}

function DriverStopActions({ stopId, customerName, isDisabled, routeStarted, proofPhotoStorageEnabled, customerSafePlaceNote }: { stopId: string; customerName: string; isDisabled: boolean; routeStarted: boolean; proofPhotoStorageEnabled: boolean; customerSafePlaceNote?: string | null }) {
  const [deliveryMode, setDeliveryMode] = useState<"customer" | "safe" | "missed" | null>(null);
  const [proofPhotoOneSelected, setProofPhotoOneSelected] = useState(false);
  const [proofPhotoTwoSelected, setProofPhotoTwoSelected] = useState(false);
  const [proofPreviewOne, setProofPreviewOne] = useState("");
  const [proofPreviewTwo, setProofPreviewTwo] = useState("");
  const [proofPhotoUrl, setProofPhotoUrl] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [safePlaceNote, setSafePlaceNote] = useState(customerSafePlaceNote || "");
  const [podImage, setPodImage] = useState("");
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [failedReason, setFailedReason] = useState("No answer");
  const [failedNote, setFailedNote] = useState("");
  const [podLat, setPodLat] = useState("");
  const [podLng, setPodLng] = useState("");
  const updatesDisabled = isDisabled || !routeStarted;
  const proofPhotoCount = (proofPhotoOneSelected ? 1 : 0) + (proofPhotoTwoSelected ? 1 : 0) + (proofPhotoUrl.trim() ? 1 : 0);
  const canCompleteCustomer = !updatesDisabled && deliveryMode === "customer" && proofPhotoCount >= 1 && podImage.length > 0;
  const canCompleteSafePlace = !updatesDisabled && deliveryMode === "safe" && proofPhotoCount >= 2 && safePlaceNote.trim().length > 0;

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

  function handleProofPhotoChange(event: ChangeEvent<HTMLInputElement>, slot: 1 | 2) {
    const file = event.currentTarget.files?.[0];
    const nextPreview = file ? URL.createObjectURL(file) : "";

    if (slot === 1) {
      if (proofPreviewOne) URL.revokeObjectURL(proofPreviewOne);
      setProofPhotoOneSelected(Boolean(file));
      setProofPreviewOne(nextPreview);
      return;
    }

    if (proofPreviewTwo) URL.revokeObjectURL(proofPreviewTwo);
    setProofPhotoTwoSelected(Boolean(file));
    setProofPreviewTwo(nextPreview);
  }

  if (!routeStarted) return <p style={{ margin: "12px 0 0", color: "#667085", fontWeight: 800 }}>Start the route before completing stops.</p>;
  if (updatesDisabled) return <p style={{ margin: "12px 0 0", color: "#667085", fontWeight: 800 }}>Only the next active stop can be updated.</p>;

  return (
    <div style={{ marginTop: 16, display: "grid", gap: 12, maxWidth: "100%", overflow: "hidden", boxSizing: "border-box" }}>
      <button type="button" onClick={() => setDeliveryMode("customer")} style={{ width: "100%", ...buttonStyle(deliveryMode === "customer" ? "#16a34a" : "#2563eb") }}>Customer received</button>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, minWidth: 0 }}>
        <button type="button" onClick={() => setDeliveryMode("safe")} style={buttonStyle(deliveryMode === "safe" ? "#f97316" : "#fff7ed", deliveryMode === "safe" ? "#ffffff" : "#c2410c")}>Left safe</button>
        <button type="button" onClick={() => setDeliveryMode("missed")} style={buttonStyle(deliveryMode === "missed" ? "#b42318" : "#fef3f2", deliveryMode === "missed" ? "#ffffff" : "#b42318")}>Could not deliver</button>
      </div>

      {deliveryMode === "customer" || deliveryMode === "safe" ? (
        <Form method="post" encType="multipart/form-data" style={{ display: "grid", gap: 12, border: "1px solid #e5e7eb", borderRadius: 18, padding: 12, background: "#f8fafc", maxWidth: "100%", overflow: "hidden", boxSizing: "border-box" }}>
          <input type="hidden" name="intent" value="completeStop" />
          <input type="hidden" name="stopId" value={stopId} />
          <input type="hidden" name="leftInSafePlace" value={deliveryMode === "safe" ? "true" : "false"} />
          <input type="hidden" name="podName" value={customerName} />
          <input type="hidden" name="podImage" value={podImage} />
          <input type="hidden" name="podTicked" value={deliveryMode === "customer" && podImage ? "true" : "false"} />
          <input type="hidden" name="podLat" value={podLat} />
          <input type="hidden" name="podLng" value={podLng} />

          <label style={{ display: "grid", gap: 8, fontWeight: 900, maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>{deliveryMode === "safe" ? "Safe place photo 1" : "Proof photo"}<input type="file" name="proofPhotoFiles" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" disabled={!proofPhotoStorageEnabled} onChange={(event) => handleProofPhotoChange(event, 1)} style={{ width: "100%", maxWidth: "100%", minWidth: 0, fontSize: 14, padding: 10, border: "1px solid #d0d5dd", borderRadius: 14, background: "#ffffff", boxSizing: "border-box" }} /></label>
          {proofPreviewOne ? <img src={proofPreviewOne} alt="Proof preview" style={{ width: "min(150px, 100%)", height: 150, borderRadius: 14, objectFit: "cover", border: "1px solid #d0d5dd", maxWidth: "100%" }} /> : null}

          {deliveryMode === "safe" ? (
            <>
              <label style={{ display: "grid", gap: 8, fontWeight: 900, maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>Safe place photo 2<input type="file" name="proofPhotoFiles" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" disabled={!proofPhotoStorageEnabled} onChange={(event) => handleProofPhotoChange(event, 2)} style={{ width: "100%", maxWidth: "100%", minWidth: 0, fontSize: 14, padding: 10, border: "1px solid #d0d5dd", borderRadius: 14, background: "#ffffff", boxSizing: "border-box" }} /></label>
              {proofPreviewTwo ? <img src={proofPreviewTwo} alt="Second proof preview" style={{ width: "min(150px, 100%)", height: 150, borderRadius: 14, objectFit: "cover", border: "1px solid #d0d5dd", maxWidth: "100%" }} /> : null}
            </>
          ) : null}

          {!proofPhotoStorageEnabled ? <input name="proofPhotoUrl" type="url" placeholder="Paste proof photo link" value={proofPhotoUrl} onChange={(event) => setProofPhotoUrl(event.currentTarget.value)} style={{ width: "100%", maxWidth: "100%", fontSize: 16, padding: 12, border: "1px solid #d0d5dd", borderRadius: 14, boxSizing: "border-box" }} /> : null}
          {deliveryMode === "customer" ? <div style={{ display: "grid", gap: 8, maxWidth: "100%", overflow: "hidden" }}><button type="button" onClick={() => setSignatureOpen(true)} style={buttonStyle(podImage ? "#16a34a" : "#323841")}>{podImage ? "Signature added" : "Get customer signature"}</button>{podImage ? <img src={podImage} alt="Customer signature" style={{ width: "100%", maxWidth: "100%", maxHeight: 110, objectFit: "contain", borderRadius: 12, background: "#ffffff", border: "1px solid #d0d5dd", boxSizing: "border-box" }} /> : null}{signatureOpen ? <SignatureModal customerName={customerName} disabled={updatesDisabled} onSave={setPodImage} onClose={() => setSignatureOpen(false)} /> : null}</div> : null}
          {deliveryMode === "safe" ? <label style={{ display: "grid", gap: 8, fontWeight: 900 }}>Safe place note<textarea name="safePlaceNote" rows={2} value={safePlaceNote} onChange={(event) => setSafePlaceNote(event.currentTarget.value)} placeholder="Example: Behind side gate, under covered porch" style={{ width: "100%", maxWidth: "100%", fontSize: 16, padding: 12, border: "1px solid #d0d5dd", borderRadius: 14, boxSizing: "border-box" }} /></label> : null}
          <label style={{ display: "grid", gap: 8, fontWeight: 900 }}>Driver note optional<textarea name="deliveryNote" rows={2} value={deliveryNote} onChange={(event) => setDeliveryNote(event.currentTarget.value)} style={{ width: "100%", maxWidth: "100%", fontSize: 16, padding: 12, border: "1px solid #d0d5dd", borderRadius: 14, boxSizing: "border-box" }} /></label>
          <button type="submit" disabled={deliveryMode === "customer" ? !canCompleteCustomer : !canCompleteSafePlace} style={{ width: "100%", ...buttonStyle((deliveryMode === "customer" ? canCompleteCustomer : canCompleteSafePlace) ? "#16a34a" : "#d0d5dd", (deliveryMode === "customer" ? canCompleteCustomer : canCompleteSafePlace) ? "#ffffff" : "#667085") }}>Complete delivery</button>
          <p style={{ margin: 0, color: "#667085", fontWeight: 700, fontSize: 13 }}>{deliveryMode === "customer" ? "Needs 1 photo and customer signature." : "Needs 2 photos and a safe place note."}</p>
        </Form>
      ) : null}

      {deliveryMode === "missed" ? <Form method="post" style={{ display: "grid", gap: 12, border: "1px solid #fecdca", borderRadius: 18, padding: 12, background: "#fff7f5", maxWidth: "100%", overflow: "hidden", boxSizing: "border-box" }}><input type="hidden" name="intent" value="missedStop" /><input type="hidden" name="stopId" value={stopId} /><label style={{ display: "grid", gap: 8, fontWeight: 900 }}>Reason<select name="failedReason" value={failedReason} onChange={(event) => setFailedReason(event.currentTarget.value)} style={{ width: "100%", fontSize: 16, padding: 12, border: "1px solid #d0d5dd", borderRadius: 14, background: "#ffffff", boxSizing: "border-box" }}><option>No answer</option><option>Access issue</option><option>Customer unavailable</option><option>Wrong address</option><option>Customer refused</option><option>Other</option></select></label><label style={{ display: "grid", gap: 8, fontWeight: 900 }}>Note optional<textarea name="failedNote" rows={2} value={failedNote} onChange={(event) => setFailedNote(event.currentTarget.value)} style={{ width: "100%", fontSize: 16, padding: 12, border: "1px solid #d0d5dd", borderRadius: 14, boxSizing: "border-box" }} /></label><button type="submit" style={{ width: "100%", ...buttonStyle("#b42318") }}>Mark missed</button></Form> : null}
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
  return <div style={{ marginTop: 12, display: "grid", gap: 8 }}><p style={{ margin: 0, fontWeight: 900 }}>Delivery card</p><div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>{proofPhotos.map((photo) => <figure key={photo.id} style={{ margin: 0, minWidth: 104 }}><a href={proofPhotoSrc(photo.url)} target="_blank" rel="noreferrer"><img src={proofPhotoSrc(photo.url)} alt={photo.label || "Proof"} style={{ width: 104, height: 84, objectFit: "cover", borderRadius: 12, border: "1px solid #d0d5dd", background: "#ffffff" }} /></a><figcaption style={{ fontSize: 11, color: "#667085", marginTop: 4, fontWeight: 700 }}>{photo.label || "Proof"}</figcaption></figure>)}</div></div>;
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
  const mapPoints = route.stops.filter((stop) => typeof stop.deliveryGroup?.latitude === "number" && typeof stop.deliveryGroup?.longitude === "number").map((stop) => ({ id: stop.id, label: String(stop.orderIndex), title: `Drop ${stop.orderIndex}${isCollectionStop(stop) ? " · Collection" : ""} · ${stop.deliveryGroup?.postcode || "No postcode"}`, latitude: stop.deliveryGroup?.latitude ?? null, longitude: stop.deliveryGroup?.longitude ?? null, selected: nextStop?.id === stop.id, status: stop.status }));

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
    <main style={{ minHeight: "100vh", background: "#eef4fb", fontFamily: "Arial, sans-serif", color: "#323841", overflowX: "hidden" }}>
      <section style={{ maxWidth: 720, margin: "0 auto", padding: "14px 12px 32px", overflowX: "hidden", boxSizing: "border-box" }}>
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
          const collectionStop = isCollectionStop(stop);
          const customerName = group?.orders.map((order) => order.customerName).filter(Boolean).join(", ") || "Customer name missing";
          const orders = group?.orders.map((order) => order.shopifyOrderNumber).join(", ") || "No linked orders";
          const deliveryLineItems = group?.orders.flatMap((order) => splitLineItems(order.lineItemSummary)) || [];
          const collectionLineItems = returnCollectionItemLines(stop);
          const lineItems = collectionStop && collectionLineItems.length ? collectionLineItems : deliveryLineItems;
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
          const stopBorder = isDelivered ? "2px solid #16a34a" : isFailed ? "2px solid #b42318" : collectionStop ? `3px solid ${COLLECTION_COLOUR}` : isNextStop ? "3px solid #509AE6" : "1px solid #e5e7eb";
          const stopHeaderBackground = isDelivered ? "#16a34a" : isFailed ? "#b42318" : collectionStop ? COLLECTION_COLOUR : isNextStop ? "#509AE6" : "#f8fafc";
          const stopHeaderText = isDelivered || isFailed || collectionStop || isNextStop ? "#ffffff" : "#323841";
          const itemTitle = collectionStop ? "Items to collect" : "Items to deliver";
          const emptyItemText = collectionStop ? "No return item details stored for this collection." : "No item details stored for this order.";

          return <article id={isNextStop ? "next-stop" : undefined} key={stop.id} style={{ background: "#ffffff", border: stopBorder, borderRadius: 24, overflow: "hidden", boxShadow: "0 10px 28px rgba(50,56,65,0.1)", maxWidth: "100%", boxSizing: "border-box" }}>
            <div style={{ background: stopHeaderBackground, color: stopHeaderText, padding: 16, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div><h2 style={{ margin: 0, fontSize: 26 }}>Drop {stop.orderIndex}{collectionStop ? " · Collection" : ""}{isNextStop ? " · NEXT" : ""}</h2><p style={{ margin: "6px 0 0", fontWeight: 800 }}>{formatSlot(stop.estimatedArrival)}</p></div>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(255,255,255,0.22)", display: "grid", placeItems: "center", fontSize: 25, fontWeight: 900 }}>{isDelivered ? "✓" : isFailed ? "!" : stop.orderIndex}</div>
            </div>
            <div style={{ padding: 16, display: "grid", gap: 12, maxWidth: "100%", overflow: "hidden", boxSizing: "border-box" }}>
              <div style={{ display: "grid", gap: 8 }}><p style={{ margin: 0, fontSize: 21 }}><strong>{customerName}</strong></p><p style={{ margin: 0, color: "#667085", fontWeight: 900 }}>{collectionStop ? "Return order" : "Order"} {orders}</p>{cleanPhone ? <a href={`tel:${cleanPhone}`} style={buttonStyle("#2563eb")}>Call customer</a> : <p style={{ margin: 0, color: "#667085", fontWeight: 800 }}>No phone number</p>}</div>
              <SafePlaceRequestCard note={customerSafePlaceNote} />
              <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 18, padding: 12 }}><p style={{ margin: "0 0 6px", fontWeight: 900 }}>{collectionStop ? "Collection address" : "Address"}</p><p style={{ margin: 0, lineHeight: 1.45, fontWeight: 700 }}>{address}</p><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}><button type="button" onClick={(event) => { navigator.clipboard.writeText(address); const target = event.currentTarget; target.innerText = "Copied"; setTimeout(() => { target.innerText = "Copy address"; }, 1200); }} style={secondaryButtonStyle()}>Copy address</button>{wazeUrl ? <a href={wazeUrl} target="_blank" rel="noreferrer" style={buttonStyle("#509AE6")}>Open map</a> : null}</div></div>
              <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 12 }}><p style={{ margin: "0 0 8px", fontWeight: 900 }}>{itemTitle}</p>{lineItems.length ? <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 7 }}>{lineItems.map((item, index) => <li key={`${item}-${index}`} style={{ fontSize: 16, lineHeight: 1.35 }}>{highlightItemText(item)}</li>)}</ul> : <p style={{ margin: 0, color: "#667085" }}>{emptyItemText}</p>}</div>
              <ProofCard proofPhotos={proofPhotos} />
              {isDelivered ? <p style={{ margin: 0, color: "#16a34a", fontWeight: 900, fontSize: 18 }}>{collectionStop ? "✓ Collection complete" : "✓ Delivery complete"}</p> : null}
              {isFailed ? <p style={{ margin: 0, color: "#b42318", fontWeight: 900, fontSize: 18 }}>{collectionStop ? "Collection could not be completed" : "Delivery marked missed"}</p> : null}
              {collectionStop && !isDelivered && !isFailed ? <p style={{ margin: 0, color: COLLECTION_COLOUR, fontWeight: 900, fontSize: 16 }}>Collection completion controls will be added in the next step. Do not complete this as a delivery.</p> : null}
              {!collectionStop && !isDelivered && !isFailed ? <DriverStopActions stopId={stop.id} customerName={customerName} isDisabled={actionDisabled} routeStarted={routeStarted} proofPhotoStorageEnabled={proofPhotoStorageEnabled} customerSafePlaceNote={customerSafePlaceNote} /> : null}
            </div>
          </article>;
        })}</section>
      </section>
    </main>
  );
}
