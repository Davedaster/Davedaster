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
  FormLayout,
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
import { defaultCountry, emptyStructuredAddress, formatStructuredAddress, isStructuredAddressReady, normaliseStructuredAddress, type StructuredAddress } from "../lib/addressFields";
import { getAppCredentials, hasGetAddressCredentials, hasRouteXLCredentials } from "../lib/appCredentials.server";
import { fulfilByDateFromOrderDate } from "../lib/bankHolidays.server";
import { listActiveDrivers } from "../lib/drivers.server";
import { lookupAddress } from "../lib/getAddress.server";
import { assignDriverToRoute, createRouteDraft } from "../lib/routeDrafts.server";
import { getRoutePlanningDefaults } from "../lib/routeSettings.server";
import { buildRouteXLLocation, optimiseLocations } from "../lib/routexl.server";
import { linkPlannedReturnTicketsToRoute, listOpenReturnPlanningOrders } from "../lib/returns.server";
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

const fallbackRoutePlanningSettings = {
  routeDate: new Date().toISOString().slice(0, 10),
  plannedStartTime: "05:00",
  timePerDropMinutes: 10,
  customerSlotMinutes: 60,
  fulfilmentWindowDays: 7,
  useWorkingDaysOnly: true,
  startAddress: "Unit 1 Olympus Business Park, Kingsteignton Road, Newton Abbot, Devon, TQ12 2SN, United Kingdom",
  startLatitude: 50.5293,
  startLongitude: -3.6119,
  finishAddress: "Unit 1 Olympus Business Park, Kingsteignton Road, Newton Abbot, Devon, TQ12 2SN, United Kingdom",
  finishLatitude: 50.5293,
  finishLongitude: -3.6119,
  returnToBaseDefault: true,
  startStructuredAddress: {
    building: "Unit 1 Olympus Business Park",
    addressLine1: "Kingsteignton Road",
    addressLine2: "",
    town: "Newton Abbot",
    county: "Devon",
    postcode: "TQ12 2SN",
    country: defaultCountry,
  },
};

async function addFulfilByDates(orders: DeliveryOrder[], fulfilmentWindowDays: number, useWorkingDaysOnly: boolean) {
  const fulfilByDatesByOrderDate = new Map<string, string>();

  for (const order of orders) {
    const orderDateKey = order.createdAt.slice(0, 10);

    if (!fulfilByDatesByOrderDate.has(orderDateKey)) {
      fulfilByDatesByOrderDate.set(orderDateKey, await fulfilByDateFromOrderDate(order.createdAt, {
        days: fulfilmentWindowDays,
        useWorkingDaysOnly,
      }));
    }
  }

  return orders.map((order) => ({
    ...order,
    fulfilByDate: fulfilByDatesByOrderDate.get(order.createdAt.slice(0, 10)) || null,
  }));
}

