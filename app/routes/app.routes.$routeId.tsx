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
  Box,
} from "@shopify/polaris";
import { useState } from "react";

import { getAppCredentials, hasRouteXLCredentials } from "../lib/appCredentials.server";
import { sendDriverRouteLink } from "../lib/driverRouteAccess.server";
import { listActiveDrivers } from "../lib/drivers.server";
import { formatEtaSlot } from "../lib/etaSlots";
import { getFulfilmentSettings } from "../lib/fulfilmentSettings.server";
import { assignDriverToRoute, calculateEtaSlots, getRoute, optimiseRoute, publishRoute, renameRoute, updateRoutePlanningSettings } from "../lib/routeDrafts.server";
import { sendBookedSlotNotifications, sendManualRouteNotification } from "../lib/routeNotifications.server";
import { moveDraftRouteStop } from "../lib/routeStopOrder.server";
import { fulfilRouteOrders } from "../lib/shopifyFulfilment.server";
import { tagPublishedRouteOrders } from "../lib/shopifyOrderTags.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const routeId = params.routeId;

  if (!routeId) {
    throw new Response("Route not found", { status: 404 });
  }

  const [route, drivers, credentials] = await Promise.all([
    getRoute(routeId),
    listActiveDrivers(),
    getAppCredentials(),
  ]);

  if (!route) {
    throw new Response("Route not found", { status: 404 });
  }

  return json({ route, drivers, routexlEnabled: hasRouteXLCredentials(credentials) });
};

function notificationResultMessage(label: string, result: { smsSent: number; emailsSent: number; skipped: number; failed?: number }) {
  return `${label}: ${result.smsSent} SMS, ${result.emailsSent} emails, ${result.skipped} skipped${result.failed ? `, ${result.failed} failed` : ""}.`;
}

