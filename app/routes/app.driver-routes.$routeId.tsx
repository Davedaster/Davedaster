import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useActionData } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  Text,
  BlockStack,
  Badge,
  Button,
  InlineStack,
  Box,
  Divider,
  TextField,
  Checkbox,
} from "@shopify/polaris";
import { useEffect, useRef, useState } from "react";

import { ProofPhotoGallery } from "../components/ProofPhotoGallery";
import { markStopFailedDelivery } from "../lib/failedDelivery.server";
import { formatEtaSlot } from "../lib/etaSlots.server";
import { getDriverRoute, startDriverRoute } from "../lib/driverRoutes.server";
import { saveProofOfDelivery } from "../lib/proofOfDelivery.server";
import { deleteProofPhoto } from "../lib/proofPhotos.server";
import { isProofPhotoStorageEnabled, uploadProofPhoto } from "../lib/proofPhotoStorage.server";
import { authenticate } from "../shopify.server";

const DELIVERY_SIGNATURE_TERMS = "By signing below, I confirm that I have received the goods delivered today. I have checked the quantity of items received and confirm that no obvious damage or shortages were identified at the time of delivery. Any concealed damage or discrepancies must be reported within 24 hours.";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const routeId = params.routeId;

  if (!routeId) {
    throw new Response("Route not found", { status: 404 });
  }

  const route = await getDriverRoute(routeId);

  if (!route) {
    throw new Response("Route not found", { status: 404 });
  }

  return json({ route, proofPhotoStorageEnabled: isProofPhotoStorageEnabled() });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const routeId = params.routeId;

  if (!routeId) {
    throw new Response("Route not found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "startRoute");

  if (intent === "startRoute") {
    await startDriverRoute(routeId);
    return redirect(`/app/driver-routes/${routeId}`);
  }

  if (intent === "deleteProofPhoto") {
    try {
      await deleteProofPhoto({
        routeId,
        proofPhotoId: String(formData.get("proofPhotoId") || "").trim(),
      });

      return redirect(`/app/driver-routes/${routeId}`);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Proof photo remove failed." }, { status: 400 });
    }
  }

  const route = await getDriverRoute(routeId);

  if (!route || route.status !== "OUT_FOR_DELIVERY") {
    return json({ ok: false, error: "Start the route before updating stops." }, { status: 400 });
  }

  if (intent === "completeStop") {
    try {
      const stopId = String(formData.get("stopId") || "").trim();
      const proofPhotoFiles = formData.getAll("proofPhotoFiles").filter((file): file is File => file instanceof File && file.size > 0);
      const fallbackProofPhotoUrl = String(formData.get("proofPhotoUrl") || "").trim();
      const proofPhotoUrls = fallbackProofPhotoUrl ? [fallbackProofPhotoUrl] : [];

      for (const proofPhotoFile of proofPhotoFiles) {
        proofPhotoUrls.push(await uploadProofPhoto(proofPhotoFile, stopId));
      }

      await saveProofOfDelivery({
        admin,
        stopId,
        proofPhotoUrl: proofPhotoUrls,
        deliveryNote: String(formData.get("deliveryNote") || "").trim(),
        safePlaceNote: String(formData.get("safePlaceNote") || "").trim(),
        leftInSafePlace: String(formData.get("leftInSafePlace") || "") === "true",
        signatureImage: String(formData.get("signatureImage") || "").trim(),
        signatureName: String(formData.get("signatureName") || "").trim(),
        signatureTermsAccepted: String(formData.get("signatureTermsAccepted") || "") === "true",
        signatureTermsText: String(formData.get("signatureTermsText") || DELIVERY_SIGNATURE_TERMS).trim(),
        signatureGpsLat: String(formData.get("signatureGpsLat") || "").trim(),
        signatureGpsLng: String(formData.get("signatureGpsLng") || "").trim(),
      });

      return redirect(`/app/driver-routes/${routeId}`);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Stop completion failed." }, { status: 400 });
    }
  }

  if (intent === "failedStop") {
    try {
      await markStopFailedDelivery({
        admin,
        stopId: String(formData.get("stopId") || "").trim(),
        reason: String(formData.get("failedReason") || "").trim(),
        note: String(formData.get("failedNote") || "").trim(),
      });

      return redirect(`/app/driver-routes/${routeId}`);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Failed delivery update failed." }, { status: 400 });
    }
  }

  return redirect(`/app/driver-routes/${routeId}`);
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | Date | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSlot(estimatedArrival: string | Date | null) {
  if (!estimatedArrival) {
    return "Pending";
  }

  const start = new Date(estimatedArrival);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return formatEtaSlot(start, end);
}

function statusTone(status: string) {
  if (status === "DELIVERED") {
    return "success" as const;
  }

  if (status === "FAILED") {
    return "critical" as const;
  }

  return "info" as const;
}

function buildWazeUrl(stop: {
  deliveryGroup?: {
    latitude?: number | null;
    longitude?: number | null;
    address?: string | null;
    formattedAddress?: string | null;
    postcode?: string | null;
  } | null;
}) {
  const group = stop.deliveryGroup;

  if (!group) {
    return null;
  }

  if (typeof group.latitude === "number" && typeof group.longitude === "number") {
    return `https://waze.com/ul?ll=${group.latitude},${group.longitude}&navigate=yes`;
  }

  const query = [group.address, group.formattedAddress, group.postcode]
    .filter(Boolean)
    .join(", ");

  if (!query) {
    return null;
  }

  return `https://waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`;
}

function buildTrackingUrl(routeId: string, shopifyOrderId: string) {
  return `/apps/track/${routeId}?order=${encodeURIComponent(shopifyOrderId)}`;
}

function tidyPhone(phone?: string | null) {
  if (!phone) {
    return null;
  }

  return phone.replace(/[^+\d]/g, "");
}

function SignaturePad({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);

  function resizeCanvas() {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(rect.width || 600, 320) * scale;
    canvas.height = 180 * scale;
    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.scale(scale, scale);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 3;
    context.strokeStyle = "#323841";
  }

  useEffect(() => {
    resizeCanvas();
  }, []);

  function getPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;

    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const rect = canvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function startDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) {
      return;
    }

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    canvas.setPointerCapture(event.pointerId);
    const point = getPoint(event);
    isDrawingRef.current = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current || disabled) {
      return;
    }

    const context = canvasRef.current?.getContext("2d");

    if (!context) {
      return;
    }

    const point = getPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function stopDrawing() {
    if (!isDrawingRef.current) {
      return;
    }

    isDrawingRef.current = false;
    const canvas = canvasRef.current;

    if (canvas) {
      onChange(canvas.toDataURL("image/png"));
    }
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    resizeCanvas();
    onChange("");
  }

  return (
    <BlockStack gap="150">
      <Text as="p" variant="bodyMd" fontWeight="medium">Customer signature</Text>
      <canvas
        ref={canvasRef}
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
        style={{
          width: "100%",
          height: 180,
          border: "1px solid #c9cccf",
          borderRadius: 8,
          background: disabled ? "#f6f6f7" : "#ffffff",
          touchAction: "none",
          display: "block",
        }}
        aria-label="Customer signature pad"
      />
      <InlineStack gap="200" blockAlign="center">
        <Button onClick={clearSignature} disabled={disabled || !value}>Clear signature</Button>
        {value ? <Badge tone="success">Signature captured</Badge> : <Text as="p" variant="bodySm" tone="critical">Signature required</Text>}
      </InlineStack>
    </BlockStack>
  );
}

