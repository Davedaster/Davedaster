import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  Text,
  BlockStack,
  DataTable,
  Badge,
  Button,
  InlineStack,
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

export default function DriverRouteDetails() {
  const { route } = useLoaderData<typeof loader>();

  const rows = route.stops.map((stop) => {
    const orders = stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).join(", ") || "No linked orders";
    const customerNames = stop.deliveryGroup?.orders.map((order) => order.customerName).filter(Boolean).join(", ") || "No customer name";
    const address = stop.deliveryGroup?.address || stop.deliveryGroup?.formattedAddress || "No address";
    const phone = stop.deliveryGroup?.orders.map((order) => order.customerPhone).filter(Boolean)[0] || "No phone";

    return [
      String(stop.orderIndex),
      orders,
      customerNames,
      address,
      stop.deliveryGroup?.postcode || "No postcode",
      phone,
      formatSlot(stop.estimatedArrival),
      <Badge tone={statusTone(stop.status)}>{stop.status}</Badge>,
    ];
  });

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
                    {route.stops.length} stops · Status: {route.status}
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

          <LegacyCard title="Stops">
            <DataTable
              columnContentTypes={["numeric", "text", "text", "text", "text", "text", "text", "text"]}
              headings={["Stop", "Orders", "Customer", "Address", "Postcode", "Phone", "ETA slot", "Status"]}
              rows={rows}
            />
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