async function listReturnPlanningOrdersSafely() {
  try {
    return await listOpenReturnPlanningOrders();
  } catch (error) {
    console.warn("Return planning orders could not be loaded", error);
    return [];
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const [orders, returnPlanningOrders, drivers, defaults, credentials] = await Promise.all([
    getDeliveryOrders(admin),
    listReturnPlanningOrdersSafely(),
    listActiveDrivers(),
    getRoutePlanningDefaults(),
    getAppCredentials(),
  ]);
  const mergedDefaults = {
    ...fallbackRoutePlanningSettings,
    ...defaults,
    routeDate: new Date().toISOString().slice(0, 10),
    startStructuredAddress: normaliseStructuredAddress(defaults.startStructuredAddress, fallbackRoutePlanningSettings.startStructuredAddress),
  };
  const ordersWithFulfilByDates = await addFulfilByDates(
    orders,
    mergedDefaults.fulfilmentWindowDays,
    mergedDefaults.useWorkingDaysOnly,
  );

  return json({
    orders: [...ordersWithFulfilByDates, ...returnPlanningOrders],
    drivers,
    addressLookupEnabled: hasGetAddressCredentials(credentials),
    routexlEnabled: hasRouteXLCredentials(credentials),
    tomtomApiKey: credentials.tomtomApiKey,
    defaults: mergedDefaults,
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

function formCoordinate(formData: FormData, name: string) {
  const rawValue = String(formData.get(name) || "").trim();

  if (!rawValue) {
    return null;
  }

  const value = Number(rawValue);

  return Number.isFinite(value) ? value : null;
}

function formatEtaTime(startTime: string, offsetMinutes: number) {
  const [hours, minutes = "0"] = startTime.split(":");
  const startMinutes = Number(hours) * 60 + Number(minutes);
  const etaMinutes = startMinutes + offsetMinutes;
  const etaHours = Math.floor(etaMinutes / 60) % 24;
  const etaMinuteValue = etaMinutes % 60;

  return `${String(etaHours).padStart(2, "0")}:${String(etaMinuteValue).padStart(2, "0")}`;
}

async function resolvePlanningEndpoint(address: string | null | undefined, latitude?: number | null, longitude?: number | null) {
  const trimmedAddress = address?.trim();

  if (!trimmedAddress) {
    throw new Error("Enter a route start or finish address before optimising.");
  }

  if (typeof latitude === "number" && Number.isFinite(latitude) && typeof longitude === "number" && Number.isFinite(longitude)) {
    return {
      address: trimmedAddress,
      latitude,
      longitude,
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
  const [shopifyOrders, returnPlanningOrders, manualDeliveryOrders] = await Promise.all([
    getDeliveryOrders(admin),
    listReturnPlanningOrdersSafely(),
    Promise.all(manualOrders.map((order) => toManualDeliveryOrder(order))),
  ]);
  const ordersById = new Map([...shopifyOrders, ...returnPlanningOrders, ...manualDeliveryOrders].map((order) => [order.id, order]));

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
  const timePerDropMinutes = Number(formData.get("timePerDropMinutes") || fallbackRoutePlanningSettings.timePerDropMinutes);
  const customerSlotMinutes = Number(formData.get("customerSlotMinutes") || fallbackRoutePlanningSettings.customerSlotMinutes);
  const startAddress = String(formData.get("startAddress") || "").trim();
  const finishAddress = String(formData.get("finishAddress") || "").trim();
  const startLatitude = formCoordinate(formData, "startLatitude");
  const startLongitude = formCoordinate(formData, "startLongitude");
  const rawFinishLatitude = formCoordinate(formData, "finishLatitude");
  const rawFinishLongitude = formCoordinate(formData, "finishLongitude");
  const returnToBase = String(formData.get("returnToBase") || "") === "true";
  const finishLatitude = returnToBase ? startLatitude : rawFinishLatitude;
  const finishLongitude = returnToBase ? startLongitude : rawFinishLongitude;
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
      const start = await resolvePlanningEndpoint(startAddress, startLatitude, startLongitude);
      const finish = returnToBase
        ? start
        : await resolvePlanningEndpoint(finishAddress || startAddress, finishLatitude, finishLongitude);
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
          Number.isFinite(timePerDropMinutes) ? timePerDropMinutes : fallbackRoutePlanningSettings.timePerDropMinutes,
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
    startLatitude,
    startLongitude,
    finishAddress: returnToBase ? startAddress : finishAddress || startAddress,
    finishLatitude,
    finishLongitude,
  });

  if (driverId) {
    await assignDriverToRoute(draftRoute.id, driverId);
  }

  await linkPlannedReturnTicketsToRoute(draftRoute.id);

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
            <Button icon={LockIcon} variant="tertiary" pressed={stop.isLocked} onClick={() => onToggleLock(stop.id)} />
            <Button icon={DeleteIcon} variant="tertiary" tone="critical" onClick={() => onRemove(stop.id)} />
          </InlineStack>
        </InlineStack>
      </Box>
    </div>
  );
}

function deliveryOrderToStop(order: DeliveryOrder, stopNumber: number, plannedStartTime: string, timePerDropMinutes: string): Stop {
  const dropMinutes = Number(timePerDropMinutes) || fallbackRoutePlanningSettings.timePerDropMinutes;

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
  const dropMinutes = Number(timePerDropMinutes) || fallbackRoutePlanningSettings.timePerDropMinutes;

  return stops.map((stop, index) => ({
    ...stop,
    eta: formatEtaTime(plannedStartTime, index * dropMinutes),
  }));
}

function manualOrderToDeliveryOrder(order: ManualPlanningOrder): DeliveryOrder {
  const lineItemLines = order.lineItemSummary
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

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
    postcode: extractPostcode(order.address) || "Manual",
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
    lineItemLines: lineItemLines.length ? lineItemLines : [order.lineItemSummary].filter(Boolean),
    fulfilByDate: null,
    hasManualOverride: true,
    manualAddress: order.address,
    manualAddressNotes: "Manual order added from the planning map",
    orderSource: "manual",
  };
}

function addressLabel(order: DeliveryOrder) {
  if (order.orderSource === "return") {
    return "Return";
  }

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

function dateOnly(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function calendarDaysBetween(start: string | Date, end: string | Date) {
  const startDate = dateOnly(start);
  const endDate = dateOnly(end);

  if (!startDate || !endDate) {
    return null;
  }

  return Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
}

function formatOrderDate(value: string | null | undefined) {
  if (!value) {
    return "Date unavailable";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function fulfilmentHoverDot(fulfilByDate: string | null | undefined, fulfilmentWindowDays: number) {
  const daysLeft = fulfilByDate ? calendarDaysBetween(new Date(), fulfilByDate) : null;

  if (daysLeft === null) {
    return "⚪";
  }

  if (daysLeft <= 0) {
    return "🔴";
  }

  const ratio = daysLeft / Math.max(1, fulfilmentWindowDays);

  if (ratio > 0.66) {
    return "🟢";
  }

  if (ratio > 0.4) {
    return "🔵";
  }

  if (ratio > 0.2) {
    return "🟠";
  }

  return "🔴";
}

function orderItemLines(order: DeliveryOrder) {
  const itemLines = order.lineItemLines?.length
    ? order.lineItemLines
    : order.lineItemSummary
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

  return itemLines.length ? itemLines.map((item) => `• ${item}`) : ["Items not listed"];
}

function orderMapTooltip(order: DeliveryOrder, heading: string, fulfilmentWindowDays: number) {
  const isReturn = order.orderSource === "return";
  const fulfilmentDot = fulfilmentHoverDot(order.fulfilByDate, fulfilmentWindowDays);
  const tooltipLines = isReturn
    ? [
      `Return started: ${formatOrderDate(order.createdAt)}`,
      `Postcode: ${order.postcode || "No postcode"}`,
      "Items:",
      ...orderItemLines(order),
    ]
    : [
      `Ordered: ${formatOrderDate(order.createdAt)}`,
      `${fulfilmentDot} Fulfil by: ${formatOrderDate(order.fulfilByDate)}`,
      `Postcode: ${order.postcode || "No postcode"}`,
      "Items:",
      ...orderItemLines(order),
    ];

  return {
    tooltipTitle: heading,
    tooltipLines,
  };
}

function DeliveryMap({
  orders,
  selectedIds,
  routeStopIds,
  tomtomApiKey,
  startAddress,
  finishAddress,
  startLatitude,
  startLongitude,
  finishLatitude,
  finishLongitude,
  returnToBase,
  fulfilmentWindowDays,
  onToggleOrder,
}: {
  orders: DeliveryOrder[];
  selectedIds: Set<string>;
  routeStopIds: string[];
  tomtomApiKey: string;
  startAddress: string;
  finishAddress: string;
  startLatitude: number | null;
  startLongitude: number | null;
  finishLatitude: number | null;
  finishLongitude: number | null;
  returnToBase: boolean;
  fulfilmentWindowDays: number;
  onToggleOrder: (order: DeliveryOrder) => void;
}) {
  const ordersWithCoordinates = orders.filter(hasCoordinates);
  const ordersWithoutCoordinates = orders.filter((order) => !hasCoordinates(order));
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const routeStopSet = new Set(routeStopIds);
  const routePoints = routeStopIds
    .map((id) => ordersById.get(id))
    .filter((order): order is DeliveryOrder => Boolean(order) && hasCoordinates(order))
    .map((order, index) => {
      const isReturn = order.orderSource === "return";
      const heading = `${index + 1}. ${order.name} · ${order.customerName}`;

      return {
        id: order.id,
        label: String(index + 1),
        title: `${heading} · ${order.postcode || "No postcode"}`,
        latitude: order.latitude,
        longitude: order.longitude,
        selected: true,
        status: isReturn ? "FAILED" : undefined,
        ...orderMapTooltip(order, heading, fulfilmentWindowDays),
      };
    });
  const unselectedPoints = ordersWithCoordinates
    .filter((order) => !routeStopSet.has(order.id))
    .map((order) => {
      const isReturn = order.orderSource === "return";
      const heading = `${order.name} · ${order.customerName}`;

      return {
        id: order.id,
        label: order.name.replace("#", ""),
        title: `${heading} · ${order.postcode || "No postcode"}`,
        latitude: order.latitude,
        longitude: order.longitude,
        selected: selectedIds.has(order.id),
        status: isReturn ? "FAILED" : undefined,
        ...orderMapTooltip(order, heading, fulfilmentWindowDays),
      };
    });

  return (
    <BlockStack gap="300">
      <RouteMap
        title="Live planning map"
        badge={`${routeStopIds.length} selected`}
        apiKey={tomtomApiKey}
        points={[...routePoints, ...unselectedPoints]}
        showRouteLine={routePoints.length > 0}
        routeStart={{ address: startAddress, label: "START", latitude: startLatitude, longitude: startLongitude, status: "START" }}
        routeFinish={{ address: returnToBase ? startAddress : finishAddress || startAddress, label: "FINISH", latitude: returnToBase ? startLatitude : finishLatitude, longitude: returnToBase ? startLongitude : finishLongitude, status: "FINISH" }}
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
                <Text as="span" variant="bodySm">{order.name} · {order.customerName} · {order.postcode || "No postcode"}</Text>
                <Badge tone={order.orderSource === "return" ? "critical" : order.orderSource === "manual" ? "info" : "warning"}>{addressLabel(order)}</Badge>
              </InlineStack>
            ))}
          </BlockStack>
        </LegacyCard>
      ) : null}
    </BlockStack>
  );
}

function OptimiseRouteButton({ onClick, loading, disabled }: { onClick: () => void; loading: boolean; disabled: boolean }) {
  return (
    <Button onClick={onClick} loading={loading} disabled={disabled} variant="primary" tone="critical">
      <InlineStack gap="100" blockAlign="center" align="center">
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8.9 1.3 3.4 8.5h4.2L6.8 14.7l5.8-7.9H8.2l.7-5.5Z" />
        </svg>
        <span>Optimise selected route</span>
      </InlineStack>
    </Button>
  );
}

function StructuredAddressFields({
  address,
  onChange,
}: {
  address: StructuredAddress;
  onChange: (address: StructuredAddress) => void;
}) {
  const setField = (field: keyof StructuredAddress) => (value: string) => {
    onChange({ ...address, [field]: value });
  };

  return (
    <BlockStack gap="200">
      <TextField label="House number, unit or building name" value={address.building} onChange={setField("building")} autoComplete="off" />
      <TextField label="Street / address line 1" value={address.addressLine1} onChange={setField("addressLine1")} autoComplete="off" />
      <TextField label="Address line 2, optional" value={address.addressLine2} onChange={setField("addressLine2")} autoComplete="off" />
      <FormLayout.Group>
        <TextField label="Town / city" value={address.town} onChange={setField("town")} autoComplete="off" />
        <TextField label="County" value={address.county} onChange={setField("county")} autoComplete="off" />
      </FormLayout.Group>
      <FormLayout.Group>
        <TextField label="Postcode" value={address.postcode} onChange={setField("postcode")} autoComplete="off" />
        <TextField label="Country" value={address.country} onChange={setField("country")} autoComplete="off" />
      </FormLayout.Group>
    </BlockStack>
  );
}

function CollapsibleAddressEditor({
  title,
  address,
  onChange,
  summary,
}: {
  title: string;
  address: StructuredAddress;
  onChange: (address: StructuredAddress) => void;
  summary: string;
}) {
  return (
    <details style={{ border: "1px solid #d0d5dd", borderRadius: 12, padding: 12 }}>
      <summary style={{ cursor: "pointer", listStyle: "none" }}>
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="050">
            <Text as="h4" variant="headingSm">{title}</Text>
            <Text as="p" variant="bodySm" tone="subdued">{summary || "No address entered yet"}</Text>
          </BlockStack>
          <span style={{ border: "1px solid #c9cccf", borderRadius: 8, padding: "6px 10px", fontSize: 13, fontWeight: 700, color: "#323841" }}>Open</span>
        </InlineStack>
      </summary>
      <div style={{ marginTop: 12 }}>
        <StructuredAddressFields address={address} onChange={onChange} />
      </div>
    </details>
  );
}

export default function OrdersMap() {
  const { orders, drivers, addressLookupEnabled, routexlEnabled, defaults, tomtomApiKey } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const optimisationFetcher = useFetcher<PlanningOptimisationResult>();
  const [stops, setStops] = useState<Stop[]>([]);
  const [routeName, setRouteName] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [routeDate, setRouteDate] = useState(defaults.routeDate);
  const [plannedStartTime, setPlannedStartTime] = useState(defaults.plannedStartTime);
  const [timePerDropMinutes, setTimePerDropMinutes] = useState(String(defaults.timePerDropMinutes));
  const [customerSlotMinutes, setCustomerSlotMinutes] = useState(String(defaults.customerSlotMinutes));
  const [returnToBase, setReturnToBase] = useState(defaults.returnToBaseDefault);
  const [useCustomStartPoint, setUseCustomStartPoint] = useState(false);
  const [customStartAddress, setCustomStartAddress] = useState<StructuredAddress>(normaliseStructuredAddress(emptyStructuredAddress));
  const [customFinishAddress, setCustomFinishAddress] = useState<StructuredAddress>(normaliseStructuredAddress(emptyStructuredAddress));
  const [manualOrders, setManualOrders] = useState<ManualPlanningOrder[]>([]);
  const [manualCustomerName, setManualCustomerName] = useState("");
  const [manualAddress, setManualAddress] = useState<StructuredAddress>(normaliseStructuredAddress(emptyStructuredAddress));
  const [manualEmail, setManualEmail] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualItems, setManualItems] = useState("");
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null);
  const [routeFinishEta, setRouteFinishEta] = useState<string | null>(null);

  const defaultStartAddress = defaults.startAddress;
  const defaultStartLatitude = typeof defaults.startLatitude === "number" ? defaults.startLatitude : null;
  const defaultStartLongitude = typeof defaults.startLongitude === "number" ? defaults.startLongitude : null;
  const fulfilmentWindowDays = Number(defaults.fulfilmentWindowDays) || fallbackRoutePlanningSettings.fulfilmentWindowDays;
  const customStartSummary = formatStructuredAddress(customStartAddress);
  const customFinishSummary = formatStructuredAddress(customFinishAddress);
  const startAddress = useCustomStartPoint && customStartSummary ? customStartSummary : defaultStartAddress;
  const startLatitude = useCustomStartPoint ? null : defaultStartLatitude;
  const startLongitude = useCustomStartPoint ? null : defaultStartLongitude;
  const finishAddress = returnToBase ? startAddress : customFinishSummary;
  const finishLatitude = returnToBase ? startLatitude : null;
  const finishLongitude = returnToBase ? startLongitude : null;

  const driverOptions = useMemo(() => [
    { label: "Select driver later", value: "" },
    ...drivers.map((driver) => ({ label: driver.name, value: driver.id })),
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
      .map((stop) => ({ ...stop, eta: etaById.get(stop.id) || stop.eta }));
    const missingStops = stops.filter((stop) => !optimisationFetcher.data?.ok || !optimisationFetcher.data.orderedIds.includes(stop.id));

    setStops([...orderedStops, ...missingStops]);
    setRouteDistanceKm(optimisationFetcher.data.totalDistanceKm);
    setRouteFinishEta(optimisationFetcher.data.routeFinishEta);
  }, [optimisationFetcher.data]);

  useEffect(() => {
    setStops((currentStops) => refreshStopEtas(currentStops, plannedStartTime, timePerDropMinutes));
  }, [plannedStartTime, timePerDropMinutes]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const clearOptimisedStats = () => {
    setRouteDistanceKm(null);
    setRouteFinishEta(null);
  };

  const resetTransientAddressFields = () => {
    setUseCustomStartPoint(false);
    setCustomStartAddress(normaliseStructuredAddress(emptyStructuredAddress));
    setCustomFinishAddress(normaliseStructuredAddress(emptyStructuredAddress));
    setManualAddress(normaliseStructuredAddress(emptyStructuredAddress));
    setReturnToBase(defaults.returnToBaseDefault);
  };

  useEffect(() => {
    resetTransientAddressFields();

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        resetTransientAddressFields();
      }
    };

    window.addEventListener("pageshow", handlePageShow);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

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

  const appendEndpointFields = (formData: FormData) => {
    formData.set("startAddress", startAddress);
    formData.set("finishAddress", returnToBase ? startAddress : finishAddress);
    formData.set("startLatitude", startLatitude === null ? "" : String(startLatitude));
    formData.set("startLongitude", startLongitude === null ? "" : String(startLongitude));
    formData.set("finishLatitude", returnToBase ? (startLatitude === null ? "" : String(startLatitude)) : (finishLatitude === null ? "" : String(finishLatitude)));
    formData.set("finishLongitude", returnToBase ? (startLongitude === null ? "" : String(startLongitude)) : (finishLongitude === null ? "" : String(finishLongitude)));
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
    formData.set("returnToBase", returnToBase ? "true" : "false");
    appendEndpointFields(formData);

    optimisationFetcher.submit(formData, { method: "post" });
  };

  const addManualOrder = () => {
    const customerName = manualCustomerName.trim();
    const address = formatStructuredAddress(manualAddress);
    const lineItemSummary = manualItems.trim();

    if (!customerName || !isStructuredAddressReady(manualAddress) || !address || !lineItemSummary) {
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
    setManualAddress(normaliseStructuredAddress(emptyStructuredAddress));
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
    <Page title="Planning Map" fullWidth>
      <Layout>
        <Layout.Section>
          <LegacyCard>
            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  {!addressLookupEnabled ? (
                    <Text as="p" variant="bodySm" tone="critical">
                      Address lookup credentials are not set up. Add them in Settings before testing new manual or custom addresses.
                    </Text>
                  ) : null}

                  {!routexlEnabled ? (
                    <Text as="p" variant="bodySm" tone="critical">
                      RouteXL is not enabled yet. Add RouteXL credentials before using live planning optimisation.
                    </Text>
                  ) : null}

                  {actionData && "error" in actionData ? (
                    <Text as="p" variant="bodySm" tone="critical">
                      {actionData.error}
                    </Text>
                  ) : null}
                </BlockStack>

                <Badge tone="info">{allOrders.length} orders</Badge>
              </InlineStack>
            </Box>

            <Box minHeight="420px" background="bg-surface-secondary" padding="400">
              {allOrders.length === 0 ? (
                <EmptyState heading="No matching delivery or return stops found" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
                  <p>No stops matched the current planning filters.</p>
                </EmptyState>
              ) : (
                <DeliveryMap
                  orders={allOrders}
                  selectedIds={selectedIds}
                  routeStopIds={stops.map((stop) => stop.id)}
                  startAddress={startAddress}
                  finishAddress={finishAddress}
                  startLatitude={startLatitude}
                  startLongitude={startLongitude}
                  finishLatitude={finishLatitude}
                  finishLongitude={finishLongitude}
                  returnToBase={returnToBase}
                  fulfilmentWindowDays={fulfilmentWindowDays}
                  onToggleOrder={toggleOrder}
                  tomtomApiKey={tomtomApiKey}
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
                    <Text as="span" variant="bodySm">
                      Stops: {stops.length}
                    </Text>

                    <Text as="span" variant="bodySm">
                      Miles: {routeDistanceKm === null ? "Pending" : `${(routeDistanceKm * 0.621371).toFixed(1)} mi`}
                    </Text>
                  </InlineStack>

                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodySm">
                      Finish ETA: {routeFinishEta || "Pending"}
                    </Text>

                    {routeDistanceKm === null ? (
                      <span
                        style={{
                          background: "#f2f4f7",
                          border: "1px solid #d0d5dd",
                          borderRadius: 999,
                          color: "#344054",
                          display: "inline-flex",
                          fontSize: 13,
                          fontWeight: 700,
                          lineHeight: "18px",
                          padding: "2px 8px",
                        }}
                      >
                        Not optimised
                      </span>
                    ) : (
                      <span
                        style={{
                          alignItems: "center",
                          background: "#c8102e",
                          border: "1px solid rgba(120, 0, 0, 0.35)",
                          borderRadius: 999,
                          boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.25)",
                          color: "#ffffff",
                          display: "inline-flex",
                          fontSize: 13,
                          fontWeight: 800,
                          gap: 6,
                          lineHeight: "18px",
                          padding: "3px 10px",
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            color: "#ffffff",
                            display: "inline-block",
                            fontWeight: 900,
                            lineHeight: "18px",
                          }}
                        >
                          ⚡︎
                        </span>
                        <span>Optimised</span>
                      </span>
                    )}
                  </InlineStack>

                  {selectedDriver ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      Driver selected: {selectedDriver.name}
                    </Text>
                  ) : null}

                  {optimisationError ? (
                    <Text as="p" variant="bodySm" tone="critical">
                      {optimisationError}
                    </Text>
                  ) : null}
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Route planning</Text>
                  <TextField label="Route date" type="date" value={routeDate} onChange={setRouteDate} autoComplete="off" />
                  <Select label="Driver" options={driverOptions} value={selectedDriverId} onChange={setSelectedDriverId} />
                  {!drivers.length ? <Text as="p" variant="bodySm" tone="subdued">No active drivers yet. Add one in Driver profiles first.</Text> : null}
                  <TextField label="Driver start time" type="time" value={plannedStartTime} onChange={(value) => { setPlannedStartTime(value); clearOptimisedStats(); }} autoComplete="off" />
                  <TextField label="Minutes per drop" type="number" value={timePerDropMinutes} onChange={(value) => { setTimePerDropMinutes(value); clearOptimisedStats(); }} autoComplete="off" />
                  <TextField label="Customer slot minutes" type="number" value={customerSlotMinutes} onChange={setCustomerSlotMinutes} autoComplete="off" />

                  <Box background="bg-surface-secondary" padding="300" borderRadius="300">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="bold">Default start point</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{defaultStartAddress}</Text>
                    </BlockStack>
                  </Box>

                  <Checkbox label="Use custom start point" checked={useCustomStartPoint} onChange={(checked) => { setUseCustomStartPoint(checked); clearOptimisedStats(); }} />
                  {useCustomStartPoint ? <CollapsibleAddressEditor title="Custom start point" address={customStartAddress} onChange={(value) => { setCustomStartAddress(value); clearOptimisedStats(); }} summary={customStartSummary} /> : null}

                  <Checkbox label="Return to base after last drop" checked={returnToBase} onChange={(checked) => { setReturnToBase(checked); clearOptimisedStats(); }} />
                  {!returnToBase ? <CollapsibleAddressEditor title="Custom finish location" address={customFinishAddress} onChange={(value) => { setCustomFinishAddress(value); clearOptimisedStats(); }} summary={customFinishSummary} /> : null}
                  <OptimiseRouteButton onClick={optimisePlanningRoute} loading={optimisationRunning} disabled={!routexlEnabled || stops.length === 0} />
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
                      <CollapsibleAddressEditor title="Manual delivery address" address={manualAddress} onChange={setManualAddress} summary={formatStructuredAddress(manualAddress)} />
                      <TextField label="Email" type="email" value={manualEmail} onChange={setManualEmail} autoComplete="off" />
                      <TextField label="Phone" value={manualPhone} onChange={setManualPhone} autoComplete="off" />
                      <TextField label="What they ordered" value={manualItems} onChange={setManualItems} autoComplete="off" multiline={2} />
                      <Button onClick={addManualOrder} disabled={!manualCustomerName.trim() || !isStructuredAddressReady(manualAddress) || !manualItems.trim()}>Add manual order to route</Button>
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

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={stops} strategy={verticalListSortingStrategy}>
                {stops.map((stop) => <SortableStop key={stop.id} stop={stop} onRemove={removeStop} onToggleLock={toggleLock} />)}
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
                <input type="hidden" name="startLatitude" value={startLatitude === null ? "" : String(startLatitude)} />
                <input type="hidden" name="startLongitude" value={startLongitude === null ? "" : String(startLongitude)} />
                <input type="hidden" name="finishLatitude" value={returnToBase ? (startLatitude === null ? "" : String(startLatitude)) : (finishLatitude === null ? "" : String(finishLatitude))} />
                <input type="hidden" name="finishLongitude" value={returnToBase ? (startLongitude === null ? "" : String(startLongitude)) : (finishLongitude === null ? "" : String(finishLongitude))} />
                <input type="hidden" name="returnToBase" value={returnToBase ? "true" : "false"} />
                <BlockStack gap="300">
                  <TextField label="Draft route name, optional" name="routeName" value={routeName} onChange={setRouteName} autoComplete="off" placeholder="Example, Chris, North Route" />
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
