import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useFetcher, useLoaderData, useActionData } from "@remix-run/react";
import { Page, Layout, LegacyCard, BlockStack, Text, Box, InlineStack, Button, Badge, TextField, Select } from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";

import prisma from "../db.server";
import { RouteMap } from "../components/RouteMap";
import { listActiveDrivers } from "../lib/drivers.server";
import { getAppCredentials, hasRouteXLCredentials } from "../lib/appCredentials.server";
import { buildRouteXLLocation, optimiseLocations } from "../lib/routexl.server";
import { authenticate } from "../shopify.server";
import { assertOrdersAvailableForRoute } from "../lib/routeAllocations.server";
import { getDeliveryOrders, type DeliveryOrder } from "../lib/shopifyOrders.server";

type Stop = { id: string; orderNumber: string; customerName: string; postcode: string; eta: string };
type StopEta = { id: string; eta: string; arrivalMinutes: number };
type OptimiseResult = { ok: true; orderedIds: string[]; stopEtas: StopEta[]; totalDistanceKm: number | null; totalDurationMinutes: number | null } | { ok: false; error: string };

const SHOP = {
  address: "Unit 1 Olympus Business Park, Newton Abbot, TQ12 2SN, United Kingdom",
  latitude: 50.5293,
  longitude: -3.6119,
};

function dateInput(value: string | Date | null | undefined) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return new Date();
  return new Date(Date.UTC(year, month - 1, day));
}

function formatTime(start: string, minutesToAdd: number) {
  const [hours, minutes = "0"] = start.split(":");
  const total = Number(hours) * 60 + Number(minutes) + minutesToAdd;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function estimatedArrival(routeDate: string, start: string, minutesToAdd: number) {
  const [year, month, day] = routeDate.split("-").map(Number);
  const [hours, minutes = "0"] = start.split(":").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hours || 0, minutes || 0));
  date.setUTCMinutes(date.getUTCMinutes() + minutesToAdd);
  return date;
}

function formCoordinate(formData: FormData, name: string) {
  const value = Number(String(formData.get(name) || ""));
  return Number.isFinite(value) ? value : null;
}

function routeXLStopKey(id: string) {
  return `STOP_${id}`;
}

function extractRouteXLStopId(name: string) {
  return (name.split(",")[0] || name).trim().replace(/^STOP_/, "");
}

function toMinutes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  return rounded > 24 * 60 ? Math.round(rounded / 60) : rounded;
}

type DraftRoute = Awaited<ReturnType<typeof getDraftRoute>>;

async function getDraftRoute(routeId: string) {
  return prisma.route.findUnique({
    where: { id: routeId },
    include: {
      driver: true,
      stops: {
        include: { deliveryGroup: { include: { orders: true } } },
        orderBy: { orderIndex: "asc" },
      },
    },
  });
}

function routeOrderToDeliveryOrder(order: NonNullable<DraftRoute>["stops"][number]["deliveryGroup"]["orders"][number], group: NonNullable<NonNullable<DraftRoute>["stops"][number]["deliveryGroup"]>): DeliveryOrder {
  const lines = (order.lineItemSummary || "").split(/,|\n/).map((line) => line.trim()).filter(Boolean);
  return {
    id: order.shopifyOrderId,
    name: order.shopifyOrderNumber,
    createdAt: order.createdAt.toISOString(),
    customerName: order.customerName || "Customer",
    email: order.customerEmail,
    phone: order.customerPhone,
    shippingMethod: order.orderSource === "manual" ? "Manual route entry" : "Own fleet delivery",
    fulfilmentStatus: "unfulfilled",
    financialStatus: order.orderSource === "manual" ? "manual" : "paid",
    postcode: group.postcode || order.postcode,
    addressSummary: group.formattedAddress || group.manualAddress || group.address,
    formattedAddress: group.formattedAddress || group.manualAddress || group.address,
    hasDeliveryAddress: true,
    hasPanel: true,
    isSampleOnly: false,
    addressStatus: group.latitude && group.longitude ? "READY" : "NEEDS_LOCATION_CHECK",
    addressConfidence: group.latitude && group.longitude ? "HIGH" : "LOW",
    latitude: group.latitude,
    longitude: group.longitude,
    lineItemSummary: order.lineItemSummary || "Items not listed",
    lineItemLines: lines,
    fulfilByDate: null,
    hasManualOverride: group.useManualAddress,
    manualAddress: group.manualAddress,
    manualAddressNotes: group.useManualAddress ? "Loaded from draft route" : null,
    orderSource: order.orderSource === "manual" ? "manual" : "shopify",
    routeAllocation: null,
  };
}

