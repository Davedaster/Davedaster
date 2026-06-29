import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  BlockStack,
  Text,
  Box,
  InlineStack,
  Button,
  Icon,
  Badge,
  EmptyState,
  TextField,
  Checkbox,
  Select,
} from "@shopify/polaris";
import { LockIcon, DeleteIcon, DragHandleIcon } from "@shopify/polaris-icons";
import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { RouteMap } from "../components/RouteMap";
import { listActiveDrivers } from "../lib/drivers.server";
import { lookupAddress } from "../lib/getAddress.server";
import { assignDriverToRoute, createRouteDraft } from "../lib/routeDrafts.server";
import { buildRouteXLLocation, optimiseLocations } from "../lib/routexl.server";
import { authenticate } from "../shopify.server";
import { getDeliveryOrders, toManualDeliveryOrder, type DeliveryOrder, type ManualDeliveryOrderInput } from "../lib/shopifyOrders.server";

interface Stop {
  id: string;
  orderNumber: string;
  customerName: string;
  postcode: string;
  eta: string;
  isLocked: boolean;
}

type ManualPlanningOrder = ManualDeliveryOrderInput & {
  id: string;
};

type StopEta = {
  id: string;
  eta: string;
  arrivalMinutes: number;
};

const defaultRoutePlanningSettings = {
  routeDate: new Date().toISOString().slice(0, 10),
  plannedStartTime: "05:00",
  timePerDropMinutes: 10,
  customerSlotMinutes: 60,
  startAddress: "Unit 1 Olympus Business Park, Newton Abbot, TQ12 2SN, United Kingdom",
  finishAddress: "Unit 1 Olympus Business Park, Newton Abbot, TQ12 2SN, United Kingdom",
};

type PlanningOptimisationResult = {
  ok: true;
  orderedIds: string[];
  stopEtas: StopEta[];
  routeFinishEta: string | null;
  totalDistanceKm: number | null;
  totalDurationMinutes: number | null;
  returnToBase: boolean;
} | {
  ok: false;
  error: string;
};

const DEFAULT_SHOP_LOCATION = {
  address: "Unit 1 Olympus Business Park, Newton Abbot, TQ12 2SN, United Kingdom",
  latitude: 50.5293,
  longitude: -3.6119,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const [orders, drivers] = await Promise.all([
    getDeliveryOrders(admin),
    listActiveDrivers(),
  ]);

  return json({
    orders,
    drivers,
    addressLookupEnabled: Boolean(process.env.GETADDRESS_API_KEY),
    routexlEnabled: Boolean(process.env.ROUTEXL_USERNAME && process.env.ROUTEXL_PASSWORD),
    defaults: defaultRoutePlanningSettings,
  });
};

function parseManualOrders(value: FormDataEntryValue | null): ManualPlanningOrder[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as ManualPlanningOrder[];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((order) => ({
        id: String(order.id || "").trim(),
        customerName: String(order.customerName || "").trim(),
        address: String(order.address || "").trim(),
        email: String(order.email || "").trim(),
        phone: String(order.phone || "").trim(),
        lineItemSummary: String(order.lineItemSummary || "").trim(),
      }))
      .filter((order) => order.id && order.customerName && order.address && order.lineItemSummary);
  } catch {
    return [];
  }
}

function extractPostcode(value: string) {
  const match = value.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);

  return match?.[0]?.toUpperCase() || "";
}

async function resolvePlanningEndpoint(address: string | null | undefined) {
  const trimmedAddress = address?.trim() || DEFAULT_SHOP_LOCATION.address;

  if (trimmedAddress.toLowerCase() === DEFAULT_SHOP_LOCATION.address.toLowerCase()) {
    return {
      address: DEFAULT_SHOP_LOCATION.address,
      latitude: DEFAULT_SHOP_LOCATION.latitude,
      longitude: DEFAULT_SHOP_LOCATION.longitude,
    };
  }

  const lookup = await lookupAddress(extractPostcode(trimmedAddress), trimmedAddress);

  if (typeof lookup.latitude !== "number" || typeof lookup.longitude !== "number") {
    throw new Error(`Could not find coordinates for ${trimmedAddress}.`);
  }

  return {
    address: lookup.formattedAddress || trimmedAddress,
    latitude: lookup.latitude,
    longitude: lookup.longitude,
  };
}

