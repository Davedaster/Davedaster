import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { useState } from "react";
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

import { AdminToastStack, type AdminToastMessage } from "../components/AdminToastStack";
import { deleteDraftRoute, deleteTestRoute, getRouteActionSummary } from "../lib/draftRouteActions.server";
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

type RouteActionData = {
  ok: boolean;
  message?: string;
  error?: string;
  errors?: string[];
  toasts?: AdminToastMessage[];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const [routes, drivers] = await Promise.all([
    listRoutes(),
    listActiveDrivers(),
  ]);
  const initialToasts: AdminToastMessage[] = [];

  if (url.searchParams.get("toast") === "draft_saved") {
    initialToasts.push({
      title: "Draft route saved",
      detail: url.searchParams.get("route") || "The route has been saved and is ready to publish.",
      tone: "success",
    });
  }

  return json({ routes, drivers, initialToasts });
};

function tick(value: boolean) {
  return value ? "✓" : "✗";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

function fulfilmentPublishLabel(mode: string, fulfilled: number, skipped: number) {
  if (mode === "on_publish_delivered") {
    return `Shopify fulfilment on publish: ${fulfilled} fulfilled and marked delivered, ${skipped} skipped`;
  }

  if (mode === "on_publish") {
    return `Shopify fulfilment on publish: ${fulfilled} fulfilled, ${skipped} skipped`;
  }

  return "Shopify fulfilment will happen when each delivery is completed";
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
    fulfilmentPublishLabel(input.fulfilmentMode, input.fulfilmentFulfilled, input.fulfilmentSkipped),
    input.errors.length ? `Errors: ${input.errors.join(" | ")}` : "",
  ].filter(Boolean).join(" · ");
}

function fulfilmentMessage(result: Awaited<ReturnType<typeof fulfilRouteOrders>>) {
  return [
    `Shopify fulfilment checked: ${result.fulfilled} fulfilled, ${result.skipped} skipped`,
    result.errors.length ? `Details: ${result.errors.join(" | ")}` : "No errors returned by Shopify",
  ].join(" · ");
}

