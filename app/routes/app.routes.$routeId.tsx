import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  Text,
  Badge,
  BlockStack,
  InlineStack,
  Button,
  DataTable,
  TextField,
  Select,
} from "@shopify/polaris";
import { useState } from "react";

import { listActiveDrivers } from "../lib/drivers.server";
import { assignDriverToRoute, getRoute, publishRoute, renameRoute } from "../lib/routeDrafts.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const routeId = params.routeId;

  if (!routeId) {
    throw new Response("Route not found", { status: 404 });
  }

  const [route, drivers] = await Promise.all([
    getRoute(routeId),
    listActiveDrivers(),
  ]);

  if (!route) {
    throw new Response("Route not found", { status: 404 });
  }

  return json({ route, drivers });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const routeId = params.routeId;

  if (!routeId) {
    throw new Response("Route not found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "publish") {
    await publishRoute(routeId);
    return redirect(`/app/routes/${routeId}`);
  }

  if (intent === "rename") {
    const name = String(formData.get("name") || "").trim();

    if (name) {
      await renameRoute(routeId, name);
    }

    return redirect(`/app/routes/${routeId}`);
  }

  if (intent === "assignDriver") {
    const driverIdValue = String(formData.get("driverId") || "").trim();
    await assignDriverToRoute(routeId, driverIdValue || null);

    return redirect(`/app/routes/${routeId}`);
  }

  return redirect(`/app/routes/${routeId}`);
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function statusTone(status: string) {
  if (status === "DRAFT") {
    return "info" as const;
  }

  if (status === "PUBLISHED") {
    return "success" as const;
  }

  return "attention" as const;
}

export default function RouteDetails() {
  const { route, drivers } = useLoaderData<typeof loader>();
  const [routeName, setRouteName] = useState(route.name);
  const [driverId, setDriverId] = useState(route.driverId || "");
  const canPublish = route.status === "DRAFT";
  const canRename = route.status === "DRAFT" || route.status === "PUBLISHED";

  const driverOptions = [
    { label: "No driver assigned", value: "" },
    ...drivers.map((driver) => ({
      label: `${driver.name}${driver.vehicleName ? `, ${driver.vehicleName}` : ""}${driver.vehicleRegistration ? `, ${driver.vehicleRegistration}` : ""}`,
      value: driver.id,
    })),
  ];

  const stopRows = route.stops.map((stop) => {
    const deliveryGroup = stop.deliveryGroup;
    const orders = deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).join(", ") || "No linked orders";

    return [
      String(stop.orderIndex),
      orders,
      deliveryGroup?.postcode || "No postcode",
      deliveryGroup?.address || "No address",
      stop.isLocked ? "Locked" : "Open",
    ];
  });

  const historyRows = route.history.map((event) => [
    new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(event.createdAt)),
    event.action,
    event.details || "",
  ]);

  return (
    <Page
      title={route.name}
      backAction={{ content: "Routes", url: "/app/routes" }}
      primaryAction={canPublish ? {
        content: "Publish route",
        disabled: route.stops.length === 0,
        onAction: () => document.getElementById("publish-route-form")?.requestSubmit(),
      } : undefined}
    >
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Route details</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {formatDate(route.date)} · {route.stops.length} stops
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Driver: {route.driver?.name || "No driver assigned"}
                  </Text>
                </BlockStack>
                <Badge tone={statusTone(route.status)}>{route.status}</Badge>
              </InlineStack>

              {canRename ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="rename" />
                  <InlineStack gap="200" blockAlign="end">
                    <TextField
                      label="Route name"
                      name="name"
                      value={routeName}
                      onChange={setRouteName}
                      autoComplete="off"
                    />
                    <Button submit>Save name</Button>
                  </InlineStack>
                </Form>
              ) : null}

              <Form method="post">
                <input type="hidden" name="intent" value="assignDriver" />
                <InlineStack gap="200" blockAlign="end">
                  <Select
                    label="Driver"
                    name="driverId"
                    options={driverOptions}
                    value={driverId}
                    onChange={setDriverId}
                  />
                  <Button submit>Save driver</Button>
                </InlineStack>
              </Form>

              <Form id="publish-route-form" method="post">
                <input type="hidden" name="intent" value="publish" />
              </Form>
            </BlockStack>
          </LegacyCard>

          <LegacyCard title="Stops">
            <DataTable
              columnContentTypes={["numeric", "text", "text", "text", "text"]}
              headings={["Stop", "Orders", "Postcode", "Address", "Lock"]}
              rows={stopRows}
            />
          </LegacyCard>

          <LegacyCard title="History">
            <DataTable
              columnContentTypes={["text", "text", "text"]}
              headings={["Time", "Action", "Details"]}
              rows={historyRows}
            />
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