function planningStopKey(orderId: string) {
  return `STOP_${orderId}`;
}

function extractPlanningStopId(waypointName: string) {
  const key = waypointName.split(",")[0]?.trim() || waypointName.trim();
  return key.replace(/^STOP_/, "");
}

function routeArrivalToMinutes(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  const rounded = Math.round(value);

  return rounded > 24 * 60 ? Math.round(rounded / 60) : rounded;
}

async function getSelectedPlanningOrders(admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"], selectedOrderIds: string[], manualOrders: ManualPlanningOrder[]) {
  const [shopifyOrders, manualDeliveryOrders] = await Promise.all([
    getDeliveryOrders(admin),
    Promise.all(manualOrders.map((order) => toManualDeliveryOrder(order))),
  ]);
  const ordersById = new Map([...shopifyOrders, ...manualDeliveryOrders].map((order) => [order.id, order]));

  return selectedOrderIds
    .map((id) => ordersById.get(id))
    .filter((order): order is DeliveryOrder => Boolean(order));
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "saveRoute");
  const routeName = String(formData.get("routeName") || "").trim();
  const routeDate = String(formData.get("routeDate") || "").trim();
  const plannedStartTime = String(formData.get("plannedStartTime") || "").trim();
  const timePerDropMinutes = Number(formData.get("timePerDropMinutes") || defaultRoutePlanningSettings.timePerDropMinutes);
  const customerSlotMinutes = Number(formData.get("customerSlotMinutes") || defaultRoutePlanningSettings.customerSlotMinutes);
  const startAddress = String(formData.get("startAddress") || "").trim();
  const finishAddress = String(formData.get("finishAddress") || "").trim();
  const returnToBase = String(formData.get("returnToBase") || "") === "true";
  const driverId = String(formData.get("driverId") || "").trim();
  const manualOrders = parseManualOrders(formData.get("manualOrdersJson"));
  const selectedOrderIds = String(formData.get("selectedOrderIds") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!selectedOrderIds.length) {
    return json({ ok: false, error: "Select at least one order before saving or optimising a route." }, { status: 400 });
  }

  const selectedOrders = await getSelectedPlanningOrders(admin, selectedOrderIds, manualOrders);

  if (!selectedOrders.length) {
    return json({ ok: false, error: "Selected orders could not be found." }, { status: 400 });
  }

  if (intent === "optimisePlanning") {
    try {
      const start = await resolvePlanningEndpoint(startAddress);
      const finish = returnToBase
        ? start
        : await resolvePlanningEndpoint(finishAddress || startAddress);
      const optimisableStops = selectedOrders.filter((order) => typeof order.latitude === "number" && typeof order.longitude === "number");

      if (optimisableStops.length !== selectedOrders.length) {
        throw new Error("Every selected stop needs latitude and longitude before RouteXL can optimise the planning route.");
      }

      const locations = [
        buildRouteXLLocation("Route start", start.address, start.latitude, start.longitude, 0),
        ...optimisableStops.map((order) => buildRouteXLLocation(
          planningStopKey(order.id),
          order.formattedAddress || order.addressSummary,
          order.latitude!,
          order.longitude!,
          Number.isFinite(timePerDropMinutes) ? timePerDropMinutes : defaultRoutePlanningSettings.timePerDropMinutes,
        )),
        buildRouteXLLocation("Route finish", finish.address, finish.latitude, finish.longitude, 0),
      ];
      const optimised = await optimiseLocations(locations);

      if (!optimised.feasible) {
        throw new Error("RouteXL returned an infeasible route. Check the selected stops and try again.");
      }

      const stopWaypoints = optimised.waypoints
        .slice(1, -1)
        .map((waypoint) => ({ ...waypoint, id: extractPlanningStopId(waypoint.name) }))
        .filter((waypoint) => selectedOrderIds.includes(waypoint.id));
      const orderedIds = stopWaypoints.map((waypoint) => waypoint.id);
      const stopEtas = stopWaypoints.map((waypoint) => {
        const arrivalMinutes = routeArrivalToMinutes(waypoint.arrivalMinutes);

        return {
          id: waypoint.id,
          arrivalMinutes,
          eta: formatEtaTime(plannedStartTime, arrivalMinutes),
        };
      });
      const finalWaypoint = optimised.waypoints[optimised.waypoints.length - 1];
      const totalDurationMinutes = routeArrivalToMinutes(finalWaypoint?.arrivalMinutes ?? optimised.totalDurationMinutes);

      return json<PlanningOptimisationResult>({
        ok: true,
        orderedIds,
        stopEtas,
        routeFinishEta: finalWaypoint ? formatEtaTime(plannedStartTime, totalDurationMinutes) : null,
        totalDistanceKm: optimised.totalDistanceKm,
        totalDurationMinutes,
        returnToBase,
      });
    } catch (error) {
      return json<PlanningOptimisationResult>({ ok: false, error: error instanceof Error ? error.message : "Planning optimisation failed." }, { status: 400 });
    }
  }

  const draftRoute = await createRouteDraft({
    orders: selectedOrders,
    routeName,
    routeDate,
    plannedStartTime,
    timePerDropMinutes,
    customerSlotMinutes,
    startAddress,
    finishAddress: returnToBase
      ? startAddress
      : finishAddress || selectedOrders[selectedOrders.length - 1]?.formattedAddress || selectedOrders[selectedOrders.length - 1]?.addressSummary || startAddress,
  });

  if (driverId) {
    await assignDriverToRoute(draftRoute.id, driverId);
  }

  return redirect("/app/routes");
};

