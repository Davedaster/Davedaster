import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
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
} from "@shopify/polaris";

import { formatEtaSlot } from "../lib/etaSlots.server";
import { getDriverRoute, startDriverRoute } from "../lib/driverRoutes.server";
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

  return json({ route });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const routeId = params.routeId;

  if (routeId) {
    await startDriverRoute(routeId);
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

export default function DriverRouteDetails() {
  const { route } = useLoaderData<typeof loader>();
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
                {route.status !== "OUT_FOR_DELIVERY" ? (
                  <Form method="post">
                    <Button submit variant="primary">Start route</Button>
                  </Form>
                ) : (
                  <Badge tone="success">OUT_FOR_DELIVERY</Badge>
                )}
              </InlineStack>
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
