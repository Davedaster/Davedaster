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
import { useState } from "react";

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
      return json({ ok: false, error: error instanceof Error ? error.message : "Proof photo delete failed." }, { status: 400 });
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

function tidyPhone(phone?: string | null) {
  if (!phone) {
    return null;
  }

  return phone.replace(/[^+\d]/g, "");
}

function ProofPhotoGallery({ proofPhotos }: { proofPhotos: Array<{ id: string; url: string; label?: string | null }> }) {
  if (!proofPhotos.length) {
    return null;
  }

  return (
    <BlockStack gap="200">
      <Text as="p" variant="bodySm" tone="subdued">Proof photos</Text>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 12 }}>
        {proofPhotos.map((photo, index) => (
          <div key={photo.id} style={{ border: "1px solid #d0d5dd", borderRadius: 12, padding: 8, background: "#ffffff" }}>
            <a href={photo.url} target="_blank" rel="noreferrer" style={{ display: "block", textDecoration: "none" }}>
              <img
                src={photo.url}
                alt={photo.label || `Proof photo ${index + 1}`}
                style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 8, display: "block" }}
              />
            </a>
            <Text as="p" variant="bodySm">{photo.label || `Proof photo ${index + 1}`}</Text>
            <InlineStack gap="100">
              <Button size="slim" url={photo.url} target="_blank">Open</Button>
              <Form method="post">
                <input type="hidden" name="intent" value="deleteProofPhoto" />
                <input type="hidden" name="proofPhotoId" value={photo.id} />
                <Button submit size="slim" tone="critical">Delete</Button>
              </Form>
            </InlineStack>
          </div>
        ))}
      </div>
    </BlockStack>
  );
}

function DriverStopActions({ stopId, isDisabled, routeStarted, proofPhotoStorageEnabled }: { stopId: string; isDisabled: boolean; routeStarted: boolean; proofPhotoStorageEnabled: boolean }) {
  const [leftInSafePlace, setLeftInSafePlace] = useState(false);
  const [proofPhotoUrl, setProofPhotoUrl] = useState("");
  const [proofPhotoCount, setProofPhotoCount] = useState(0);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [safePlaceNote, setSafePlaceNote] = useState("");
  const [failedReason, setFailedReason] = useState("");
  const [failedNote, setFailedNote] = useState("");
  const updatesDisabled = isDisabled || !routeStarted;
  const hasProofPhoto = proofPhotoCount > 0 || proofPhotoUrl.trim().length > 0;

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
        <BlockStack gap="200">
          {proofPhotoStorageEnabled ? (
            <label>
              <Text as="span" variant="bodyMd" fontWeight="medium">Proof photos</Text>
              <input
                type="file"
                name="proofPhotoFiles"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                capture="environment"
                multiple
                disabled={updatesDisabled}
                onChange={(event) => setProofPhotoCount(event.currentTarget.files?.length || 0)}
                style={{ display: "block", marginTop: 6 }}
              />
              {proofPhotoCount > 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">{proofPhotoCount} photo{proofPhotoCount === 1 ? "" : "s"} selected</Text>
              ) : null}
            </label>
          ) : null}
          <TextField
            label={proofPhotoStorageEnabled ? "Proof photo link fallback" : "Proof photo link"}
            name="proofPhotoUrl"
            type="url"
            value={proofPhotoUrl}
            onChange={setProofPhotoUrl}
            autoComplete="off"
            disabled={updatesDisabled}
            helpText={proofPhotoStorageEnabled ? "Upload one or more photos above, or paste a hosted link if needed." : "Required before marking delivered."}
          />
          <TextField
            label="Delivery note"
            name="deliveryNote"
            value={deliveryNote}
            onChange={setDeliveryNote}
            autoComplete="off"
            multiline={2}
            disabled={updatesDisabled}
          />
          <Checkbox
            label="Left in safe place"
            checked={leftInSafePlace}
            onChange={setLeftInSafePlace}
            disabled={updatesDisabled}
          />
          <TextField
            label="Safe place note"
            name="safePlaceNote"
            value={safePlaceNote}
            onChange={setSafePlaceNote}
            autoComplete="off"
            multiline={2}
            disabled={updatesDisabled}
          />
          <Button submit variant="primary" disabled={updatesDisabled || !hasProofPhoto}>Mark delivered</Button>
        </BlockStack>
      </Form>

      <Form method="post">
        <input type="hidden" name="intent" value="failedStop" />
        <input type="hidden" name="stopId" value={stopId} />
        <BlockStack gap="200">
          <TextField
            label="Failed delivery reason"
            name="failedReason"
            value={failedReason}
            onChange={setFailedReason}
            autoComplete="off"
            disabled={updatesDisabled}
            helpText="Required before marking failed."
          />
          <TextField
            label="Failed delivery note"
            name="failedNote"
            value={failedNote}
            onChange={setFailedNote}
            autoComplete="off"
            multiline={2}
            disabled={updatesDisabled}
          />
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
    <Page
      title={route.name}
      backAction={{ content: "Driver routes", url: "/app/driver-routes" }}
    >
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Driver route details</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {formatDate(route.date)} · Driver: {route.driver?.name || "No driver assigned"}
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {route.stops.length} stops · {pendingStops} pending · {deliveredStops} delivered · {failedStops} failed
                  </Text>
                </BlockStack>
                {!routeStarted ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="startRoute" />
                    <Button submit variant="primary">Start route</Button>
                  </Form>
                ) : (
                  <Badge tone="success">OUT_FOR_DELIVERY</Badge>
                )}
              </InlineStack>

              {!proofPhotoStorageEnabled ? (
                <Text as="p" variant="bodySm" tone="subdued">Proof photo storage is not set up yet, so hosted proof photo links can still be pasted manually.</Text>
              ) : null}

              {actionData && "error" in actionData ? (
                <Text as="p" variant="bodyMd" tone="critical">{actionData.error}</Text>
              ) : null}
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
                        <BlockStack gap="050">
                          <Text as="p" variant="bodySm" tone="subdued">Customer</Text>
                          <Text as="p" variant="bodyMd" fontWeight="bold">{customerNames}</Text>
                        </BlockStack>

                        <BlockStack gap="050">
                          <Text as="p" variant="bodySm" tone="subdued">Address</Text>
                          <Text as="p" variant="bodyMd">{address}</Text>
                          <Text as="p" variant="bodyMd" fontWeight="bold">{stop.deliveryGroup?.postcode || "No postcode"}</Text>
                        </BlockStack>

                        <BlockStack gap="050">
                          <Text as="p" variant="bodySm" tone="subdued">ETA slot</Text>
                          <Text as="p" variant="bodyMd" fontWeight="bold">{formatSlot(stop.estimatedArrival)}</Text>
                        </BlockStack>

                        <BlockStack gap="050">
                          <Text as="p" variant="bodySm" tone="subdued">Phone</Text>
                          <Text as="p" variant="bodyMd">{phone || "No phone"}</Text>
                        </BlockStack>

                        <ProofPhotoGallery proofPhotos={proofPhotos} />
                      </BlockStack>
                    </Box>

                    <InlineStack gap="200">
                      {wazeUrl ? (
                        <Button url={wazeUrl} target="_blank" accessibilityLabel={`Open stop ${stop.orderIndex} in Waze`}>
                          Open Waze
                        </Button>
                      ) : null}
                      {cleanedPhone ? (
                        <Button url={`tel:${cleanedPhone}`} accessibilityLabel={`Call customer for stop ${stop.orderIndex}`}>
                          Call customer
                        </Button>
                      ) : null}
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