function DriverStopActions({ stopId, isDisabled, routeStarted, proofPhotoStorageEnabled }: { stopId: string; isDisabled: boolean; routeStarted: boolean; proofPhotoStorageEnabled: boolean }) {
  const [leftInSafePlace, setLeftInSafePlace] = useState(false);
  const [proofPhotoUrl, setProofPhotoUrl] = useState("");
  const [proofPhotoCount, setProofPhotoCount] = useState(0);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [safePlaceNote, setSafePlaceNote] = useState("");
  const [signatureImage, setSignatureImage] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [signatureTermsAccepted, setSignatureTermsAccepted] = useState(false);
  const [signatureGpsLat, setSignatureGpsLat] = useState("");
  const [signatureGpsLng, setSignatureGpsLng] = useState("");
  const [failedReason, setFailedReason] = useState("");
  const [failedNote, setFailedNote] = useState("");
  const updatesDisabled = isDisabled || !routeStarted;
  const hasProofPhoto = proofPhotoCount > 0 || proofPhotoUrl.trim().length > 0;
  const hasSignature = signatureImage.trim().length > 0;
  const canCompleteDelivery = hasProofPhoto && hasSignature && signatureName.trim().length > 0 && signatureTermsAccepted;

  useEffect(() => {
    if (updatesDisabled || typeof navigator === "undefined" || !navigator.geolocation) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setSignatureGpsLat(String(position.coords.latitude));
        setSignatureGpsLng(String(position.coords.longitude));
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }, [updatesDisabled]);

  return (
    <BlockStack gap="300">
      <Divider />
      <Text as="h4" variant="headingSm">Update this stop</Text>
      {!routeStarted ? (
        <Text as="p" variant="bodySm" tone="subdued">Start the route before marking stops delivered or failed.</Text>
      ) : null}

      <Form method="post" encType="multipart/form-data">
        <input type="hidden" name="intent" value="completeStop" />
        <input type="hidden" name="stopId" value={stopId} />
        <input type="hidden" name="leftInSafePlace" value={leftInSafePlace ? "true" : "false"} />
        <input type="hidden" name="signatureImage" value={signatureImage} />
        <input type="hidden" name="signatureTermsAccepted" value={signatureTermsAccepted ? "true" : "false"} />
        <input type="hidden" name="signatureTermsText" value={DELIVERY_SIGNATURE_TERMS} />
        <input type="hidden" name="signatureGpsLat" value={signatureGpsLat} />
        <input type="hidden" name="signatureGpsLng" value={signatureGpsLng} />
        <BlockStack gap="300">
          <BlockStack gap="200">
            {proofPhotoStorageEnabled ? (
              <label>
                <Text as="span" variant="bodyMd" fontWeight="medium">Proof photos</Text>
                <input type="file" name="proofPhotoFiles" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" multiple disabled={updatesDisabled} onChange={(event) => setProofPhotoCount(event.currentTarget.files?.length || 0)} style={{ display: "block", marginTop: 6 }} />
                {proofPhotoCount > 0 ? <Text as="p" variant="bodySm" tone="subdued">{proofPhotoCount} photo{proofPhotoCount === 1 ? "" : "s"} selected</Text> : null}
              </label>
            ) : null}
            <TextField label={proofPhotoStorageEnabled ? "Proof photo link fallback" : "Proof photo link"} name="proofPhotoUrl" type="url" value={proofPhotoUrl} onChange={setProofPhotoUrl} autoComplete="off" disabled={updatesDisabled} helpText={proofPhotoStorageEnabled ? "Upload one or more photos above, or paste a hosted link if needed." : "Required before marking delivered."} />
            <TextField label="Delivery note" name="deliveryNote" value={deliveryNote} onChange={setDeliveryNote} autoComplete="off" multiline={2} disabled={updatesDisabled} />
            <Checkbox label="Left in safe place" checked={leftInSafePlace} onChange={setLeftInSafePlace} disabled={updatesDisabled} />
            <TextField label="Safe place note" name="safePlaceNote" value={safePlaceNote} onChange={setSafePlaceNote} autoComplete="off" multiline={2} disabled={updatesDisabled} />
          </BlockStack>

          <Box padding="300" background="bg-surface-secondary" borderRadius="200">
            <BlockStack gap="250">
              <Text as="h4" variant="headingSm">Delivery confirmation</Text>
              <Text as="p" variant="bodySm" tone="subdued">{DELIVERY_SIGNATURE_TERMS}</Text>
              <TextField label="Printed customer name" name="signatureName" value={signatureName} onChange={setSignatureName} autoComplete="name" disabled={updatesDisabled} />
              <SignaturePad value={signatureImage} onChange={setSignatureImage} disabled={updatesDisabled} />
              <Checkbox label="I confirm I have read and agree to the delivery confirmation above" checked={signatureTermsAccepted} onChange={setSignatureTermsAccepted} disabled={updatesDisabled} />
              {signatureGpsLat && signatureGpsLng ? <Text as="p" variant="bodySm" tone="subdued">GPS captured for proof of delivery.</Text> : <Text as="p" variant="bodySm" tone="subdued">GPS will be captured where the device allows location access.</Text>}
            </BlockStack>
          </Box>

          <Button submit variant="primary" disabled={updatesDisabled || !canCompleteDelivery}>Mark delivered</Button>
        </BlockStack>
      </Form>

      <Form method="post">
        <input type="hidden" name="intent" value="failedStop" />
        <input type="hidden" name="stopId" value={stopId} />
        <BlockStack gap="200">
          <TextField label="Failed delivery reason" name="failedReason" value={failedReason} onChange={setFailedReason} autoComplete="off" disabled={updatesDisabled} helpText="Required before marking failed." />
          <TextField label="Failed delivery note" name="failedNote" value={failedNote} onChange={setFailedNote} autoComplete="off" multiline={2} disabled={updatesDisabled} />
          <Button submit tone="critical" disabled={updatesDisabled || !failedReason}>Mark failed delivery</Button>
        </BlockStack>
      </Form>
    </BlockStack>
  );
}

