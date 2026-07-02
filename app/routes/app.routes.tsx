import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  Text,
  ResourceList,
  ResourceItem,
  Badge,
  BlockStack,
  InlineStack,
  EmptyState,
  Box,
  Button,
} from "@shopify/polaris";

import { deleteDraftRoute, getRouteActionSummary } from "../lib/draftRouteActions.server";
import { getFulfilmentSettings } from "../lib/fulfilmentSettings.server";
import { listActiveDrivers } from "../lib/drivers.server";
import { assignDriverToRoute, calculateEtaSlots, listRoutes, publishRoute } from "../lib/routeDrafts.server";
import { sendDriverRouteLink } from "../lib/driverRouteAccess.server";
import { sendBookedSlotNotifications } from "../lib/routeNotifications.server";
import { fulfilRouteOrders } from "../lib/shopifyFulfilment.server";
import { tagPublishedRouteOrders } from "../lib/shopifyOrderTags.server";
import { authenticate } from "../shopify.server";

type RouteListItem = Awaited<ReturnType<typeof listRoutes>>[number];
type StopListItem = RouteListItem["stops"][number];
type DriverListItem = Awaited<ReturnType<typeof listActiveDrivers>>[number];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const [routes, drivers] = await Promise.all([
    listRoutes(),
    listActiveDrivers(),
  ]);

  return json({ routes, drivers });
};

function tick(value: boolean) {
  return value ? "✓" : "✗";
}

