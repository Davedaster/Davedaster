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

import { getAppCredentials, hasRouteXLCredentials } from "../lib/appCredentials.server";
import { sendDriverRouteLink } from "../lib/driverRouteAccess.server";
import { listActiveDrivers } from "../lib/drivers.server";
import { formatEtaSlot } from "../lib/etaSlots";
import { assignDriverToRoute, calculateEtaSlots, getRoute, optimiseRoute, publishRoute, renameRoute, updateRoutePlanningSettings } from "../lib/routeDrafts.server";
import { sendBookedSlotNotifications, sendManualRouteNotification } from "../lib/routeNotifications.server";
import { moveDraftRouteStop } from "../lib/routeStopOrder.server";
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

  if (intent === "sendNotifications") {
    try {
      await sendBookedSlotNotifications(routeId);
      return redirect(`/app/routes/${routeId}`);
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
      await sendDriverRouteLink({ routeId, request });
      return redirect(`/app/routes/${routeId}`);
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

  return "attention" as const;
}

export default function RouteDetails() {
  const { route, drivers, routexlEnabled } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [routeName, setRouteName] = useState(route.name);
  const [driverId, setDriverId] = useState(route.driverId || "");
  const [routeDate, setRouteDate] = useState(dateInputValue(route.date));
  const [plannedStartTime, setPlannedStartTime] = useState(route.plannedStartTime || "05:00");
  const [timePerDropMinutes, setTimePerDropMinutes] = useState(String(route.timePerDropMinutes || 10));
  const [customerSlotMinutes, setCustomerSlotMinutes] = useState(String(route.customerSlotMinutes || 60));
  const [startAddress, setStartAddress] = useState(route.startAddress || "Unit 1 Olympus Business Park, Newton Abbot, TQ12 2SN, United Kingdom");
  const [finishAddress, setFinishAddress] = useState(route.finishAddress || "Unit 1 Olympus Business Park, Newton Abbot, TQ12 2SN, United Kingdom");
  const [startTime, setStartTime] = useState(route.plannedStartTime || "05:00");
  const [stopMinutes, setStopMinutes] = useState(String(route.timePerDropMinutes || 10));
  const [slotMinutes, setSlotMinutes] = useState(String(route.customerSlotMinutes || 60));
  const [delayMinutes, setDelayMinutes] = useState("45");
  const [nextDropStopId, setNextDropStopId] = useState(route.stops.find((stop) => stop.status === "PENDING")?.id || "");
  const canPublish = route.status === "DRAFT";
  const canSendNotifications = route.status === "PUBLISHED" && !route.notificationsSent;
  const canRename = route.status === "DRAFT" || route.status === "PUBLISHED";
  const canSendDriverRouteLink = route.status !== "DRAFT" && Boolean(route.driverId);
  const canRearrangeDraft = route.status === "DRAFT";
  const canSendManualMessages = route.status !== "DRAFT" && route.stops.length > 0;

  const driverOptions = [
    { label: "No driver assigned", value: "" },
    ...drivers.map((driver) => ({
      label: driver.name,
      value: driver.id,
    })),
  ];

  const pendingStopOptions = [
    { label: "Choose pending stop", value: "" },
    ...route.stops
      .filter((stop) => stop.status === "PENDING")
      .map((stop) => ({
        label: `Stop ${stop.orderIndex} · ${stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).join(", ") || "No linked orders"}`,
        value: stop.id,
      })),
  ];

  const slotMinutesNumber = Number(slotMinutes || route.customerSlotMinutes || 60);

  const stopRows = route.stops.map((stop, index) => {
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
      canRearrangeDraft ? (
        <InlineStack gap="100">
          <Form method="post">
            <input type="hidden" name="intent" value="moveStop" />
            <input type="hidden" name="stopId" value={stop.id} />
            <input type="hidden" name="direction" value="up" />
            <Button submit size="micro" disabled={index === 0}>Up</Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="moveStop" />
            <input type="hidden" name="stopId" value={stop.id} />
            <input type="hidden" name="direction" value="down" />
            <Button submit size="micro" disabled={index === route.stops.length - 1}>Down</Button>
          </Form>
        </InlineStack>
      ) : "Published",
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
      secondaryActions={canSendNotifications ? [
        {
          content: "Send notifications",
          onAction: () => document.getElementById("send-notifications-form")?.requestSubmit(),
        },
      ] : undefined}
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
                  {route.status === "DRAFT" ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Draft only. You can rearrange drops and customers will not receive tracking links or delivery notifications until this route is published.
                    </Text>
                  ) : null}
                </BlockStack>
                <Badge tone={statusTone(route.status)}>{route.status}</Badge>
              </InlineStack>

              {actionData && "error" in actionData ? (
                <Text as="p" variant="bodyMd" tone="critical">{actionData.error}</Text>
              ) : null}
              {actionData?.ok && "message" in actionData ? (
                <Text as="p" variant="bodyMd" tone="success">{actionData.message}</Text>
              ) : null}
              {actionData?.ok && "errors" in actionData && actionData.errors?.length ? (
                <Text as="p" variant="bodySm" tone="critical">{actionData.errors.slice(0, 3).join(" ")}</Text>
              ) : null}

              {!routexlEnabled ? (
                <Text as="p" variant="bodySm" tone="critical">
                  RouteXL is not enabled yet. Add the RouteXL username and password in Settings, API Credentials before optimising live routes.
                </Text>
              ) : null}

              {canRename ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="rename" />
                  <InlineStack gap="200" blockAlign="end">
                    <TextField label="Route name" name="name" value={routeName} onChange={setRouteName} autoComplete="off" />
                    <Button submit>Save name</Button>
                  </InlineStack>
                </Form>
              ) : null}

              <Form method="post">
                <input type="hidden" name="intent" value="updatePlanning" />
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">Planning settings</Text>
                  <InlineStack gap="200" blockAlign="end">
                    <TextField label="Route date" name="routeDate" type="date" value={routeDate} onChange={setRouteDate} autoComplete="off" />
                    <TextField label="Driver start time" name="plannedStartTime" type="time" value={plannedStartTime} onChange={setPlannedStartTime} autoComplete="off" />
                    <TextField label="Minutes per drop" name="timePerDropMinutes" type="number" value={timePerDropMinutes} onChange={setTimePerDropMinutes} autoComplete="off" />
                    <TextField label="Customer slot minutes" name="customerSlotMinutes" type="number" value={customerSlotMinutes} onChange={setCustomerSlotMinutes} autoComplete="off" />
                  </InlineStack>
                  <TextField label="Driver start location" name="startAddress" value={startAddress} onChange={setStartAddress} autoComplete="off" multiline={2} />
                  <TextField label="Driver finish location" name="finishAddress" value={finishAddress} onChange={setFinishAddress} autoComplete="off" multiline={2} />
                  <Button submit>Save planning settings</Button>
                </BlockStack>
              </Form>

              <Form method="post">
                <input type="hidden" name="intent" value="assignDriver" />
                <InlineStack gap="200" blockAlign="end">
                  <Select label="Driver" name="driverId" options={driverOptions} value={driverId} onChange={setDriverId} />
                  <Button submit>Save driver</Button>
                </InlineStack>
              </Form>

              <InlineStack gap="200">
                <Form method="post">
                  <input type="hidden" name="intent" value="optimise" />
                  <Button submit disabled={!routexlEnabled || route.stops.length === 0}>Optimise with RouteXL</Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="sendDriverRouteLink" />
                  <Button submit disabled={!canSendDriverRouteLink}>Send driver route link</Button>
                </Form>
              </InlineStack>

              <Form method="post">
                <input type="hidden" name="intent" value="calculateEtas" />
                <InlineStack gap="200" blockAlign="end">
                  <TextField label="Driver start time" name="startTime" type="time" value={startTime} onChange={setStartTime} autoComplete="off" />
                  <TextField label="Minutes per stop" name="stopMinutes" type="number" value={stopMinutes} onChange={setStopMinutes} autoComplete="off" />
                  <TextField label="Customer slot minutes" name="slotMinutes" type="number" value={slotMinutes} onChange={setSlotMinutes} autoComplete="off" />
                  <Button submit disabled={route.stops.length === 0}>Calculate ETA slots</Button>
                </InlineStack>
              </Form>

              <Form id="publish-route-form" method="post">
                <input type="hidden" name="intent" value="publish" />
              </Form>

              <Form id="send-notifications-form" method="post">
                <input type="hidden" name="intent" value="sendNotifications" />
              </Form>
            </BlockStack>
          </LegacyCard>

          <LegacyCard title="Manual customer messages" sectioned>
            <BlockStack gap="300">
              <Text as="p" variant="bodySm" tone="subdued">
                These buttons send the editable templates from the Notifications page. Nothing sends unless you press a button.
              </Text>
              {route.status === "DRAFT" ? (
                <Text as="p" variant="bodySm" tone="critical">Publish this route before sending manual customer messages.</Text>
              ) : null}
              <InlineStack gap="200" blockAlign="end">
                <Form method="post">
                  <input type="hidden" name="intent" value="sendOutForDelivery" />
                  <Button submit disabled={!canSendManualMessages}>Send out for delivery</Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="sendDelayUpdate" />
                  <InlineStack gap="200" blockAlign="end">
                    <TextField label="Delay minutes" name="delayMinutes" type="number" value={delayMinutes} onChange={setDelayMinutes} autoComplete="off" />
                    <Button submit disabled={!canSendManualMessages}>Send delay update</Button>
                  </InlineStack>
                </Form>
              </InlineStack>
              <Form method="post">
                <input type="hidden" name="intent" value="sendNextDropTracking" />
                <InlineStack gap="200" blockAlign="end">
                  <Select label="Next drop stop" name="stopId" options={pendingStopOptions} value={nextDropStopId} onChange={setNextDropStopId} />
                  <Button submit disabled={!canSendManualMessages || !nextDropStopId}>Send you are next</Button>
                </InlineStack>
              </Form>
            </BlockStack>
          </LegacyCard>

          <LegacyCard title="Stops">
            <DataTable
              columnContentTypes={["numeric", "text", "text", "text", "text", "text", "text"]}
              headings={["Stop", "Orders", "Postcode", "Address", "ETA slot", "Lock", "Move"]}
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