function SortableStop({ stop, onRemove, onToggleLock }: { stop: Stop; onRemove: (id: string) => void; onToggleLock: (id: string) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stop.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
    position: "relative" as const,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Box padding="300" borderBlockEndWidth="025" borderColor="border">
        <InlineStack align="space-between">
          <InlineStack gap="200">
            <div {...attributes} {...listeners} style={{ cursor: "grab" }}>
              <Icon source={DragHandleIcon} tone="subdued" />
            </div>
            <BlockStack gap="050">
              <Text as="span" variant="bodyMd" fontWeight="bold">
                {stop.orderNumber} · {stop.customerName}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {stop.postcode || "No postcode"} · ETA: {stop.eta}
              </Text>
            </BlockStack>
          </InlineStack>
          <InlineStack gap="100">
            <Button
              icon={LockIcon}
              variant="tertiary"
              pressed={stop.isLocked}
              onClick={() => onToggleLock(stop.id)}
            />
            <Button
              icon={DeleteIcon}
              variant="tertiary"
              tone="critical"
              onClick={() => onRemove(stop.id)}
            />
          </InlineStack>
        </InlineStack>
      </Box>
    </div>
  );
}

function formatEtaTime(startTime: string, offsetMinutes: number) {
  const [hours, minutes = "0"] = startTime.split(":");
  const startMinutes = Number(hours) * 60 + Number(minutes);
  const etaMinutes = startMinutes + offsetMinutes;
  const etaHours = Math.floor(etaMinutes / 60) % 24;
  const etaMinuteValue = etaMinutes % 60;

  return `${String(etaHours).padStart(2, "0")}:${String(etaMinuteValue).padStart(2, "0")}`;
}

function deliveryOrderToStop(order: DeliveryOrder, stopNumber: number, plannedStartTime: string, timePerDropMinutes: string): Stop {
  const dropMinutes = Number(timePerDropMinutes) || defaultRoutePlanningSettings.timePerDropMinutes;

  return {
    id: order.id,
    orderNumber: order.name,
    customerName: order.customerName,
    postcode: order.postcode || "",
    eta: formatEtaTime(plannedStartTime, (stopNumber - 1) * dropMinutes),
    isLocked: false,
  };
}