function publishMessage(input: {
  driverSms: boolean;
  driverEmail: boolean;
  customerSms: number;
  customerEmail: number;
  customerSkipped: number;
  fulfilmentMode: string;
  fulfilmentFulfilled: number;
  fulfilmentSkipped: number;
  errors: string[];
}) {
  return [
    "Route published",
    `Driver SMS ${tick(input.driverSms)}`,
    `Driver email ${tick(input.driverEmail)}`,
    `Customer SMS ${input.customerSms > 0 ? "✓" : "✗"} (${input.customerSms} sent)`,
    `Customer email ${input.customerEmail > 0 ? "✓" : "✗"} (${input.customerEmail} sent)`,
    input.customerSkipped ? `${input.customerSkipped} customer orders skipped` : "No customer orders skipped",
    input.fulfilmentMode === "on_publish"
      ? `Shopify fulfilment on publish: ${input.fulfilmentFulfilled} fulfilled, ${input.fulfilmentSkipped} skipped`
      : "Shopify fulfilment will happen when each delivery is completed",
    input.errors.length ? `Errors: ${input.errors.join(" | ")}` : "",
  ].filter(Boolean).join(" · ");
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const routeId = String(formData.get("routeId") || "").trim();

  if (!routeId) {
    return json({ ok: false, error: "Route could not be found." }, { status: 400 });
  }

  if (intent === "assignDriver") {
    try {
      const driverId = String(formData.get("driverId") || "").trim();
      await assignDriverToRoute(routeId, driverId || null);
      return json({ ok: true, message: "Driver saved on route." });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Driver could not be saved." }, { status: 400 });
    }
  }

  if (intent === "deleteDraft") {
    try {
      await deleteDraftRoute(routeId);
      return json({ ok: true, message: "Draft route deleted." });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Draft route could not be deleted." }, { status: 400 });
    }
  }

  if (intent === "publish") {
    try {
      const route = await getRouteActionSummary(routeId);

      if (!route) {
        return json({ ok: false, error: "Route could not be found." }, { status: 404 });
      }

      if (route.status !== "DRAFT") {
        return json({ ok: false, error: "Only draft routes can be published from this card." }, { status: 400 });
      }

      if (!route.driverId) {
        return json({ ok: false, error: "Assign a driver before publishing this route." }, { status: 400 });
      }

      await publishRoute(routeId);
      await calculateEtaSlots(routeId);
      await tagPublishedRouteOrders(admin, routeId);

      const fulfilmentSettings = await getFulfilmentSettings();
      const fulfilmentResult = fulfilmentSettings.routePublishFulfilmentMode === "on_publish"
        ? await fulfilRouteOrders(admin, routeId)
        : { fulfilled: 0, skipped: 0, errors: [] };
      const driverResult = await sendDriverRouteLink({ routeId, request });
      const customerResult = await sendBookedSlotNotifications(routeId);
      const errors = [...fulfilmentResult.errors, ...driverResult.errors, ...customerResult.errors];

      return json({
        ok: true,
        message: publishMessage({
          driverSms: driverResult.smsSent,
          driverEmail: driverResult.emailSent,
          customerSms: customerResult.smsSent,
          customerEmail: customerResult.emailsSent,
          customerSkipped: customerResult.skipped,
          fulfilmentMode: fulfilmentSettings.routePublishFulfilmentMode,
          fulfilmentFulfilled: fulfilmentResult.fulfilled,
          fulfilmentSkipped: fulfilmentResult.skipped,
          errors,
        }),
        errors,
      });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Route could not be published." }, { status: 400 });
    }
  }

  return json({ ok: false, error: "Route action was not recognised." }, { status: 400 });
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) {
    return "Pending";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusTone(status: string) {
  if (status === "DRAFT") {
    return "info" as const;
  }

  if (status === "PUBLISHED" || status === "NOTIFICATIONS_SENT") {
    return "success" as const;
  }

  if (status === "OUT_FOR_DELIVERY") {
    return "attention" as const;
  }

  if (status === "COMPLETED") {
    return "success" as const;
  }

  return "attention" as const;
}

function routeLiveLabel(status: string) {
  if (status === "OUT_FOR_DELIVERY") {
    return "Driver out";
  }

  if (status === "PUBLISHED" || status === "NOTIFICATIONS_SENT") {
    return "Ready, not started";
  }

  return status.replaceAll("_", " ").toLowerCase();
}

function isRouteInProgress(route: RouteListItem) {
  return ["PUBLISHED", "NOTIFICATIONS_SENT", "OUT_FOR_DELIVERY"].includes(route.status);
}

function isStopDone(stop: StopListItem) {
  return stop.status === "DELIVERED" || stop.status === "FAILED";
}

function stopCustomerLabel(stop: StopListItem) {
  const names = stop.deliveryGroup?.orders.map((order) => order.customerName).filter(Boolean).join(", ");
  const orders = stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).filter(Boolean).join(", ");
  const postcode = stop.deliveryGroup?.postcode || "No postcode";

  return [orders, names, postcode].filter(Boolean).join(" · ");
}

function stopEtaLabel(stop: StopListItem) {
  if (stop.status === "DELIVERED") {
    return `Delivered ${formatDateTime(stop.actualArrival)}`;
  }

  if (stop.status === "FAILED") {
    return `Missed ${formatDateTime(stop.actualArrival)}`;
  }

  return `ETA ${formatDateTime(stop.estimatedArrival)}`;
}

function estimateFinishTime(route: RouteListItem) {
  const orderedStops = [...route.stops].sort((a, b) => a.orderIndex - b.orderIndex);
  const remainingStops = orderedStops.filter((stop) => stop.status === "PENDING");
  const timePerDropMinutes = Math.max(1, route.timePerDropMinutes || 10);

  if (remainingStops.length) {
    const lastRemainingEta = remainingStops[remainingStops.length - 1]?.estimatedArrival;

    if (lastRemainingEta) {
      return new Date(new Date(lastRemainingEta).getTime() + timePerDropMinutes * 60 * 1000);
    }
  }

  const lastActual = [...orderedStops]
    .reverse()
    .find((stop) => stop.actualArrival)?.actualArrival;

  return lastActual || null;
}