export default function DriverRouteDetails() {
  const { route, proofPhotoStorageEnabled } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const routeStarted = route.status === "OUT_FOR_DELIVERY";
  const pendingStops = route.stops.filter((stop) => stop.status === "PENDING").length;
  const deliveredStops = route.stops.filter((stop) => stop.status === "DELIVERED").length;
  const failedStops = route.stops.filter((stop) => stop.status === "FAILED").length;

  return (
    <Page title={route.name} backAction={{ content: "Driver routes", url: "/app/driver-routes" }}>
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Driver route details</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">{formatDate(route.date)} · Driver: {route.driver?.name || "No driver assigned"}</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">{route.stops.length} stops · {pendingStops} pending · {deliveredStops} delivered · {failedStops} failed</Text>
                </BlockStack>
                <InlineStack gap="200" blockAlign="center">
                  <Button url={`/app/driver-routes/${route.id}/pick-list`} target="_blank">Picking list</Button>
                  <Button url={`/app/driver-routes/${route.id}/print`} target="_blank">Print labels</Button>
                  {!routeStarted ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="startRoute" />
                      <Button submit variant="primary">Start route</Button>
                    </Form>
                  ) : (
                    <Badge tone="success">OUT_FOR_DELIVERY</Badge>
                  )}
                </InlineStack>
              </InlineStack>

              {!proofPhotoStorageEnabled ? <Text as="p" variant="bodySm" tone="subdued">Proof photo storage is not set up yet, so hosted proof photo links can still be pasted manually.</Text> : null}
              {actionData && "error" in actionData ? <Text as="p" variant="bodyMd" tone="critical">{actionData.error}</Text> : null}
            </BlockStack>
          </LegacyCard>

          <BlockStack gap="300">
            {route.stops.map((stop) => {
              const orders = stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).join(", ") || "No linked orders";
              const customerNames = stop.deliveryGroup?.orders.map((order) => order.customerName).filter(Boolean).join(", ") || "No customer name";
              const address = stop.deliveryGroup?.address || stop.deliveryGroup?.formattedAddress || "No address";
              const phone = stop.deliveryGroup?.orders.map((order) => order.customerPhone).filter(Boolean)[0] || null;
              const cleanedPhone = tidyPhone(phone);
              const wazeUrl = buildWazeUrl(stop);
              const isFinalised = stop.status === "DELIVERED" || stop.status === "FAILED";
              const proofPhotos = stop.deliveryGroup?.proofPhotos || [];
              const orderLinks = stop.deliveryGroup?.orders || [];
              const signatureImage = stop.deliveryGroup?.signatureImage;
              const signatureName = stop.deliveryGroup?.signatureName;

              return (
                <LegacyCard key={stop.id} sectioned>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingMd">Stop {stop.orderIndex}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Orders: {orders}</Text>
                      </BlockStack>
                      <Badge tone={statusTone(stop.status)}>{stop.status}</Badge>
                    </InlineStack>
                    <Divider />
                    <Box>
                      <BlockStack gap="200">
                        <BlockStack gap="050"><Text as="p" variant="bodySm" tone="subdued">Customer</Text><Text as="p" variant="bodyMd" fontWeight="bold">{customerNames}</Text></BlockStack>
                        <BlockStack gap="050"><Text as="p" variant="bodySm" tone="subdued">Address</Text><Text as="p" variant="bodyMd">{address}</Text><Text as="p" variant="bodyMd" fontWeight="bold">{stop.deliveryGroup?.postcode || "No postcode"}</Text></BlockStack>
                        <BlockStack gap="050"><Text as="p" variant="bodySm" tone="subdued">ETA slot</Text><Text as="p" variant="bodyMd" fontWeight="bold">{formatSlot(stop.estimatedArrival)}</Text></BlockStack>
                        <BlockStack gap="050"><Text as="p" variant="bodySm" tone="subdued">Phone</Text><Text as="p" variant="bodyMd">{phone || "No phone"}</Text></BlockStack>
                        {orderLinks.length ? (
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm" tone="subdued">Customer tracking</Text>
                            <InlineStack gap="200">
                              {orderLinks.map((order) => (
                                <Button key={order.id} url={buildTrackingUrl(route.id, order.shopifyOrderId)} target="_blank">
                                  Open {order.shopifyOrderNumber}
                                </Button>
                              ))}
                            </InlineStack>
                          </BlockStack>
                        ) : null}
                        <ProofPhotoGallery proofPhotos={proofPhotos} />
                        {signatureImage && signatureName ? (
                          <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                            <BlockStack gap="150">
                              <InlineStack gap="200" blockAlign="center">
                                <Badge tone="success">Signed</Badge>
                                <Text as="p" variant="bodySm" tone="subdued">Proof of delivery accepted by {signatureName}</Text>
                              </InlineStack>
                              <img src={signatureImage} alt="Customer delivery signature" style={{ maxWidth: 360, width: "100%", maxHeight: 120, objectFit: "contain", background: "#ffffff", border: "1px solid #d0d5dd", borderRadius: 8 }} />
                              <Text as="p" variant="bodySm" tone="subdued">Accepted {formatDateTime(stop.deliveryGroup?.signatureAcceptedAt || null)}</Text>
                            </BlockStack>
                          </Box>
                        ) : null}
                      </BlockStack>
                    </Box>
                    <InlineStack gap="200">
                      {wazeUrl ? <Button url={wazeUrl} target="_blank" accessibilityLabel={`Open stop ${stop.orderIndex} in Waze`}>Open Waze</Button> : null}
                      {cleanedPhone ? <Button url={`tel:${cleanedPhone}`} accessibilityLabel={`Call customer for stop ${stop.orderIndex}`}>Call customer</Button> : null}
                    </InlineStack>
                    <DriverStopActions stopId={stop.id} isDisabled={isFinalised} routeStarted={routeStarted} proofPhotoStorageEnabled={proofPhotoStorageEnabled} />
                  </BlockStack>
                </LegacyCard>
              );
            })}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
