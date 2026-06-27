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
  ProgressBar,
} from "@shopify/polaris";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

import { ProofPhotoGallery } from "../components/ProofPhotoGallery";
import { markStopFailedDelivery } from "../lib/failedDelivery.server";
import { formatEtaSlot } from "../lib/etaSlots.server";
import { getDriverRoute, startDriverRoute } from "../lib/driverRoutes.server";
import { saveProofOfDelivery } from "../lib/proofOfDelivery.server";
import { deleteProofPhoto } from "../lib/proofPhotos.server";
import { isProofPhotoStorageEnabled, uploadProofPhoto } from "../lib/proofPhotoStorage.server";
import { authenticate } from "../shopify.server";

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
      const podLatValue = Number(String(formData.get("podLat") || ""));
      const podLngValue = Number(String(formData.get("podLng") || ""));

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
        podImage: String(formData.get("podImage") || "").trim(),
        podName: String(formData.get("podName") || "").trim(),
        podTicked: String(formData.get("podTicked") || "") === "true",
        podLat: Number.isFinite(podLatValue) ? podLatValue : null,
        podLng: Number.isFinite(podLngValue) ? podLngValue : null,
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

type NavigationStop = {
  deliveryGroup?: {
    latitude?: number | null;
    longitude?: number | null;
    address?: string | null;
    formattedAddress?: string | null;
    postcode?: string | null;
  } | null;
};

function buildNavigationQuery(stop: NavigationStop) {
  const group = stop.deliveryGroup;

  if (!group) {
    return null;
  }

  if (typeof group.latitude === "number" && typeof group.longitude === "number") {
    return {
      label: `${group.latitude},${group.longitude}`,
      encoded: `${group.latitude},${group.longitude}`,
    };
  }

  const label = [group.address, group.formattedAddress, group.postcode]
    .filter(Boolean)
    .join(", ");

  if (!label) {
    return null;
  }

  return {
    label,
    encoded: encodeURIComponent(label),
  };
}

function buildWazeUrl(stop: NavigationStop) {
  const group = stop.deliveryGroup;

  if (!group) {
    return null;
  }

  if (typeof group.latitude === "number" && typeof group.longitude === "number") {
    return `https://waze.com/ul?ll=${group.latitude},${group.longitude}&navigate=yes`;
  }

  const query = buildNavigationQuery(stop);

  if (!query) {
    return null;
  }

  return `https://waze.com/ul?q=${query.encoded}&navigate=yes`;
}

function buildGoogleMapsUrl(stop: NavigationStop) {
  const query = buildNavigationQuery(stop);

  if (!query) {
    return null;
  }

  return `https://www.google.com/maps/search/?api=1&query=${query.encoded}`;
}

function buildGoogleMapsRouteUrl(stops: NavigationStop[]) {
  const queries = stops
    .map((stop) => buildNavigationQuery(stop))
    .filter((query): query is { label: string; encoded: string } => Boolean(query));

  if (!queries.length) {
    return null;
  }

  const destination = queries[queries.length - 1];
  const waypoints = queries.slice(0, -1).map((query) => query.encoded).join("%7C");

  return `https://www.google.com/maps/dir/?api=1&destination=${destination.encoded}${waypoints ? `&waypoints=${waypoints}` : ""}`;
}