function actionToast(title: string, detail?: string, tone: AdminToastMessage["tone"] = "success"): AdminToastMessage {
  return { title, detail, tone };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const routeId = String(formData.get("routeId") || "").trim();

  if (!routeId) {
    return json<RouteActionData>({ ok: false, error: "Route could not be found.", toasts: [actionToast("Action failed", "Route could not be found.", "critical")] }, { status: 400 });
  }

  if (intent === "assignDriver") {
    try {
      const driverId = String(formData.get("driverId") || "").trim();
      const drivers = await listActiveDrivers();
      const driverName = drivers.find((driver) => driver.id === driverId)?.name || "No driver";
      await assignDriverToRoute(routeId, driverId || null);
      return json<RouteActionData>({ ok: true, message: "Driver saved on route.", toasts: [actionToast("Driver saved", driverName)] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Driver could not be saved.";
      return json<RouteActionData>({ ok: false, error: message, toasts: [actionToast("Driver could not be saved", message, "critical")] }, { status: 400 });
    }
  }

  if (intent === "deleteDraft") {
    try {
      await deleteDraftRoute(routeId);
      return json<RouteActionData>({ ok: true, message: "Draft route deleted.", toasts: [actionToast("Draft route deleted")] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Draft route could not be deleted.";
      return json<RouteActionData>({ ok: false, error: message, toasts: [actionToast("Draft route could not be deleted", message, "critical")] }, { status: 400 });
    }
  }

  if (intent === "deleteTest") {
    try {
      await deleteTestRoute(routeId);
      return json<RouteActionData>({ ok: true, message: "Route deleted.", toasts: [actionToast("Route deleted")] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Route could not be deleted.";
      return json<RouteActionData>({ ok: false, error: message, toasts: [actionToast("Route could not be deleted", message, "critical")] }, { status: 400 });
    }
  }

  if (intent === "fulfilRoute") {
    try {
      const fulfilmentSettings = await getFulfilmentSettings();
      const result = await fulfilRouteOrders(admin, routeId, {
        notifyCustomer: fulfilmentSettings.notifyCustomerOnFulfilment,
      });
      return json<RouteActionData>({
        ok: true,
        message: fulfilmentMessage(result),
        errors: result.errors,
        toasts: [
          actionToast("Shopify fulfilment checked", `${result.fulfilled} fulfilled, ${result.skipped} skipped`, result.errors.length ? "info" : "success"),
          ...result.errors.map((error) => actionToast("Fulfilment detail", error, "info")),
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shopify fulfilment could not be checked.";
      return json<RouteActionData>({ ok: false, error: message, toasts: [actionToast("Shopify fulfilment failed", message, "critical")] }, { status: 400 });
    }
  }

  if (intent === "publish") {
    try {
      const route = await getRouteActionSummary(routeId);
      const drivers = await listActiveDrivers();
      const driverName = route?.driverId ? drivers.find((driver) => driver.id === route.driverId)?.name || "Driver" : "Driver";

      if (!route) {
        return json<RouteActionData>({ ok: false, error: "Route could not be found.", toasts: [actionToast("Publish failed", "Route could not be found.", "critical")] }, { status: 404 });
      }

      if (route.status !== "DRAFT") {
        return json<RouteActionData>({ ok: false, error: "Only draft routes can be published from this card.", toasts: [actionToast("Publish failed", "Only draft routes can be published from this card.", "critical")] }, { status: 400 });
      }

      if (!route.driverId) {
        return json<RouteActionData>({ ok: false, error: "Assign a driver before publishing this route.", toasts: [actionToast("Publish failed", "Assign a driver before publishing this route.", "critical")] }, { status: 400 });
      }

      await publishRoute(routeId);
      await calculateEtaSlots(routeId);
      await tagPublishedRouteOrders(admin, routeId);

      const fulfilmentSettings = await getFulfilmentSettings();
      const fulfilOnPublish = fulfilmentSettings.routePublishFulfilmentMode === "on_publish" || fulfilmentSettings.routePublishFulfilmentMode === "on_publish_delivered";
      const fulfilmentResult = fulfilOnPublish
        ? await fulfilRouteOrders(admin, routeId, {
          markDelivered: fulfilmentSettings.routePublishFulfilmentMode === "on_publish_delivered",
          notifyCustomer: fulfilmentSettings.notifyCustomerOnFulfilment,
        })
        : { fulfilled: 0, skipped: 0, errors: [] };
      const driverResult = await sendDriverRouteLink({ routeId, request });
      const customerResult = await sendBookedSlotNotifications(routeId);
      const errors = [...fulfilmentResult.errors, ...driverResult.errors, ...customerResult.errors];
      const fulfilmentToastTitle = fulfilmentSettings.routePublishFulfilmentMode === "on_publish_delivered"
        ? "Shopify fulfilled and delivered on publish"
        : fulfilmentSettings.routePublishFulfilmentMode === "on_publish"
          ? "Shopify fulfilment on publish"
          : "Shopify fulfilment";
      const toasts: AdminToastMessage[] = [
        actionToast("Route published", route.name),
        actionToast(driverResult.smsSent ? "Driver SMS sent" : "Driver SMS not sent", `${route.name} sent to ${driverName}`, driverResult.smsSent ? "success" : "info"),
        actionToast(driverResult.emailSent ? "Driver email sent" : "Driver email not sent", `${route.name} sent to ${driverName}`, driverResult.emailSent ? "success" : "info"),
        actionToast("Customer SMS update", `${customerResult.smsSent} sent, ${customerResult.skipped} skipped`, customerResult.smsSent ? "success" : "info"),
        actionToast("Customer email update", `${customerResult.emailsSent} sent, ${customerResult.skipped} skipped`, customerResult.emailsSent ? "success" : "info"),
        fulfilOnPublish
          ? actionToast(fulfilmentToastTitle, `${fulfilmentResult.fulfilled} fulfilled, ${fulfilmentResult.skipped} skipped`, fulfilmentResult.errors.length ? "info" : "success")
          : actionToast("Shopify fulfilment", "Will run when each delivery is completed", "info"),
        ...errors.map((error) => actionToast("Publish detail", error, "critical")),
      ];

      return json<RouteActionData>({
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
        toasts,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Route could not be published.";
      return json<RouteActionData>({ ok: false, error: message, toasts: [actionToast("Route could not be published", message, "critical")] }, { status: 400 });
    }
  }

  return json<RouteActionData>({ ok: false, error: "Route action was not recognised.", toasts: [actionToast("Action failed", "Route action was not recognised.", "critical")] }, { status: 400 });
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function routeDateInputValue(value: string | Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function statusTone(status: string) {
  if (status === "DRAFT") return "info" as const;
  if (status === "PUBLISHED" || status === "NOTIFICATIONS_SENT") return "success" as const;
  if (status === "OUT_FOR_DELIVERY") return "attention" as const;
  if (status === "COMPLETED") return "success" as const;
  return "attention";
}

function routeLiveLabel(status: string) {
  if (status === "OUT_FOR_DELIVERY") return "Driver out";
  if (status === "PUBLISHED" || status === "NOTIFICATIONS_SENT") return "Ready, not started";
  return status.replaceAll("_", " ").toLowerCase();
}

function isRouteInProgress(route: RouteListItem) {
  return ["PUBLISHED", "NOTIFICATIONS_SENT", "OUT_FOR_DELIVERY"].includes(route.status);
}

function isStopDone(stop: StopListItem) {
  return stop.status === "DELIVERED" || stop.status === "FAILED";
}

function isRouteDeleteAllowed(status: string) {
  return ["PUBLISHED", "NOTIFICATIONS_SENT", "COMPLETED", "CANCELLED"].includes(status);
}

function isFulfilmentRetryAllowed(status: string) {
  return ["PUBLISHED", "NOTIFICATIONS_SENT", "OUT_FOR_DELIVERY", "COMPLETED"].includes(status);
}

function stopCustomerLabel(stop: StopListItem) {
  const names = stop.deliveryGroup?.orders.map((order) => order.customerName).filter(Boolean).join(", ");
  const orders = stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).filter(Boolean).join(", ");
  const postcode = stop.deliveryGroup?.postcode || "No postcode";
  return [orders, names, postcode].filter(Boolean).join(" · ");
}

function stopEtaLabel(stop: StopListItem) {
  if (stop.status === "DELIVERED") return `Delivered ${formatDateTime(stop.actualArrival)}`;
  if (stop.status === "FAILED") return `Missed ${formatDateTime(stop.actualArrival)}`;
  return `ETA ${formatDateTime(stop.estimatedArrival)}`;
}

function estimateFinishTime(route: RouteListItem) {
  const orderedStops = [...route.stops].sort((a, b) => a.orderIndex - b.orderIndex);
  const remainingStops = orderedStops.filter((stop) => stop.status === "PENDING");
  const timePerDropMinutes = Math.max(1, route.timePerDropMinutes || 10);
  if (remainingStops.length) {
    const lastRemainingEta = remainingStops[remainingStops.length - 1]?.estimatedArrival;
    if (lastRemainingEta) return new Date(new Date(lastRemainingEta).getTime() + timePerDropMinutes * 60 * 1000);
  }
  const lastActual = [...orderedStops].reverse().find((stop) => stop.actualArrival)?.actualArrival;
  return lastActual || null;
}

function finishLocationLabel(route: RouteListItem) {
  const finishAddress = route.finishAddress || route.startAddress || "Base";
  const startAddress = route.startAddress || "";
  const returnsToBase = finishAddress.trim().toLowerCase() === startAddress.trim().toLowerCase() || finishAddress.toLowerCase().includes("olympus");
  return returnsToBase ? "Return to base" : "Custom end point";
}

function confirmDelete(routeName: string, label: string) {
  return `Are you sure you want to delete ${label} "${routeName}"? This cannot be undone.`;
}

function ProgressBar({ value }: { value: number }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return <div style={{ width: "100%", height: 10, background: "#eef2f7", borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${safeValue}%`, height: "100%", background: "#509AE6", borderRadius: 999 }} /></div>;
}

function DriverSelect({ route, drivers }: { route: RouteListItem; drivers: DriverListItem[] }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="assignDriver" />
      <input type="hidden" name="routeId" value={route.id} />
      <InlineStack gap="200" blockAlign="center" wrap>
        <label style={{ fontSize: 13, fontWeight: 600 }} htmlFor={`driver-${route.id}`}>Driver</label>
        <select id={`driver-${route.id}`} name="driverId" defaultValue={route.driverId || ""} style={{ minWidth: 180, minHeight: 32, borderRadius: 8, border: "1px solid #c9cccf", padding: "4px 8px" }}>
          <option value="">No driver</option>
          {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
        </select>
        <Button submit>Save driver</Button>
      </InlineStack>
    </Form>
  );
}

function DeleteRouteForm({ route, intent, label, confirmLabel }: { route: RouteListItem; intent: "deleteDraft" | "deleteTest"; label: string; confirmLabel: string }) {
  return (
    <Form method="post" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.stopPropagation(); if (!window.confirm(confirmDelete(route.name, confirmLabel))) event.preventDefault(); }}>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="routeId" value={route.id} />
      <button type="submit" onClick={(event) => event.stopPropagation()} style={{ background: "#d82c0d", border: "1px solid #d82c0d", borderRadius: 8, color: "#ffffff", fontSize: 13, fontWeight: 600, minHeight: 32, padding: "6px 12px" }}>{label}</button>
    </Form>
  );
}

function FulfilRouteForm({ route }: { route: RouteListItem }) {
  return <Form method="post"><input type="hidden" name="intent" value="fulfilRoute" /><input type="hidden" name="routeId" value={route.id} /><Button submit>Fulfil Shopify orders now</Button></Form>;
}

function PackingListButton({ route }: { route: RouteListItem }) {
  return <Button url={`/app/routes/${route.id}/packing-list`} target="_blank">Print packing list</Button>;
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
          <BlockStack gap="100"><InlineStack gap="200" blockAlign="center"><Text as="h3" variant="headingMd">{route.driver?.name || "No driver"}</Text><Badge tone={statusTone(route.status)}>{routeLiveLabel(route.status)}</Badge></InlineStack><Text as="p" variant="bodyMd" tone="subdued">{route.name} · {formatDate(route.date)}</Text><Text as="p" variant="bodySm" tone="subdued">Start {route.plannedStartTime || "05:00"} · {finishLocationLabel(route)}: {route.finishAddress || route.startAddress || "Base"}</Text></BlockStack>
          <BlockStack gap="200"><DriverSelect route={route} drivers={drivers} /><InlineStack gap="200" align="end" wrap><PackingListButton route={route} />{isFulfilmentRetryAllowed(route.status) ? <FulfilRouteForm route={route} /> : null}{isRouteDeleteAllowed(route.status) ? <DeleteRouteForm route={route} intent="deleteTest" label="Delete route" confirmLabel="this route" /> : null}</InlineStack></BlockStack>
        </InlineStack>
        <BlockStack gap="150"><InlineStack align="space-between"><Text as="span" variant="bodySm">{completedStops.length}/{orderedStops.length} stops resolved</Text><Text as="span" variant="bodySm" tone="subdued">{progress}%</Text></InlineStack><ProgressBar value={progress} /></BlockStack>
        <InlineStack gap="400" wrap><Text as="span" variant="bodyMd">Delivered: {deliveredStops.length}</Text><Text as="span" variant="bodyMd">Missed: {failedStops.length}</Text><Text as="span" variant="bodyMd">To go: {remainingStops.length}</Text><Text as="span" variant="bodyMd">Finish target: {formatDateTime(finishTime)}</Text></InlineStack>
        {nextStop ? <Box background="bg-surface-secondary" padding="300" borderRadius="300"><BlockStack gap="100"><Text as="p" variant="bodyMd" fontWeight="bold">Next drop: Stop {nextStop.orderIndex}</Text><Text as="p" variant="bodySm">{stopCustomerLabel(nextStop)}</Text><Text as="p" variant="bodySm" tone="subdued">{stopEtaLabel(nextStop)}</Text></BlockStack></Box> : null}
      </BlockStack>
    </LegacyCard>
  );
}

function RouteCard({ route, drivers }: { route: RouteListItem; drivers: DriverListItem[] }) {
  const isDraft = route.status === "DRAFT";
  const canDeleteRoute = isRouteDeleteAllowed(route.status);
  const canRetryFulfilment = isFulfilmentRetryAllowed(route.status);

  return (
    <ResourceItem id={route.id} accessibilityLabel={`View ${route.name}`}>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" gap="300">
          <BlockStack gap="100">
            <Text as="h3" variant="bodyMd" fontWeight="bold">{route.name}</Text>
            <Text as="p" variant="bodySm" tone="subdued">{formatDate(route.date)} · Start {route.plannedStartTime || "05:00"} · {route.timePerDropMinutes || 10} min/drop · {route.stops.length} stops</Text>
            <Text as="p" variant="bodySm" tone="subdued">Driver: {route.driver?.name || "No driver assigned"}</Text>
            <Text as="p" variant="bodySm" tone="subdued">Start: {route.startAddress || "Bathroom Panels Direct"}</Text>
            <Text as="p" variant="bodySm" tone="subdued">Finish: {route.finishAddress || "Bathroom Panels Direct"}</Text>
            <Text as="p" variant="bodySm" tone="subdued">{route.stops.map((stop) => stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).join(", ")).filter(Boolean).join(" · ")}</Text>
          </BlockStack>
          <Badge tone={statusTone(route.status)}>{route.status}</Badge>
        </InlineStack>
        <Box background="bg-surface-secondary" padding="300" borderRadius="300">
          <BlockStack gap="250">
            <DriverSelect route={route} drivers={drivers} />
            {isDraft ? (
              <InlineStack gap="200" wrap><Button url={`/app/routes/${route.id}`}>Edit draft drops</Button><PackingListButton route={route} /><Form method="post"><input type="hidden" name="intent" value="publish" /><input type="hidden" name="routeId" value={route.id} /><Button submit variant="primary" disabled={!route.driverId}>Publish route and notify</Button></Form><DeleteRouteForm route={route} intent="deleteDraft" label="Delete draft" confirmLabel="this draft route" /></InlineStack>
            ) : canDeleteRoute ? (
              <InlineStack gap="200" wrap blockAlign="center"><Button url={`/app/routes/${route.id}`}>Open route</Button><PackingListButton route={route} />{canRetryFulfilment ? <FulfilRouteForm route={route} /> : null}<DeleteRouteForm route={route} intent="deleteTest" label="Delete route" confirmLabel="this route" /></InlineStack>
            ) : (
              <InlineStack gap="200" wrap blockAlign="center"><Button url={`/app/routes/${route.id}`}>Open route</Button><PackingListButton route={route} />{canRetryFulfilment ? <FulfilRouteForm route={route} /> : null}<Text as="p" variant="bodySm" tone="subdued">This route is currently out for delivery, so delete is locked.</Text></InlineStack>
            )}
          </BlockStack>
        </Box>
      </BlockStack>
    </ResourceItem>
  );
}

export default function Routes() {
  const { routes, drivers, initialToasts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [completedDateDraft, setCompletedDateDraft] = useState(todayInputValue());
  const [completedDateSearch, setCompletedDateSearch] = useState(todayInputValue());
  const liveRoutes = routes.filter(isRouteInProgress);
  const visibleRoutes = routes.filter((route) => route.status !== "COMPLETED");
  const completedRoutesForDate = routes.filter((route) => route.status === "COMPLETED" && routeDateInputValue(route.date) === completedDateSearch);
  const completedRouteCount = routes.filter((route) => route.status === "COMPLETED").length;
  const actionToasts = actionData?.toasts || (actionData && "error" in actionData && actionData.error ? [actionToast("Action failed", actionData.error, "critical")] : []);

  return (
    <Page title="Routes">
      <AdminToastStack messages={[...initialToasts, ...actionToasts]} />
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100"><Text as="h2" variant="headingMd">Live route progress</Text><Text as="p" variant="bodyMd" tone="subdued">Track drivers that are ready or out on the road, with completed drops, remaining drops, next ETA and finish target.</Text></BlockStack>
                <Badge tone={liveRoutes.length ? "attention" : "success"}>{liveRoutes.length ? `${liveRoutes.length} active` : "No live routes"}</Badge>
              </InlineStack>
              {actionData && "message" in actionData ? <Text as="p" variant="bodyMd" tone="success">{actionData.message}</Text> : null}
              {actionData && "error" in actionData ? <Text as="p" variant="bodyMd" tone="critical">{actionData.error}</Text> : null}
            </BlockStack>
          </LegacyCard>

          {liveRoutes.length ? <BlockStack gap="300">{liveRoutes.map((route) => <LiveRouteProgressCard key={route.id} route={route} drivers={drivers} />)}</BlockStack> : <LegacyCard sectioned><Text as="p" variant="bodyMd" tone="subdued">No published or active delivery routes are currently running.</Text></LegacyCard>}

          <LegacyCard sectioned>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                <BlockStack gap="100"><Text as="h2" variant="headingMd">Find completed routes</Text><Text as="p" variant="bodyMd" tone="subdued">Completed routes are hidden from the main list. Pick a delivery date to view completed routes for that day.</Text></BlockStack>
                <Badge tone="success">{completedRouteCount} completed</Badge>
              </InlineStack>
              <form onSubmit={(event) => { event.preventDefault(); setCompletedDateSearch(completedDateDraft); }}>
                <InlineStack gap="200" blockAlign="center" wrap>
                  <label style={{ fontSize: 13, fontWeight: 600 }} htmlFor="completed-route-date">Delivery date</label>
                  <input id="completed-route-date" type="date" value={completedDateDraft} onChange={(event) => setCompletedDateDraft(event.currentTarget.value)} style={{ minHeight: 32, borderRadius: 8, border: "1px solid #c9cccf", padding: "4px 8px" }} />
                  <Button submit>Search</Button>
                </InlineStack>
              </form>
              {completedRoutesForDate.length ? <ResourceList resourceName={{ singular: "completed route", plural: "completed routes" }} items={completedRoutesForDate} renderItem={(route) => <RouteCard route={route} drivers={drivers} />} /> : <Text as="p" variant="bodyMd" tone="subdued">No completed routes found for {formatDate(completedDateSearch)}.</Text>}
            </BlockStack>
          </LegacyCard>

          <LegacyCard>
            {visibleRoutes.length === 0 ? (
              <EmptyState heading="No active or draft routes" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"><p>Create a draft route from the Orders Map by selecting delivery pins, or search completed routes by date above.</p></EmptyState>
            ) : (
              <ResourceList resourceName={{ singular: "route", plural: "routes" }} items={visibleRoutes} renderItem={(route) => <RouteCard route={route} drivers={drivers} />} />
            )}
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