function draftOrders(route: NonNullable<DraftRoute>) {
  return route.stops.flatMap((stop) => {
    if (!stop.deliveryGroup) return [];
    return stop.deliveryGroup.orders.map((order) => routeOrderToDeliveryOrder(order, stop.deliveryGroup!));
  });
}

function mergeOrders(...groups: DeliveryOrder[][]) {
  const map = new Map<string, DeliveryOrder>();
  for (const group of groups) for (const order of group) map.set(order.id, { ...map.get(order.id), ...order });
  return [...map.values()];
}

function routeStops(route: NonNullable<DraftRoute>) {
  return route.stops.flatMap((stop) => {
    if (!stop.deliveryGroup) return [];
    return stop.deliveryGroup.orders.map((order) => ({
      id: order.shopifyOrderId,
      orderNumber: order.shopifyOrderNumber,
      customerName: order.customerName || "Customer",
      postcode: stop.deliveryGroup?.postcode || order.postcode || "",
      eta: stop.estimatedArrival ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(stop.estimatedArrival)) : formatTime(route.plannedStartTime || "05:00", (stop.orderIndex - 1) * (route.timePerDropMinutes || 10)),
    }));
  });
}

async function selectedOrdersForAction(admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"], ids: string[], route: NonNullable<DraftRoute>) {
  const shopifyOrders = await getDeliveryOrders(admin);
  const byId = new Map(mergeOrders(shopifyOrders, draftOrders(route)).map((order) => [order.id, order]));
  return ids.map((id) => byId.get(id)).filter((order): order is DeliveryOrder => Boolean(order));
}