function tick(value: boolean) {
  return value ? "✓" : "✗";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
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
  shopifyTagged: number;
  shopifyTagFailed: number;
  errors: string[];
}) {
  return [
    `Route published`,
    `Shopify tags: ${input.shopifyTagged} tagged${input.shopifyTagFailed ? `, ${input.shopifyTagFailed} failed` : ""}`,
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
      const routeBeforePublish = await getRoute(routeId);

      if (!routeBeforePublish?.driverId) {
        return json({ ok: false, error: "Assign a driver before publishing this route." }, { status: 400 });
      }

      await publishRoute(routeId);

      let tagResult = { tagged: 0, failed: 0, errors: [] as string[] };
      try {
        tagResult = await tagPublishedRouteOrders(admin, routeId);
      } catch (error) {
        tagResult.errors.push(`Shopify tagging step failed: ${errorMessage(error)}`);
        tagResult.failed += 1;
      }

      let fulfilmentMode = "on_delivery";
      let fulfilmentResult = { fulfilled: 0, skipped: 0, errors: [] as string[] };
      try {
        const fulfilmentSettings = await getFulfilmentSettings();
        fulfilmentMode = fulfilmentSettings.routePublishFulfilmentMode;
        fulfilmentResult = fulfilmentMode === "on_publish"
          ? await fulfilRouteOrders(admin, routeId)
          : fulfilmentResult;
      } catch (error) {
        fulfilmentResult.errors.push(`Shopify fulfilment step failed: ${errorMessage(error)}`);
      }

      let driverResult = { smsSent: false, emailSent: false, errors: [] as string[] };
      try {
        driverResult = await sendDriverRouteLink({ routeId, request });
      } catch (error) {
        driverResult.errors.push(`Driver route link step failed: ${errorMessage(error)}`);
      }

      let customerResult = { smsSent: 0, emailsSent: 0, skipped: 0, failed: 0, errors: [] as string[] };
      try {
        customerResult = await sendBookedSlotNotifications(routeId);
      } catch (error) {
        customerResult.errors.push(`Customer booked slot notification step failed: ${errorMessage(error)}`);
      }

      const errors = [
        ...tagResult.errors,
        ...fulfilmentResult.errors,
        ...driverResult.errors,
        ...customerResult.errors,
      ];

      return json({
        ok: true,
        message: publishMessage({
          driverSms: driverResult.smsSent,
          driverEmail: driverResult.emailSent,
          customerSms: customerResult.smsSent,
          customerEmail: customerResult.emailsSent,
          customerSkipped: customerResult.skipped,
          fulfilmentMode,
          fulfilmentFulfilled: fulfilmentResult.fulfilled,
          fulfilmentSkipped: fulfilmentResult.skipped,
          shopifyTagged: tagResult.tagged,
          shopifyTagFailed: tagResult.failed,
          errors,
        }),
        publishStatus: {
          driverSms: driverResult.smsSent,
          driverEmail: driverResult.emailSent,
          customerSms: customerResult.smsSent,
          customerEmail: customerResult.emailsSent,
          customerSkipped: customerResult.skipped,
          fulfilmentMode,
          fulfilmentFulfilled: fulfilmentResult.fulfilled,
          fulfilmentSkipped: fulfilmentResult.skipped,
          shopifyTagged: tagResult.tagged,
          shopifyTagFailed: tagResult.failed,
          errors,
        },
        errors,
      });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Route publishing failed." }, { status: 400 });
    }
  }

  if (intent === "sendNotifications") {
    try {
      const result = await sendBookedSlotNotifications(routeId);
      return json({ ok: true, message: notificationResultMessage("Customer notifications sent", result), errors: result.errors });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Notifications failed." }, { status: 400 });
    }
  }

  if (intent === "sendOutForDelivery") {
    try {
      const result = await sendManualRouteNotification({ routeId, templateId: "outForDelivery" });
      return json({ ok: true, message: notificationResultMessage("Out for delivery sent", result), errors: result.errors });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Out for delivery message failed." }, { status: 400 });
    }
  }

  if (intent === "sendDelayUpdate") {
    try {
      const delayMinutes = Number(String(formData.get("delayMinutes") || "45"));
      const result = await sendManualRouteNotification({ routeId, templateId: "delayUpdate", delayMinutes, pendingOnly: true });
      return json({ ok: true, message: notificationResultMessage("Delay update sent", result), errors: result.errors });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Delay update failed." }, { status: 400 });
    }
  }

  if (intent === "sendNextDropTracking") {
    try {
      const stopId = String(formData.get("stopId") || "").trim();
      const result = await sendManualRouteNotification({ routeId, templateId: "nextDropTracking", stopId });
      return json({ ok: true, message: notificationResultMessage("Next drop message sent", result), errors: result.errors });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Next drop message failed." }, { status: 400 });
    }
  }

  if (intent === "sendDriverRouteLink") {
    try {
      const result = await sendDriverRouteLink({ routeId, request });
      return json({ ok: true, message: `Driver route link sent: SMS ${tick(result.smsSent)}, email ${tick(result.emailSent)}.`, errors: result.errors });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Driver route link failed." }, { status: 400 });
    }
  }

  if (intent === "rename") {
    const name = String(formData.get("name") || "").trim();

    if (name) {
      await renameRoute(routeId, name);
    }

    return redirect(`/app/routes/${routeId}`);
  }

  if (intent === "updatePlanning") {
    try {
      await updateRoutePlanningSettings(routeId, {
        routeDate: String(formData.get("routeDate") || "").trim(),
        plannedStartTime: String(formData.get("plannedStartTime") || "").trim(),
        timePerDropMinutes: Number(formData.get("timePerDropMinutes") || 10),
        customerSlotMinutes: Number(formData.get("customerSlotMinutes") || 60),
        startAddress: String(formData.get("startAddress") || "").trim(),
        finishAddress: String(formData.get("finishAddress") || "").trim(),
      });
      return redirect(`/app/routes/${routeId}`);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Route planning update failed." }, { status: 400 });
    }
  }

  if (intent === "assignDriver") {
    const driverIdValue = String(formData.get("driverId") || "").trim();
    await assignDriverToRoute(routeId, driverIdValue || null);

    return redirect(`/app/routes/${routeId}`);
  }

  if (intent === "moveStop") {
    try {
      const stopId = String(formData.get("stopId") || "").trim();
      const direction = String(formData.get("direction") || "") === "up" ? "up" : "down";
      await moveDraftRouteStop(routeId, stopId, direction);
      return redirect(`/app/routes/${routeId}`);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Stop order update failed." }, { status: 400 });
    }
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
      const startTime = String(formData.get("startTime") || "").trim();
      const stopMinutes = Number(formData.get("stopMinutes") || 0);
      const slotMinutes = Number(formData.get("slotMinutes") || 0);

      await calculateEtaSlots(
        routeId,
        startTime || undefined,
        Number.isFinite(stopMinutes) && stopMinutes > 0 ? stopMinutes : undefined,
        Number.isFinite(slotMinutes) && slotMinutes > 0 ? slotMinutes : undefined,
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

function dateInputValue(value: string | Date) {
  return new Date(value).toISOString().slice(0, 10);
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

function formatSlot(estimatedArrival: string | Date | null, slotMinutes = 60) {
  if (!estimatedArrival) {
    return "Pending";
  }

  const start = new Date(estimatedArrival);
  const end = new Date(start.getTime() + slotMinutes * 60 * 1000);

  return formatEtaSlot(start, end);
}

export default function RouteDetails() {
  const { route, drivers, routexlEnabled } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [routeName, setRouteName] = useState(route.name);
  const [selectedDriverId, setSelectedDriverId] = useState(route.driverId || "");
  const [delayMinutes, setDelayMinutes] = useState("45");
  const [selectedNextStopId, setSelectedNextStopId] = useState(route.stops.find((stop) => stop.status === "PENDING")?.id || "");
  const [routeDate, setRouteDate] = useState(dateInputValue(route.date));
  const [plannedStartTime, setPlannedStartTime] = useState(route.plannedStartTime || "05:00");
  const [timePerDropMinutes, setTimePerDropMinutes] = useState(String(route.timePerDropMinutes || 10));
  const [customerSlotMinutes, setCustomerSlotMinutes] = useState(String(route.customerSlotMinutes || 60));
  const [startAddress, setStartAddress] = useState(route.startAddress || "Bathroom Panels Direct");
  const [finishAddress, setFinishAddress] = useState(route.finishAddress || "Bathroom Panels Direct");
  const driverOptions = [{ label: "No driver assigned", value: "" }, ...drivers.map((driver) => ({ label: driver.name, value: driver.id }))];
  const stopRows = route.stops.map((stop) => {
    const orderNumbers = stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).join(", ") || "";
    const customerNames = stop.deliveryGroup?.orders.map((order) => order.customerName).filter(Boolean).join(", ") || "";
    const postcode = stop.deliveryGroup?.postcode || "";
    const slot = formatSlot(stop.estimatedArrival, route.customerSlotMinutes || 60);

    return [
      `#${stop.orderIndex}`,
      orderNumbers,
      customerNames,
      postcode,
      slot,
      stop.status,
      route.status === "DRAFT" ? (
        <InlineStack key={stop.id} gap="100">
          <Form method="post">
            <input type="hidden" name="intent" value="moveStop" />
            <input type="hidden" name="stopId" value={stop.id} />
            <input type="hidden" name="direction" value="up" />
            <Button submit disabled={stop.orderIndex === 1}>Up</Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="moveStop" />
            <input type="hidden" name="stopId" value={stop.id} />
            <input type="hidden" name="direction" value="down" />
            <Button submit disabled={stop.orderIndex === route.stops.length}>Down</Button>
          </Form>
        </InlineStack>
      ) : "Locked",
    ];
  });
  const nextDropOptions = route.stops
    .filter((stop) => stop.status === "PENDING")
    .map((stop) => {
      const orders = stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).join(", ") || "No orders";
      const postcode = stop.deliveryGroup?.postcode || "No postcode";
      return { label: `Stop ${stop.orderIndex} · ${orders} · ${postcode}`, value: stop.id };
    });

  return (
    <Page title={route.name} backAction={{ content: "Routes", url: "/app/routes" }}>
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Route details</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {formatDate(route.date)} · {route.stops.length} stops · Driver: {route.driver?.name || "No driver assigned"}
                  </Text>
                </BlockStack>
                <Badge tone={statusTone(route.status)}>{route.status}</Badge>
              </InlineStack>
              {actionData && "message" in actionData ? <Text as="p" variant="bodyMd" tone="success">{actionData.message}</Text> : null}
              {actionData && "error" in actionData ? <Text as="p" variant="bodyMd" tone="critical">{actionData.error}</Text> : null}
            </BlockStack>
          </LegacyCard>

          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Route name</Text>
              <Form method="post">
                <BlockStack gap="200">
                  <input type="hidden" name="intent" value="rename" />
                  <TextField label="Name" name="name" value={routeName} onChange={setRouteName} autoComplete="off" />
                  <Button submit>Save name</Button>
                </BlockStack>
              </Form>
            </BlockStack>
          </LegacyCard>

          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Route planning</Text>
              <Text as="p" variant="bodySm" tone="subdued">Set the delivery date, start time and slot length before sending customers their booked delivery slot.</Text>
              <Form method="post">
                <BlockStack gap="200">
                  <input type="hidden" name="intent" value="updatePlanning" />
                  <TextField label="Route date" name="routeDate" type="date" value={routeDate} onChange={setRouteDate} autoComplete="off" />
                  <TextField label="Planned start time" name="plannedStartTime" type="time" value={plannedStartTime} onChange={setPlannedStartTime} autoComplete="off" />
                  <TextField label="Minutes at each drop" name="timePerDropMinutes" type="number" min={1} value={timePerDropMinutes} onChange={setTimePerDropMinutes} autoComplete="off" />
                  <TextField label="Customer delivery slot minutes" name="customerSlotMinutes" type="number" min={15} value={customerSlotMinutes} onChange={setCustomerSlotMinutes} autoComplete="off" helpText="Example: 60 gives the customer a one hour ETA window." />
                  <TextField label="Route start address" name="startAddress" value={startAddress} onChange={setStartAddress} autoComplete="off" />
                  <TextField label="Route finish address" name="finishAddress" value={finishAddress} onChange={setFinishAddress} autoComplete="off" />
                  <Button submit>Save route planning</Button>
                </BlockStack>
              </Form>
            </BlockStack>
          </LegacyCard>

          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Driver</Text>
              <Form method="post">
                <BlockStack gap="200">
                  <input type="hidden" name="intent" value="assignDriver" />
                  <Select label="Assigned driver" name="driverId" options={driverOptions} value={selectedDriverId} onChange={setSelectedDriverId} />
                  <Button submit>Save driver</Button>
                </BlockStack>
              </Form>
            </BlockStack>
          </LegacyCard>

          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Route actions</Text>
              <InlineStack gap="200" wrap>
                <Form method="post">
                  <input type="hidden" name="intent" value="optimise" />
                  <Button submit disabled={!routexlEnabled || route.status !== "DRAFT"}>Optimise route</Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="calculateEtas" />
                  <input type="hidden" name="startTime" value={plannedStartTime} />
                  <input type="hidden" name="stopMinutes" value={timePerDropMinutes} />
                  <input type="hidden" name="slotMinutes" value={customerSlotMinutes} />
                  <Button submit>Recalculate ETA slots</Button>
                </Form>
                <Button url={`/app/routes/${route.id}/packing-list`} target="_blank">Print packing list</Button>
                <Form method="post">
                  <input type="hidden" name="intent" value="publish" />
                  <Button submit variant="primary" disabled={!route.driverId || route.status !== "DRAFT"}>Publish route and notify</Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="sendDriverRouteLink" />
                  <Button submit disabled={!route.driverId || route.status === "DRAFT"}>Send driver link</Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="sendNotifications" />
                  <Button submit disabled={route.notificationsSent || route.status === "DRAFT"}>Send customer booked slot</Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="sendOutForDelivery" />
                  <Button submit disabled={route.status === "DRAFT"}>Send out for delivery</Button>
                </Form>
              </InlineStack>
              {!routexlEnabled ? <Text as="p" variant="bodySm" tone="subdued">RouteXL credentials are not set up yet, so optimisation is disabled.</Text> : null}
            </BlockStack>
          </LegacyCard>

          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Manual updates</Text>
              <InlineStack gap="300" wrap>
                <Form method="post">
                  <BlockStack gap="200">
                    <input type="hidden" name="intent" value="sendDelayUpdate" />
                    <TextField label="Delay minutes" name="delayMinutes" type="number" min={1} value={delayMinutes} onChange={setDelayMinutes} autoComplete="off" />
                    <Button submit disabled={route.status === "DRAFT"}>Send delay update to pending drops</Button>
                  </BlockStack>
                </Form>
                <Form method="post">
                  <BlockStack gap="200">
                    <input type="hidden" name="intent" value="sendNextDropTracking" />
                    <Select label="Next drop" name="stopId" options={nextDropOptions.length ? nextDropOptions : [{ label: "No pending stops", value: "" }]} value={selectedNextStopId} onChange={setSelectedNextStopId} />
                    <Button submit disabled={!selectedNextStopId || route.status === "DRAFT"}>Send you are next</Button>
                  </BlockStack>
                </Form>
              </InlineStack>
            </BlockStack>
          </LegacyCard>

          <LegacyCard title="Stops">
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text", "text", "text"]}
              headings={["Stop", "Orders", "Customer", "Postcode", "ETA slot", "Status", "Order"]}
              rows={stopRows}
            />
          </LegacyCard>

          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">History</Text>
              {route.history.length ? (
                route.history.map((event) => (
                  <Box key={event.id} padding="200" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="050">
                      <Text as="p" variant="bodyMd" fontWeight="bold">{event.action}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{formatDate(event.createdAt)} · {event.details}</Text>
                    </BlockStack>
                  </Box>
                ))
              ) : (
                <Text as="p" variant="bodyMd" tone="subdued">No history yet.</Text>
              )}
            </BlockStack>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