function refreshStopEtas(stops: Stop[], plannedStartTime: string, timePerDropMinutes: string) {
  const dropMinutes = Number(timePerDropMinutes) || defaultRoutePlanningSettings.timePerDropMinutes;

  return stops.map((stop, index) => ({
    ...stop,
    eta: formatEtaTime(plannedStartTime, index * dropMinutes),
  }));
}

function manualOrderToDeliveryOrder(order: ManualPlanningOrder): DeliveryOrder {
  return {
    id: order.id,
    name: order.id.replace("manual:", "MANUAL-").toUpperCase(),
    createdAt: new Date().toISOString(),
    customerName: order.customerName,
    email: order.email || null,
    phone: order.phone || null,
    shippingMethod: "Manual route entry",
    fulfilmentStatus: "unfulfilled",
    financialStatus: "manual",
    postcode: "Manual",
    addressSummary: order.address,
    formattedAddress: order.address,
    hasDeliveryAddress: true,
    hasPanel: true,
    isSampleOnly: false,
    addressStatus: "NEEDS_LOCATION_CHECK",
    addressConfidence: "LOW",
    latitude: null,
    longitude: null,
    lineItemSummary: order.lineItemSummary,
    hasManualOverride: true,
    manualAddress: order.address,
    manualAddressNotes: "Manual order added from the planning map",
    orderSource: "manual",
  };
}

function addressLabel(order: DeliveryOrder) {
  if (order.orderSource === "manual") {
    return "Manual order";
  }

  if (order.hasManualOverride) {
    return "Manual address";
  }

  if (order.addressStatus === "NEEDS_ADDRESS") {
    return "Needs address";
  }

  if (order.addressStatus === "NEEDS_LOCATION_CHECK") {
    return "Needs location check";
  }

  return order.addressConfidence === "HIGH" ? "Location ready" : "Ready";
}

function hasCoordinates(order: DeliveryOrder) {
  return typeof order.latitude === "number" && typeof order.longitude === "number";
}

function DeliveryMap({
  orders,
  selectedIds,
  routeStopIds,
  startAddress,
  finishAddress,
  returnToBase,
  onToggleOrder,
}: {
  orders: DeliveryOrder[];
  selectedIds: Set<string>;
  routeStopIds: string[];
  startAddress: string;
  finishAddress: string;
  returnToBase: boolean;
  onToggleOrder: (order: DeliveryOrder) => void;
}) {
  const ordersWithCoordinates = orders.filter(hasCoordinates);
  const ordersWithoutCoordinates = orders.filter((order) => !hasCoordinates(order));
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const routeStopSet = new Set(routeStopIds);
  const routePoints = routeStopIds
    .map((id) => ordersById.get(id))
    .filter((order): order is DeliveryOrder => Boolean(order) && hasCoordinates(order))
    .map((order, index) => ({
      id: order.id,
      label: String(index + 1),
      title: `${index + 1}. ${order.name} · ${order.customerName} · ${order.postcode || "No postcode"}`,
      latitude: order.latitude,
      longitude: order.longitude,
      selected: true,
    }));
  const unselectedPoints = ordersWithCoordinates
    .filter((order) => !routeStopSet.has(order.id))
    .map((order) => ({
      id: order.id,
      label: order.name.replace("#", ""),
      title: `${order.name} · ${order.customerName} · ${order.postcode || "No postcode"}`,
      latitude: order.latitude,
      longitude: order.longitude,
      selected: selectedIds.has(order.id),
    }));

  return (
    <BlockStack gap="300">
      <RouteMap
        title="Live planning map"
        badge={`${routeStopIds.length} selected`}
        points={[...routePoints, ...unselectedPoints]}
        showRouteLine={routePoints.length > 0}
        routeStart={{
          address: startAddress,
          label: "START",
          status: "START",
        }}
        routeFinish={{
          address: returnToBase ? startAddress : finishAddress || startAddress,
          label: "FINISH",
          status: "FINISH",
        }}
        onSelectPoint={(point) => {
          const order = ordersById.get(point.id);
          if (order) {
            onToggleOrder(order);
          }
        }}
      />

      {ordersWithoutCoordinates.length ? (
        <LegacyCard sectioned>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">Needs location check before a pin can be shown</Text>
            {ordersWithoutCoordinates.map((order) => (
              <InlineStack key={order.id} align="space-between">
                <Text as="span" variant="bodySm">
                  {order.name} · {order.customerName} · {order.postcode || "No postcode"}
                </Text>
                <Badge tone={order.orderSource === "manual" ? "info" : "warning"}>{addressLabel(order)}</Badge>
              </InlineStack>
            ))}
          </BlockStack>
        </LegacyCard>
      ) : null}
    </BlockStack>
  );
}