function finishLocationLabel(route: RouteListItem) {
  const finishAddress = route.finishAddress || route.startAddress || "Base";
  const startAddress = route.startAddress || "";
  const returnsToBase = finishAddress.trim().toLowerCase() === startAddress.trim().toLowerCase() || finishAddress.toLowerCase().includes("olympus");

  return returnsToBase ? "Return to base" : "Custom end point";
}

function ProgressBar({ value }: { value: number }) {
  const safeValue = Math.max(0, Math.min(100, value));

  return (
    <div style={{ width: "100%", height: 10, background: "#eef2f7", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ width: `${safeValue}%`, height: "100%", background: "#509AE6", borderRadius: 999 }} />
    </div>
  );
}

function DriverSelect({ route, drivers }: { route: RouteListItem; drivers: DriverListItem[] }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="assignDriver" />
      <input type="hidden" name="routeId" value={route.id} />
      <InlineStack gap="200" blockAlign="center" wrap>
        <label style={{ fontSize: 13, fontWeight: 600 }} htmlFor={`driver-${route.id}`}>Driver</label>
        <select
          id={`driver-${route.id}`}
          name="driverId"
          defaultValue={route.driverId || ""}
          style={{ minWidth: 180, minHeight: 32, borderRadius: 8, border: "1px solid #c9cccf", padding: "4px 8px" }}
        >
          <option value="">No driver</option>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>{driver.name}</option>
          ))}
        </select>
        <Button submit>Save driver</Button>
      </InlineStack>
    </Form>
  );
}

function LiveRouteProgressCard({ route, drivers }: { route: RouteListItem; drivers: DriverListItem[] }) {
  const orderedStops = [...route.stops].sort((a, b) => a.orderIndex - b.orderIndex);
  const completedStops = orderedStops.filter(isStopDone);
  const deliveredStops = orderedStops.filter((stop) => stop.status === "DELIVERED");
  const failedStops = orderedStops.filter((stop) => stop.status === "FAILED");
  const remainingStops = orderedStops.filter((stop) => stop.status === "PENDING");
  const nextStop = remainingStops[0];
  const progress = orderedStops.length ? Math.round((completedStops.length / orderedStops.length) * 100) : 0;
  const finishTime = estimateFinishTime(route);

  return (
    <LegacyCard sectioned>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" gap="300">
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h3" variant="headingMd">{route.driver?.name || "No driver"}</Text>
              <Badge tone={statusTone(route.status)}>{routeLiveLabel(route.status)}</Badge>
            </InlineStack>
            <Text as="p" variant="bodyMd" tone="subdued">{route.name} · {formatDate(route.date)}</Text>
            <Text as="p" variant="bodySm" tone="subdued">Start {route.plannedStartTime || "05:00"} · {finishLocationLabel(route)}: {route.finishAddress || route.startAddress || "Base"}</Text>
          </BlockStack>
          <DriverSelect route={route} drivers={drivers} />
        </InlineStack>

        <BlockStack gap="150">
          <InlineStack align="space-between">
            <Text as="span" variant="bodySm">{completedStops.length}/{orderedStops.length} stops resolved</Text>
            <Text as="span" variant="bodySm" tone="subdued">{progress}%</Text>
          </InlineStack>
          <ProgressBar value={progress} />
        </BlockStack>

        <InlineStack gap="400" wrap>
          <Text as="span" variant="bodyMd">Delivered: {deliveredStops.length}</Text>
          <Text as="span" variant="bodyMd">Missed: {failedStops.length}</Text>
          <Text as="span" variant="bodyMd">To go: {remainingStops.length}</Text>
          <Text as="span" variant="bodyMd">Finish target: {formatDateTime(finishTime)}</Text>
        </InlineStack>

        {nextStop ? (
          <Box background="bg-surface-secondary" padding="300" borderRadius="300">
            <BlockStack gap="100">
              <Text as="p" variant="bodyMd" fontWeight="bold">Next drop: Stop {nextStop.orderIndex}</Text>
              <Text as="p" variant="bodySm">{stopCustomerLabel(nextStop)}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{stopEtaLabel(nextStop)}</Text>
            </BlockStack>
          </Box>
        ) : null}
      </BlockStack>
    </LegacyCard>
  );
}

