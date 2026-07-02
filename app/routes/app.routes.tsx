import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
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

import { listRoutes } from "../lib/routeDrafts.server";
import { authenticate } from "../shopify.server";

type RouteListItem = Awaited<ReturnType<typeof listRoutes>>[number];
type StopListItem = RouteListItem["stops"][number];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const routes = await listRoutes();

  return json({ routes });
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatTime(value: string | Date | null | undefined) {
  if (!value) {
    return "Pending";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Pending";
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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

function LiveRouteProgressCard({ route }: { route: RouteListItem }) {
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
          <Button url={`/app/routes/${route.id}`}>Open route</Button>
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
        ) : (
          <Box background="bg-surface-secondary" padding="300" borderRadius="300">
            <Text as="p" variant="bodyMd" fontWeight="bold">No remaining drops.</Text>
          </Box>
        )}

        {remainingStops.length ? (
          <BlockStack gap="150">
            <Text as="h4" variant="headingSm">Remaining ETAs</Text>
            {remainingStops.map((stop) => (
              <InlineStack key={stop.id} align="space-between" gap="300">
                <Text as="span" variant="bodySm">Stop {stop.orderIndex} · {stopCustomerLabel(stop)}</Text>
                <Text as="span" variant="bodySm" tone="subdued">{formatDateTime(stop.estimatedArrival)}</Text>
              </InlineStack>
            ))}
          </BlockStack>
        ) : null}
      </BlockStack>
    </LegacyCard>
  );
}

export default function Routes() {
  const { routes } = useLoaderData<typeof loader>();
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
            </BlockStack>
          </LegacyCard>

          {liveRoutes.length ? (
            <BlockStack gap="300">
              {liveRoutes.map((route) => <LiveRouteProgressCard key={route.id} route={route} />)}
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
                renderItem={(route) => (
                  <ResourceItem
                    id={route.id}
                    url={`/app/routes/${route.id}`}
                    accessibilityLabel={`View ${route.name}`}
                  >
                    <InlineStack align="space-between" blockAlign="center" gap="300">
                      <BlockStack gap="100">
                        <Text as="h3" variant="bodyMd" fontWeight="bold">
                          {route.name}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {formatDate(route.date)} · Start {route.plannedStartTime || "05:00"} · {route.timePerDropMinutes || 10} min/drop · {route.stops.length} stops
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Driver: {route.driver?.name || "No driver assigned"}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Start: {route.startAddress || "Bathroom Panels Direct"}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          Finish: {route.finishAddress || "Bathroom Panels Direct"}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {route.stops
                            .map((stop) => stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).join(", "))
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </BlockStack>
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone={statusTone(route.status)}>{route.status}</Badge>
                        <Button url={`/app/routes/${route.id}`}>Open route</Button>
                      </InlineStack>
                    </InlineStack>
                  </ResourceItem>
                )}
              />
            )}
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