function formatDuration(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) {
    return "Pending";
  }

  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;

  if (!hours) {
    return `${mins} min`;
  }

  return `${hours} hr ${mins} min`;
}

export default function OrdersMap() {
  const { orders, drivers, addressLookupEnabled, routexlEnabled, defaults } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const optimisationFetcher = useFetcher<PlanningOptimisationResult>();
  const [stops, setStops] = useState<Stop[]>([]);
  const [routeName, setRouteName] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [routeDate, setRouteDate] = useState(defaults.routeDate);
  const [plannedStartTime, setPlannedStartTime] = useState(defaults.plannedStartTime);
  const [timePerDropMinutes, setTimePerDropMinutes] = useState(String(defaults.timePerDropMinutes));
  const [customerSlotMinutes, setCustomerSlotMinutes] = useState(String(defaults.customerSlotMinutes));
  const [startAddress, setStartAddress] = useState(defaults.startAddress);
  const [finishAddress, setFinishAddress] = useState(defaults.finishAddress);
  const [returnToBase, setReturnToBase] = useState(true);
  const [manualOrders, setManualOrders] = useState<ManualPlanningOrder[]>([]);
  const [manualCustomerName, setManualCustomerName] = useState("");
  const [manualAddress, setManualAddress] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualItems, setManualItems] = useState("");
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null);
  const [routeDurationMinutes, setRouteDurationMinutes] = useState<number | null>(null);
  const [routeFinishEta, setRouteFinishEta] = useState<string | null>(null);

  const driverOptions = useMemo(() => [
    { label: "Select driver later", value: "" },
    ...drivers.map((driver) => ({
      label: driver.name,
      value: driver.id,
    })),
  ], [drivers]);
  const selectedDriver = drivers.find((driver) => driver.id === selectedDriverId);
  const manualDeliveryOrders = useMemo(() => manualOrders.map(manualOrderToDeliveryOrder), [manualOrders]);
  const allOrders = useMemo(() => [...orders, ...manualDeliveryOrders], [orders, manualDeliveryOrders]);
  const selectedIds = useMemo(() => new Set(stops.map((stop) => stop.id)), [stops]);
  const selectedOrderIds = stops.map((stop) => stop.id).join(",");
  const manualOrdersJson = JSON.stringify(manualOrders);
  const optimisationRunning = optimisationFetcher.state !== "idle";
  const optimisationError = optimisationFetcher.data && !optimisationFetcher.data.ok ? optimisationFetcher.data.error : null;

  useEffect(() => {
    if (!optimisationFetcher.data?.ok) {
      return;
    }

    const etaById = new Map(optimisationFetcher.data.stopEtas.map((stopEta) => [stopEta.id, stopEta.eta]));
    const orderedStops = optimisationFetcher.data.orderedIds
      .map((id) => stops.find((stop) => stop.id === id))
      .filter((stop): stop is Stop => Boolean(stop))
      .map((stop) => ({
        ...stop,
        eta: etaById.get(stop.id) || stop.eta,
      }));
    const missingStops = stops.filter((stop) => !optimisationFetcher.data?.ok || !optimisationFetcher.data.orderedIds.includes(stop.id));

    setStops([...orderedStops, ...missingStops]);
    setRouteDistanceKm(optimisationFetcher.data.totalDistanceKm);
    setRouteDurationMinutes(optimisationFetcher.data.totalDurationMinutes);
    setRouteFinishEta(optimisationFetcher.data.routeFinishEta);
  }, [optimisationFetcher.data]);

  useEffect(() => {
    setStops((currentStops) => refreshStopEtas(currentStops, plannedStartTime, timePerDropMinutes));
  }, [plannedStartTime, timePerDropMinutes]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const clearOptimisedStats = () => {
    setRouteDistanceKm(null);
    setRouteDurationMinutes(null);
    setRouteFinishEta(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setStops((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);

        return refreshStopEtas(arrayMove(items, oldIndex, newIndex), plannedStartTime, timePerDropMinutes);
      });
      clearOptimisedStats();
    }
  };

  const toggleOrder = (order: DeliveryOrder) => {
    if (!hasCoordinates(order) && order.orderSource !== "manual") {
      return;
    }

    setStops((currentStops) => {
      if (currentStops.some((stop) => stop.id === order.id)) {
        return refreshStopEtas(currentStops.filter((stop) => stop.id !== order.id), plannedStartTime, timePerDropMinutes);
      }

      return refreshStopEtas([...currentStops, deliveryOrderToStop(order, currentStops.length + 1, plannedStartTime, timePerDropMinutes)], plannedStartTime, timePerDropMinutes);
    });
    clearOptimisedStats();
  };

  const removeStop = (id: string) => {
    setStops(refreshStopEtas(stops.filter((s) => s.id !== id), plannedStartTime, timePerDropMinutes));
    clearOptimisedStats();
  };

  const toggleLock = (id: string) => {
    setStops(stops.map((s) => s.id === id ? { ...s, isLocked: !s.isLocked } : s));
  };

  const optimisePlanningRoute = () => {
    const formData = new FormData();
    formData.set("intent", "optimisePlanning");
    formData.set("selectedOrderIds", selectedOrderIds);
    formData.set("manualOrdersJson", manualOrdersJson);
    formData.set("routeDate", routeDate);
    formData.set("plannedStartTime", plannedStartTime);
    formData.set("timePerDropMinutes", timePerDropMinutes);
    formData.set("customerSlotMinutes", customerSlotMinutes);
    formData.set("startAddress", startAddress);
    formData.set("finishAddress", returnToBase ? startAddress : finishAddress);
    formData.set("returnToBase", returnToBase ? "true" : "false");

    optimisationFetcher.submit(formData, { method: "post" });
  };

  const addManualOrder = () => {
    const customerName = manualCustomerName.trim();
    const address = manualAddress.trim();
    const lineItemSummary = manualItems.trim();

    if (!customerName || !address || !lineItemSummary) {
      return;
    }

    const nextNumber = manualOrders.length + 1;
    const manualOrder: ManualPlanningOrder = {
      id: `manual:${Date.now()}-${nextNumber}`,
      customerName,
      address,
      email: manualEmail.trim(),
      phone: manualPhone.trim(),
      lineItemSummary,
    };
    const deliveryOrder = manualOrderToDeliveryOrder(manualOrder);

    setManualOrders((currentOrders) => [...currentOrders, manualOrder]);
    setStops((currentStops) => refreshStopEtas([...currentStops, deliveryOrderToStop(deliveryOrder, currentStops.length + 1, plannedStartTime, timePerDropMinutes)], plannedStartTime, timePerDropMinutes));
    clearOptimisedStats();
    setManualCustomerName("");
    setManualAddress("");
    setManualEmail("");
    setManualPhone("");
    setManualItems("");
  };

  const removeManualOrder = (id: string) => {
    setManualOrders((currentOrders) => currentOrders.filter((order) => order.id !== id));
    setStops((currentStops) => refreshStopEtas(currentStops.filter((stop) => stop.id !== id), plannedStartTime, timePerDropMinutes));
    clearOptimisedStats();
  };

  return (
    <Page title="Orders Map" fullWidth>
      <Layout>
        <Layout.Section>
          <LegacyCard>
            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
              <InlineStack align="space-between">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Ready for own fleet delivery</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Click delivery pins to build a route, then select a driver, optimise and save the draft.
                  </Text>
                  {!addressLookupEnabled ? (
                    <Text as="p" variant="bodySm" tone="critical">
                      getAddress.io lookup is not enabled yet. Add GETADDRESS_API_KEY to the app environment before testing live coordinates.
                    </Text>
                  ) : null}
                  {!routexlEnabled ? (
                    <Text as="p" variant="bodySm" tone="critical">
                      RouteXL is not enabled yet. Add ROUTEXL_USERNAME and ROUTEXL_PASSWORD before using live planning optimisation.
                    </Text>
                  ) : null}
                  {actionData && "error" in actionData ? (
                    <Text as="p" variant="bodySm" tone="critical">{actionData.error}</Text>
                  ) : null}
                </BlockStack>
                <Badge tone="info">{allOrders.length} orders</Badge>
              </InlineStack>
            </Box>

            <Box minHeight="420px" background="bg-surface-secondary" padding="400">
              {allOrders.length === 0 ? (
                <EmptyState
                  heading="No matching delivery orders found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>No orders matched the current delivery filters.</p>
                </EmptyState>
              ) : (
                <DeliveryMap
                  orders={allOrders}
                  selectedIds={selectedIds}
                  routeStopIds={stops.map((stop) => stop.id)}
                  startAddress={startAddress}
                  finishAddress={finishAddress}
                  returnToBase={returnToBase}
                  onToggleOrder={toggleOrder}
                />
              )}
            </Box>
          </LegacyCard>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <LegacyCard title="Current Route">
            <Box padding="300" borderBlockEndWidth="025" borderColor="border">
              <BlockStack gap="300">
                <BlockStack gap="100">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">Stops: {stops.length}</Text>
                    <Text as="span" variant="bodySm">Miles: {routeDistanceKm === null ? "Pending" : `${(routeDistanceKm * 0.621371).toFixed(1)} mi`}</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">Complete route time: {formatDuration(routeDurationMinutes)}</Text>
                    <Badge tone={routeDistanceKm === null ? "info" : "success"}>{routeDistanceKm === null ? "Not optimised" : "Optimised"}</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {returnToBase ? "Route includes return to base." : "Route ends at the custom finish location."}
                    {routeFinishEta ? ` Finish ETA: ${routeFinishEta}.` : ""}
                  </Text>
                  {selectedDriver ? (
                    <Text as="p" variant="bodySm" tone="subdued">Driver selected: {selectedDriver.name}</Text>
                  ) : null}
                  {optimisationError ? <Text as="p" variant="bodySm" tone="critical">{optimisationError}</Text> : null}
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Route planning</Text>
                  <TextField label="Route date" type="date" value={routeDate} onChange={setRouteDate} autoComplete="off" />
                  <Select
                    label="Driver"
                    options={driverOptions}
                    value={selectedDriverId}
                    onChange={setSelectedDriverId}
                  />
                  {!drivers.length ? (
                    <Text as="p" variant="bodySm" tone="subdued">No active drivers yet. Add one in Driver profiles first.</Text>
                  ) : null}
                  <TextField label="Driver start time" type="time" value={plannedStartTime} onChange={(value) => { setPlannedStartTime(value); clearOptimisedStats(); }} autoComplete="off" />
                  <TextField label="Minutes per drop" type="number" value={timePerDropMinutes} onChange={(value) => { setTimePerDropMinutes(value); clearOptimisedStats(); }} autoComplete="off" />
                  <TextField label="Customer slot minutes" type="number" value={customerSlotMinutes} onChange={setCustomerSlotMinutes} autoComplete="off" />
                  <TextField label="Driver start location" value={startAddress} onChange={(value) => { setStartAddress(value); clearOptimisedStats(); }} autoComplete="off" multiline={2} />
                  <Checkbox label="Return to base after last drop" checked={returnToBase} onChange={(checked) => { setReturnToBase(checked); clearOptimisedStats(); }} />
                  {!returnToBase ? <TextField label="Custom finish location" value={finishAddress} onChange={(value) => { setFinishAddress(value); clearOptimisedStats(); }} autoComplete="off" multiline={2} /> : null}
                  <Button onClick={optimisePlanningRoute} loading={optimisationRunning} disabled={!routexlEnabled || stops.length === 0}>Optimise selected route</Button>
                </BlockStack>
              </BlockStack>
            </Box>

            <Box padding="300" borderBlockEndWidth="025" borderColor="border">
              <BlockStack gap="200">
                <details>
                  <summary style={{ cursor: "pointer", listStyle: "none" }}>
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="050">
                        <Text as="h3" variant="headingSm">Add manual order</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Open this only when you need to add a non-Shopify delivery.</Text>
                      </BlockStack>
                      <span style={{ border: "1px solid #c9cccf", borderRadius: 8, padding: "6px 10px", fontSize: 13, fontWeight: 700, color: "#323841" }}>Open</span>
                    </InlineStack>
                  </summary>
                  <div style={{ marginTop: 12 }}>
                    <BlockStack gap="200">
                      <TextField label="Customer name" value={manualCustomerName} onChange={setManualCustomerName} autoComplete="off" />
                      <TextField label="Address" value={manualAddress} onChange={setManualAddress} autoComplete="off" multiline={2} />
                      <TextField label="Email" type="email" value={manualEmail} onChange={setManualEmail} autoComplete="off" />
                      <TextField label="Phone" value={manualPhone} onChange={setManualPhone} autoComplete="off" />
                      <TextField label="What they ordered" value={manualItems} onChange={setManualItems} autoComplete="off" multiline={2} />
                      <Button onClick={addManualOrder} disabled={!manualCustomerName.trim() || !manualAddress.trim() || !manualItems.trim()}>Add manual order to route</Button>
                    </BlockStack>
                  </div>
                </details>
                {manualOrders.length ? (
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm">Manual orders added</Text>
                    {manualOrders.map((order) => (
                      <InlineStack key={order.id} align="space-between">
                        <Text as="span" variant="bodySm">{order.customerName} · {order.lineItemSummary}</Text>
                        <Button variant="tertiary" tone="critical" onClick={() => removeManualOrder(order.id)}>Remove</Button>
                      </InlineStack>
                    ))}
                  </BlockStack>
                ) : null}
              </BlockStack>
            </Box>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={stops} strategy={verticalListSortingStrategy}>
                {stops.map((stop) => (
                  <SortableStop key={stop.id} stop={stop} onRemove={removeStop} onToggleLock={toggleLock} />
                ))}
              </SortableContext>
            </DndContext>
            <Box padding="300">
              <Form method="post">
                <input type="hidden" name="intent" value="saveRoute" />
                <input type="hidden" name="selectedOrderIds" value={selectedOrderIds} />
                <input type="hidden" name="manualOrdersJson" value={manualOrdersJson} />
                <input type="hidden" name="driverId" value={selectedDriverId} />
                <input type="hidden" name="routeDate" value={routeDate} />
                <input type="hidden" name="plannedStartTime" value={plannedStartTime} />
                <input type="hidden" name="timePerDropMinutes" value={timePerDropMinutes} />
                <input type="hidden" name="customerSlotMinutes" value={customerSlotMinutes} />
                <input type="hidden" name="startAddress" value={startAddress} />
                <input type="hidden" name="finishAddress" value={returnToBase ? startAddress : finishAddress} />
                <input type="hidden" name="returnToBase" value={returnToBase ? "true" : "false"} />
                <BlockStack gap="300">
                  <TextField
                    label="Draft route name, optional"
                    name="routeName"
                    value={routeName}
                    onChange={setRouteName}
                    autoComplete="off"
                    placeholder="Example, Chris, North Route"
                  />
                  <Button fullWidth submit variant="primary" disabled={stops.length === 0}>Save Draft Route</Button>
                </BlockStack>
              </Form>
            </Box>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