function RouteCard({ route, drivers }: { route: RouteListItem; drivers: DriverListItem[] }) {
  const isDraft = route.status === "DRAFT";

  return (
    <ResourceItem id={route.id} accessibilityLabel={`View ${route.name}`} onClick={() => {}}>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" gap="300">
          <BlockStack gap="100">
            <Text as="h3" variant="bodyMd" fontWeight="bold">{route.name}</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {formatDate(route.date)} · Start {route.plannedStartTime || "05:00"} · {route.timePerDropMinutes || 10} min/drop · {route.stops.length} stops
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">Driver: {route.driver?.name || "No driver assigned"}</Text>
            <Text as="p" variant="bodySm" tone="subdued">Start: {route.startAddress || "Bathroom Panels Direct"}</Text>
            <Text as="p" variant="bodySm" tone="subdued">Finish: {route.finishAddress || "Bathroom Panels Direct"}</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {route.stops
                .map((stop) => stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).join(", "))
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </BlockStack>
          <Badge tone={statusTone(route.status)}>{route.status}</Badge>
        </InlineStack>

        <Box background="bg-surface-secondary" padding="300" borderRadius="300">
          <BlockStack gap="250">
            <DriverSelect route={route} drivers={drivers} />

            {isDraft ? (
              <InlineStack gap="200" wrap>
                <Form method="post">
                  <input type="hidden" name="intent" value="publish" />
                  <input type="hidden" name="routeId" value={route.id} />
                  <Button submit variant="primary" disabled={!route.driverId}>Publish route and notify</Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="deleteDraft" />
                  <input type="hidden" name="routeId" value={route.id} />
                  <Button submit tone="critical">Delete draft</Button>
                </Form>
              </InlineStack>
            ) : (
              <Text as="p" variant="bodySm" tone="subdued">This route is no longer a draft. Publishing and deleting are locked.</Text>
            )}
          </BlockStack>
        </Box>
      </BlockStack>
    </ResourceItem>
  );
}

export default function Routes() {
  const { routes, drivers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const liveRoutes = routes.filter(isRouteInProgress);

  return (
    <Page title="Routes">
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Live route progress</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Track drivers that are ready or out on the road, with completed drops, remaining drops, next ETA and finish target.
                  </Text>
                </BlockStack>
                <Badge tone={liveRoutes.length ? "attention" : "success"}>{liveRoutes.length ? `${liveRoutes.length} active` : "No live routes"}</Badge>
              </InlineStack>
              {actionData && "message" in actionData ? <Text as="p" variant="bodyMd" tone="success">{actionData.message}</Text> : null}
              {actionData && "error" in actionData ? <Text as="p" variant="bodyMd" tone="critical">{actionData.error}</Text> : null}
            </BlockStack>
          </LegacyCard>

          {liveRoutes.length ? (
            <BlockStack gap="300">
              {liveRoutes.map((route) => <LiveRouteProgressCard key={route.id} route={route} drivers={drivers} />)}
            </BlockStack>
          ) : (
            <LegacyCard sectioned>
              <Text as="p" variant="bodyMd" tone="subdued">No published or active delivery routes are currently running.</Text>
            </LegacyCard>
          )}

          <LegacyCard>
            {routes.length === 0 ? (
              <EmptyState
                heading="No saved routes yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Create a draft route from the Orders Map by selecting delivery pins.</p>
              </EmptyState>
            ) : (
              <ResourceList
                resourceName={{ singular: "route", plural: "routes" }}
                items={routes}
                renderItem={(route) => <RouteCard route={route} drivers={drivers} />}
              />
            )}
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