function buildAppleMapsUrl(stop: NavigationStop) {
  const query = buildNavigationQuery(stop);

  if (!query) {
    return null;
  }

  return `https://maps.apple.com/?q=${query.encoded}`;
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

function buildSmsUrl(phone: string | null, message: string) {
  if (!phone) {
    return null;
  }

  return `sms:${phone}?&body=${encodeURIComponent(message)}`;
}

function DriverStopActions({ stopId, isDisabled, routeStarted, proofPhotoStorageEnabled }: { stopId: string; isDisabled: boolean; routeStarted: boolean; proofPhotoStorageEnabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [leftInSafePlace, setLeftInSafePlace] = useState(false);
  const [proofPhotoUrl, setProofPhotoUrl] = useState("");
  const [proofPhotoCount, setProofPhotoCount] = useState(0);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [safePlaceNote, setSafePlaceNote] = useState("");
  const [failedReason, setFailedReason] = useState("");
  const [failedNote, setFailedNote] = useState("");
  const [podName, setPodName] = useState("");
  const [podImage, setPodImage] = useState("");
  const [podTicked, setPodTicked] = useState(false);
  const [podLat, setPodLat] = useState("");
  const [podLng, setPodLng] = useState("");
  const updatesDisabled = isDisabled || !routeStarted;
  const hasProofPhoto = proofPhotoCount > 0 || proofPhotoUrl.trim().length > 0;
  const canMarkDelivered = !updatesDisabled && hasProofPhoto && podName.trim().length > 0 && podImage.length > 0 && podTicked;

  useEffect(() => {
    if (!routeStarted || !("geolocation" in navigator)) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPodLat(String(position.coords.latitude));
        setPodLng(String(position.coords.longitude));
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 5000 },
    );
  }, [routeStarted]);

  function getCanvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function saveCanvasImage() {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    setPodImage(canvas.toDataURL("image/png"));
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (updatesDisabled) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    lastPointRef.current = getCanvasPoint(event);
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (updatesDisabled || !lastPointRef.current) {
      return;
    }

    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    const nextPoint = getCanvasPoint(event);

    if (!context) {
      return;
    }

    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    context.lineTo(nextPoint.x, nextPoint.y);
    context.stroke();
    lastPointRef.current = nextPoint;
    saveCanvasImage();
  }

  function handlePointerUp(event: PointerEvent<HTMLCanvasElement>) {
    lastPointRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    saveCanvasImage();
  }

  function clearPodImage() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }

    setPodImage("");
  }

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
        <input type="hidden" name="podImage" value={podImage} />
        <input type="hidden" name="podTicked" value={podTicked ? "true" : "false"} />
        <input type="hidden" name="podLat" value={podLat} />
        <input type="hidden" name="podLng" value={podLng} />
        <BlockStack gap="200">
          {proofPhotoStorageEnabled ? (
            <label>
              <Text as="span" variant="bodyMd" fontWeight="medium">Proof photos</Text>
              <input type="file" name="proofPhotoFiles" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" multiple disabled={updatesDisabled} onChange={(event) => setProofPhotoCount(event.currentTarget.files?.length || 0)} style={{ display: "block", marginTop: 6 }} />
              {proofPhotoCount > 0 ? <Text as="p" variant="bodySm" tone="subdued">{proofPhotoCount} photo{proofPhotoCount === 1 ? "" : "s"} selected</Text> : null}
            </label>
          ) : null}
          <TextField label={proofPhotoStorageEnabled ? "Proof photo link fallback" : "Proof photo link"} name="proofPhotoUrl" type="url" value={proofPhotoUrl} onChange={setProofPhotoUrl} autoComplete="off" disabled={updatesDisabled} helpText={proofPhotoStorageEnabled ? "Upload one or more photos above, or paste a hosted link if needed." : "Required before marking delivered."} />
          <TextField label="Receiver" name="podName" value={podName} onChange={setPodName} autoComplete="off" disabled={updatesDisabled} />
          <Box>
            <BlockStack gap="100">
              <Text as="p" variant="bodyMd" fontWeight="medium">Draw mark</Text>
              <canvas
                ref={canvasRef}
                width={700}
                height={220}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{ width: "100%", maxWidth: 700, height: 220, border: "1px solid #c9cccf", borderRadius: 10, background: "#ffffff", touchAction: "none" }}
              />
              <InlineStack gap="200" blockAlign="center">
                <Button onClick={clearPodImage} disabled={updatesDisabled || !podImage}>Clear mark</Button>
                {podImage ? <Text as="p" variant="bodySm" tone="success">Mark added</Text> : <Text as="p" variant="bodySm" tone="subdued">Use a finger or stylus.</Text>}
              </InlineStack>
            </BlockStack>
          </Box>
          <Checkbox label="Checked" checked={podTicked} onChange={setPodTicked} disabled={updatesDisabled} />
          <TextField label="Delivery note" name="deliveryNote" value={deliveryNote} onChange={setDeliveryNote} autoComplete="off" multiline={2} disabled={updatesDisabled} />
          <Checkbox label="Left in safe place" checked={leftInSafePlace} onChange={setLeftInSafePlace} disabled={updatesDisabled} />
          <TextField label="Safe place note" name="safePlaceNote" value={safePlaceNote} onChange={setSafePlaceNote} autoComplete="off" multiline={2} disabled={updatesDisabled} />
          <Button submit variant="primary" disabled={!canMarkDelivered}>Mark delivered</Button>
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
  const totalStops = route.stops.length;
  const pendingStops = route.stops.filter((stop) => stop.status === "PENDING").length;
  const deliveredStops = route.stops.filter((stop) => stop.status === "DELIVERED").length;
  const failedStops = route.stops.filter((stop) => stop.status === "FAILED").length;
  const completedStops = deliveredStops + failedStops;
  const progressPercent = totalStops ? Math.round((completedStops / totalStops) * 100) : 0;
  const remainingDrops = totalStops - completedStops;
  const pendingRouteStops = route.stops
    .filter((stop) => stop.status === "PENDING")
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const remainingRouteUrl = buildGoogleMapsRouteUrl(pendingRouteStops);
  const nextPendingOrderIndex = pendingStops
    ? Math.min(...route.stops.filter((stop) => stop.status === "PENDING").map((stop) => stop.orderIndex))
    : null;

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
                  {remainingRouteUrl ? <Button url={remainingRouteUrl} target="_blank">Open remaining route</Button> : null}
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

              <Box background="bg-surface-secondary" padding="300" borderRadius="300">
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="p" variant="bodyMd" fontWeight="bold">Route progress</Text>
                    <Text as="p" variant="bodyMd" fontWeight="bold">{progressPercent}%</Text>
                  </InlineStack>
                  <ProgressBar progress={progressPercent} size="small" />
                  <InlineStack gap="400">
                    <Text as="p" variant="bodySm">{completedStops} completed</Text>
                    <Text as="p" variant="bodySm">{remainingDrops} remaining</Text>
                    <Text as="p" variant="bodySm">{failedStops} failed</Text>
                  </InlineStack>
                </BlockStack>
              </Box>

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
              const googleMapsUrl = buildGoogleMapsUrl(stop);
              const appleMapsUrl = buildAppleMapsUrl(stop);
              const onWaySmsUrl = buildSmsUrl(cleanedPhone, "Your Bathroom Panels Direct delivery is on the way. We will be with you shortly.");
              const issueSmsUrl = buildSmsUrl(cleanedPhone, "This is Bathroom Panels Direct. We are trying to complete your delivery today but need to contact you about access.");
              const isFinalised = stop.status === "DELIVERED" || stop.status === "FAILED";
              const proofPhotos = stop.deliveryGroup?.proofPhotos || [];
              const orderLinks = stop.deliveryGroup?.orders || [];
              const isNextPendingStop = routeStarted && stop.status === "PENDING" && stop.orderIndex === nextPendingOrderIndex;
              const deliveryNote = stop.deliveryGroup?.deliveryNote?.trim();
              const safePlaceNote = stop.deliveryGroup?.safePlaceNote?.trim();

              return (
                <LegacyCard key={stop.id} sectioned>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="h3" variant="headingMd">Stop {stop.orderIndex}</Text>
                          {isNextPendingStop ? <Badge tone="success">NEXT DROP</Badge> : null}
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">Orders: {orders}</Text>
                      </BlockStack>
                      <Badge tone={statusTone(stop.status)}>{stop.status}</Badge>
                    </InlineStack>
                    <Divider />
                    <Box>
                      <BlockStack gap="200">
                        {isNextPendingStop ? (
                          <Box background="bg-surface-success" padding="300" borderRadius="300">
                            <BlockStack gap="100">
                              <Text as="p" variant="bodyMd" fontWeight="bold">This is the next delivery</Text>
                              <Text as="p" variant="bodySm">Open navigation before leaving, then complete the POD once the delivery is finished.</Text>
                            </BlockStack>
                          </Box>
                        ) : null}
                        {(deliveryNote || safePlaceNote) ? (
                          <Box background="bg-surface-warning" padding="300" borderRadius="300">
                            <BlockStack gap="100">
                              <Text as="p" variant="bodyMd" fontWeight="bold">Driver notes</Text>
                              {deliveryNote ? <Text as="p" variant="bodySm">Delivery note: {deliveryNote}</Text> : null}
                              {safePlaceNote ? <Text as="p" variant="bodySm">Safe place: {safePlaceNote}</Text> : null}
                            </BlockStack>
                          </Box>
                        ) : null}
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
                      </BlockStack>
                    </Box>
                    <InlineStack gap="200">
                      {wazeUrl ? <Button url={wazeUrl} target="_blank" accessibilityLabel={`Open stop ${stop.orderIndex} in Waze`}>Waze</Button> : null}
                      {googleMapsUrl ? <Button url={googleMapsUrl} target="_blank" accessibilityLabel={`Open stop ${stop.orderIndex} in Google Maps`}>Google Maps</Button> : null}
                      {appleMapsUrl ? <Button url={appleMapsUrl} target="_blank" accessibilityLabel={`Open stop ${stop.orderIndex} in Apple Maps`}>Apple Maps</Button> : null}
                      {cleanedPhone ? <Button url={`tel:${cleanedPhone}`} accessibilityLabel={`Call customer for stop ${stop.orderIndex}`}>Call customer</Button> : null}
                      {onWaySmsUrl ? <Button url={onWaySmsUrl} accessibilityLabel={`Text customer that stop ${stop.orderIndex} is on the way`}>Text on way</Button> : null}
                      {issueSmsUrl ? <Button url={issueSmsUrl} accessibilityLabel={`Text customer about access for stop ${stop.orderIndex}`}>Text access issue</Button> : null}
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