async function replaceDraftRoute(input: { route: NonNullable<DraftRoute>; orders: DeliveryOrder[]; name: string; date: string; start: string; dropMinutes: number; slotMinutes: number; driverId: string | null; }) {
  if (input.route.status !== "DRAFT") throw new Error("Only draft routes can be edited.");
  await assertOrdersAvailableForRoute(input.orders.filter((order) => order.orderSource !== "manual").map((order) => order.id), input.route.id);
  const groupIds = input.route.stops.map((stop) => stop.deliveryGroupId).filter((id): id is string => Boolean(id));
  const routeName = input.name.trim() || input.route.name;
  const routeDate = dateInput(input.date);
  const dropMinutes = Math.max(1, Math.round(input.dropMinutes || 10));
  const slotMinutes = Math.max(15, Math.round(input.slotMinutes || 60));

  await prisma.$transaction(async (tx) => {
    await tx.stop.deleteMany({ where: { routeId: input.route.id } });
    if (groupIds.length) await tx.deliveryGroup.deleteMany({ where: { id: { in: groupIds } } });
    await tx.route.update({
      where: { id: input.route.id },
      data: {
        name: routeName,
        date: parseDate(routeDate),
        driverId: input.driverId || null,
        plannedStartTime: input.start || "05:00",
        timePerDropMinutes: dropMinutes,
        customerSlotMinutes: slotMinutes,
        startAddress: input.route.startAddress || SHOP.address,
        startLatitude: input.route.startLatitude ?? SHOP.latitude,
        startLongitude: input.route.startLongitude ?? SHOP.longitude,
        finishAddress: input.route.finishAddress || SHOP.address,
        finishLatitude: input.route.finishLatitude ?? SHOP.latitude,
        finishLongitude: input.route.finishLongitude ?? SHOP.longitude,
        totalMileage: null,
        totalDuration: null,
        stops: {
          create: input.orders.map((order, index) => ({
            orderIndex: index + 1,
            estimatedArrival: estimatedArrival(routeDate, input.start || "05:00", index * dropMinutes),
            deliveryGroup: {
              create: {
                address: order.formattedAddress || order.addressSummary,
                formattedAddress: order.formattedAddress,
                postcode: order.postcode,
                latitude: order.latitude,
                longitude: order.longitude,
                addressStatus: order.addressStatus,
                addressSource: order.orderSource === "manual" ? "manual" : order.hasManualOverride ? "manual" : "getaddress",
                addressConfidence: order.addressConfidence,
                manualAddress: order.manualAddress,
                useManualAddress: order.hasManualOverride || order.orderSource === "manual",
                orders: { create: { shopifyOrderId: order.id, shopifyOrderNumber: order.name, orderSource: order.orderSource || "shopify", customerName: order.customerName, customerEmail: order.email, customerPhone: order.phone, postcode: order.postcode, lineItemSummary: order.lineItemSummary } },
              },
            },
          })),
        },
        history: { create: { action: "Draft route edited", details: `Edited on map planner with ${input.orders.length} stops.` } },
      },
    });
  });

  return routeName;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const routeId = params.routeId;
  if (!routeId) throw new Response("Route not found", { status: 404 });

  const [route, deliveryOrders, drivers, credentials] = await Promise.all([
    getDraftRoute(routeId),
    getDeliveryOrders(admin),
    listActiveDrivers(),
    getAppCredentials(),
  ]);
  if (!route) throw new Response("Route not found", { status: 404 });
  if (route.status !== "DRAFT") return redirect(`/app/routes/${route.id}`);

  return json({
    route: { id: route.id, name: route.name, date: dateInput(route.date), driverId: route.driverId || "", plannedStartTime: route.plannedStartTime || "05:00", timePerDropMinutes: route.timePerDropMinutes || 10, customerSlotMinutes: route.customerSlotMinutes || 60, stops: routeStops(route), startAddress: route.startAddress || SHOP.address, startLatitude: route.startLatitude ?? SHOP.latitude, startLongitude: route.startLongitude ?? SHOP.longitude, finishAddress: route.finishAddress || SHOP.address, finishLatitude: route.finishLatitude ?? SHOP.latitude, finishLongitude: route.finishLongitude ?? SHOP.longitude },
    orders: mergeOrders(deliveryOrders, draftOrders(route)),
    drivers,
    routexlEnabled: hasRouteXLCredentials(credentials),
    tomtomApiKey: credentials.tomtomApiKey,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const routeId = params.routeId;
  if (!routeId) throw new Response("Route not found", { status: 404 });

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "saveRoute");
  const ids = String(formData.get("selectedOrderIds") || "").split(",").map((id) => id.trim()).filter(Boolean);
  const route = await getDraftRoute(routeId);
  if (!route) return json({ ok: false, error: "Draft route could not be found." }, { status: 404 });
  if (!ids.length) return json({ ok: false, error: "Select at least one order before saving." }, { status: 400 });

  const orders = await selectedOrdersForAction(admin, ids, route);
  if (!orders.length) return json({ ok: false, error: "Selected orders could not be found." }, { status: 400 });

  const start = String(formData.get("plannedStartTime") || "05:00");
  const dropMinutes = Number(formData.get("timePerDropMinutes") || 10);
  const slotMinutes = Number(formData.get("customerSlotMinutes") || 60);

  if (intent === "optimisePlanning") {
    try {
      const optimisable = orders.filter((order) => typeof order.latitude === "number" && typeof order.longitude === "number");
      if (optimisable.length !== orders.length) throw new Error("Every selected stop needs coordinates before RouteXL can optimise.");
      const locations = [
        buildRouteXLLocation("Route start", route.startAddress || SHOP.address, route.startLatitude ?? SHOP.latitude, route.startLongitude ?? SHOP.longitude, 0),
        ...optimisable.map((order) => buildRouteXLLocation(routeXLStopKey(order.id), order.formattedAddress || order.addressSummary, order.latitude!, order.longitude!, Math.max(1, dropMinutes || 10))),
        buildRouteXLLocation("Route finish", route.finishAddress || SHOP.address, route.finishLatitude ?? SHOP.latitude, route.finishLongitude ?? SHOP.longitude, 0),
      ];
      const optimised = await optimiseLocations(locations);
      if (!optimised.feasible) throw new Error("RouteXL returned an infeasible route.");
      const waypoints = optimised.waypoints.slice(1, -1).map((waypoint) => ({ ...waypoint, id: extractRouteXLStopId(waypoint.name) })).filter((waypoint) => ids.includes(waypoint.id));
      return json<OptimiseResult>({ ok: true, orderedIds: waypoints.map((waypoint) => waypoint.id), stopEtas: waypoints.map((waypoint) => { const mins = toMinutes(waypoint.arrivalMinutes); return { id: waypoint.id, arrivalMinutes: mins, eta: formatTime(start, mins) }; }), totalDistanceKm: optimised.totalDistanceKm, totalDurationMinutes: optimised.totalDurationMinutes });
    } catch (error) {
      return json<OptimiseResult>({ ok: false, error: error instanceof Error ? error.message : "Planning optimisation failed." }, { status: 400 });
    }
  }

  try {
    const name = await replaceDraftRoute({ route, orders, name: String(formData.get("routeName") || ""), date: String(formData.get("routeDate") || ""), start, dropMinutes, slotMinutes, driverId: String(formData.get("driverId") || "") || null });
    return redirect(`/app/routes?toast=draft_saved&route=${encodeURIComponent(name)}`);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Draft route could not be saved." }, { status: 400 });
  }
};

function orderToStop(order: DeliveryOrder, index: number, start: string, dropMinutes: string): Stop {
  return { id: order.id, orderNumber: order.name, customerName: order.customerName, postcode: order.postcode || "", eta: formatTime(start, index * (Number(dropMinutes) || 10)) };
}

function mapTooltip(order: DeliveryOrder, heading: string) {
  const lines = order.lineItemLines?.length ? order.lineItemLines : (order.lineItemSummary || "").split(",").map((line) => line.trim()).filter(Boolean);
  return { tooltipTitle: heading, tooltipLines: [`Postcode: ${order.postcode || "No postcode"}`, "Items:", ...(lines.length ? lines.map((line) => `• ${line}`) : ["Items not listed"])] };
}

function hasCoordinates(order: DeliveryOrder) {
  return typeof order.latitude === "number" && typeof order.longitude === "number";
}

function DeliveryMap({ orders, stops, tomtomApiKey, route, onToggle }: { orders: DeliveryOrder[]; stops: Stop[]; tomtomApiKey: string; route: { startAddress: string; startLatitude: number | null; startLongitude: number | null; finishAddress: string; finishLatitude: number | null; finishLongitude: number | null; }; onToggle: (order: DeliveryOrder) => void }) {
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const stopSet = new Set(stops.map((stop) => stop.id));
  const selected = stops.map((stop, index) => ordersById.get(stop.id)).filter((order): order is DeliveryOrder => Boolean(order) && hasCoordinates(order)).map((order, index) => ({ id: order.id, label: String(index + 1), title: order.name, latitude: order.latitude, longitude: order.longitude, selected: true, ...mapTooltip(order, `${index + 1}. ${order.name} · ${order.customerName}`) }));
  const unselected = orders.filter((order) => hasCoordinates(order) && !stopSet.has(order.id)).map((order) => ({ id: order.id, label: order.name.replace("#", ""), title: order.name, latitude: order.latitude, longitude: order.longitude, selected: false, ...mapTooltip(order, `${order.name} · ${order.customerName}`) }));

  return <RouteMap title="Live planning map" badge={`${stops.length} selected`} apiKey={tomtomApiKey} points={[...selected, ...unselected]} showRouteLine={selected.length > 0} routeStart={{ address: route.startAddress, label: "START", latitude: route.startLatitude, longitude: route.startLongitude, status: "START" }} routeFinish={{ address: route.finishAddress, label: "FINISH", latitude: route.finishLatitude, longitude: route.finishLongitude, status: "FINISH" }} onSelectPoint={(point) => { const order = ordersById.get(point.id); if (order) onToggle(order); }} />;
}

export default function EditRoute() {
  const { route, orders, drivers, routexlEnabled, tomtomApiKey } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher<OptimiseResult>();
  const [stops, setStops] = useState<Stop[]>(route.stops);
  const [name, setName] = useState(route.name);
  const [driverId, setDriverId] = useState(route.driverId);
  const [date, setDate] = useState(route.date);
  const [start, setStart] = useState(route.plannedStartTime);
  const [dropMinutes, setDropMinutes] = useState(String(route.timePerDropMinutes));
  const [slotMinutes, setSlotMinutes] = useState(String(route.customerSlotMinutes));
  const selectedIds = stops.map((stop) => stop.id).join(",");
  const driverOptions = [{ label: "Select driver later", value: "" }, ...drivers.map((driver) => ({ label: driver.name, value: driver.id }))];

  useEffect(() => {
    if (!fetcher.data?.ok) return;
    const eta = new Map(fetcher.data.stopEtas.map((item) => [item.id, item.eta]));
    const ordered = fetcher.data.orderedIds.map((id) => stops.find((stop) => stop.id === id)).filter((stop): stop is Stop => Boolean(stop)).map((stop) => ({ ...stop, eta: eta.get(stop.id) || stop.eta }));
    const missing = stops.filter((stop) => !fetcher.data?.ok || !fetcher.data.orderedIds.includes(stop.id));
    setStops([...ordered, ...missing]);
  }, [fetcher.data]);

  useEffect(() => {
    setStops((current) => current.map((stop, index) => ({ ...stop, eta: formatTime(start, index * (Number(dropMinutes) || 10)) })));
  }, [start, dropMinutes]);

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= stops.length) return;
    setStops(array => {
      const copy = [...array];
      const [item] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, item);
      return copy.map((stop, itemIndex) => ({ ...stop, eta: formatTime(start, itemIndex * (Number(dropMinutes) || 10)) }));
    });
  };

  const toggle = (order: DeliveryOrder) => {
    setStops((current) => current.some((stop) => stop.id === order.id)
      ? current.filter((stop) => stop.id !== order.id).map((stop, index) => ({ ...stop, eta: formatTime(start, index * (Number(dropMinutes) || 10)) }))
      : [...current, orderToStop(order, current.length, start, dropMinutes)]);
  };

  const optimise = () => {
    const formData = new FormData();
    formData.set("intent", "optimisePlanning");
    formData.set("selectedOrderIds", selectedIds);
    formData.set("plannedStartTime", start);
    formData.set("timePerDropMinutes", dropMinutes);
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <Page title="Orders Map" fullWidth backAction={{ content: "Routes", url: "/app/routes" }}>
      <Layout>
        <Layout.Section>
          <LegacyCard>
            <Box padding="400" borderBlockEndWidth="025" borderColor="border"><InlineStack align="space-between"><BlockStack gap="100"><Text as="h2" variant="headingMd">Edit Route</Text><Text as="p" variant="bodySm" tone="subdued">This draft route is loaded back into the planning map. Change it, optimise it, then save it back to the same draft.</Text>{actionData && "error" in actionData ? <Text as="p" variant="bodySm" tone="critical">{actionData.error}</Text> : null}{fetcher.data && !fetcher.data.ok ? <Text as="p" variant="bodySm" tone="critical">{fetcher.data.error}</Text> : null}</BlockStack><Badge tone="info">Editing draft</Badge></InlineStack></Box>
            <Box minHeight="420px" background="bg-surface-secondary" padding="400"><DeliveryMap orders={orders} stops={stops} tomtomApiKey={tomtomApiKey} route={route} onToggle={toggle} /></Box>
          </LegacyCard>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <LegacyCard title="Current Route">
            <Box padding="300" borderBlockEndWidth="025" borderColor="border"><BlockStack gap="200"><Text as="p" variant="bodySm">Stops: {stops.length}</Text><TextField label="Route date" type="date" value={date} onChange={setDate} autoComplete="off" /><Select label="Driver" options={driverOptions} value={driverId} onChange={setDriverId} /><TextField label="Driver start time" type="time" value={start} onChange={setStart} autoComplete="off" /><TextField label="Minutes per drop" type="number" value={dropMinutes} onChange={setDropMinutes} autoComplete="off" /><TextField label="Customer slot minutes" type="number" value={slotMinutes} onChange={setSlotMinutes} autoComplete="off" /><Button onClick={optimise} loading={fetcher.state !== "idle"} disabled={!routexlEnabled || stops.length === 0} variant="primary" tone="critical">Optimise selected route</Button></BlockStack></Box>
            <Box padding="300" borderBlockEndWidth="025" borderColor="border"><BlockStack gap="100">{stops.map((stop, index) => <Box key={stop.id} padding="200" background="bg-surface-secondary" borderRadius="200"><BlockStack gap="100"><Text as="p" variant="bodySm" fontWeight="bold">{index + 1}. {stop.orderNumber} · {stop.customerName}</Text><Text as="p" variant="bodySm" tone="subdued">{stop.postcode || "No postcode"} · ETA {stop.eta}</Text><InlineStack gap="100"><Button onClick={() => move(index, -1)} disabled={index === 0}>Up</Button><Button onClick={() => move(index, 1)} disabled={index === stops.length - 1}>Down</Button><Button tone="critical" onClick={() => setStops((current) => current.filter((item) => item.id !== stop.id))}>Remove</Button></InlineStack></BlockStack></Box>)}</BlockStack></Box>
            <Box padding="300"><Form method="post"><input type="hidden" name="intent" value="saveRoute" /><input type="hidden" name="selectedOrderIds" value={selectedIds} /><input type="hidden" name="driverId" value={driverId} /><input type="hidden" name="routeDate" value={date} /><input type="hidden" name="plannedStartTime" value={start} /><input type="hidden" name="timePerDropMinutes" value={dropMinutes} /><input type="hidden" name="customerSlotMinutes" value={slotMinutes} /><BlockStack gap="300"><TextField label="Draft route name" name="routeName" value={name} onChange={setName} autoComplete="off" /><Button fullWidth submit variant="primary" disabled={stops.length === 0}>Save Draft Route</Button></BlockStack></Form></Box>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
