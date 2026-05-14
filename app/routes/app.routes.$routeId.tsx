import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useActionData } from "@remix-run/react";
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
import { formatEtaSlot } from "../lib/etaSlots.server";
import { assignDriverToRoute, calculateEtaSlots, getRoute, optimiseRoute, publishRoute, renameRoute } from "../lib/routeDrafts.server";
import { tagPublishedRouteOrders } from "../lib/shopifyOrderTags.server";
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

  return json({ route, drivers, routexlEnabled: Boolean(process.env.ROUTEXL_USERNAME && process.env.ROUTEXL_PASSWORD) });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const routeId = params.routeId;

  if (!routeId) {
    throw new Response("Route not found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "publish") {
    try {
      await publishRoute(routeId);
      await tagPublishedRouteOrders(admin, routeId);
      return redirect(`/app/routes/${routeId}`);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Route publishing failed." }, { status: 400 });
    }
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

  if (intent === "optimise") {
    try {
      await optimiseRoute(routeId);
      return redirect(`/app/routes/${routeId}`);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Route optimisation failed." }, { status: 400 });
    }
  }

  if (intent === "calculateEtas") {
    try {
      const startTime = String(formData.get("startTime") || "05:00");
      const stopMinutes = Number(formData.get("stopMinutes") || 10);
      const slotMinutes = Number(formData.get("slotMinutes") || 60);

      await calculateEtaSlots(
        routeId,
        startTime,
        Number.isFinite(stopMinutes) ? stopMinutes : 10,
        Number.isFinite(slotMinutes) ? slotMinutes : 60,
      );
      return redirect(`/app/routes/${routeId}`);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "ETA calculation failed." }, { status: 400 });
    }
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
  const { route, drivers, routexlEnabled } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [routeName, setRouteName] = useState(route.name);
  const [driverId, setDriverId] = useState(route.driverId || "");
  const [startTime, setStartTime] = useState("05:00");
  const [stopMinutes, setStopMinutes] = useState("10");
  const [slotMinutes, setSlotMinutes] = useState("60");
  const canPublish = route.status === "DRAFT";
  const canRename = route.status === "DRAFT" || route.status === "PUBLISHED";

  const driverOptions = [
    { label: "No driver assigned", value: "" },
    ...drivers.map((driver) => ({
      label: `${driver.name}${driver.vehicleName ? `, ${driver.vehicleName}` : ""}${driver.vehicleRegistration ? `, ${driver.vehicleRegistration}` : ""}`,
      value: driver.id,
    })),
  ];

  const slotMinutesNumber = Number(slotMinutes);

  const stopRows = route.stops.map((stop) => {
    const deliveryGroup = stop.deliveryGroup;
    const orders = deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).join(", ") || "No linked orders";
    const estimatedArrival = stop.estimatedArrival ? new Date(stop.estimatedArrival) : null;
    const slotEnd = estimatedArrival ? new Date(estimatedArrival.getTime() + (Number.isFinite(slotMinutesNumber) ? slotMinutesNumber : 60) * 60 * 1000) : null;

    return [
      String(stop.orderIndex),
      orders,
      deliveryGroup?.postcode || "No postcode",
      deliveryGroup?.address || "No address",
      estimatedArrival && slotEnd ? formatEtaSlot(estimatedArrival, slotEnd) : "Pending",
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
                  <Text as="p" variant="bodySm" tone="subdued">
                    Distance: {route.totalMileage ? `${route.totalMileage.toFixed(1)} km` : "Pending"} · Time: {route.totalDuration ? `${route.totalDuration} minutes` : "Pending"}
                  </Text>
                </BlockStack>
                <Badge tone={statusTone(route.status)}>{route.status}</Badge>
              </InlineStack>

              {actionData && "error" in actionData ? (
                <Text as="p" variant="bodyMd" tone="critical">{actionData.error}</Text>
              ) : null}

              {!routexlEnabled ? (
                <Text as="p" variant="bodySm" tone="critical">
                  RouteXL is not enabled yet. Add ROUTEXL_USERNAME and ROUTEXL_PASSWORD to the app environment before optimising live routes.
                </Text>
              ) : null}

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

              <InlineStack gap="200">
                <Form method="post">
                  <input type="hidden" name="intent" value="optimise" />
                  <Button submit disabled={!routexlEnabled || route.stops.length === 0}>Optimise with RouteXL</Button>
                </Form>
              </InlineStack>

              <Form method="post">
                <input type="hidden" name="intent" value="calculateEtas" />
                <InlineStack gap="200" blockAlign="end">
                  <TextField
                    label="Driver start time"
                    name="startTime"
                    type="time"
                    value={startTime}
                    onChange={setStartTime}
                    autoComplete="off"
                  />
                  <TextField
                    label="Minutes per stop"
                    name="stopMinutes"
                    type="number"
                    value={stopMinutes}
                    onChange={setStopMinutes}
                    autoComplete="off"
                  />
                  <TextField
                    label="Customer slot minutes"
                    name="slotMinutes"
                    type="number"
                    value={slotMinutes}
                    onChange={setSlotMinutes}
                    autoComplete="off"
                  />
                  <Button submit disabled={route.stops.length === 0}>Calculate ETA slots</Button>
                </InlineStack>
              </Form>

              <Form id="publish-route-form" method="post">
                <input type="hidden" name="intent" value="publish" />
              </Form>
            </BlockStack>
          </LegacyCard>

          <LegacyCard title="Stops">
            <DataTable
              columnContentTypes={["numeric", "text", "text", "text", "text", "text"]}
              headings={["Stop", "Orders", "Postcode", "Address", "ETA slot", "Lock"]}
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
