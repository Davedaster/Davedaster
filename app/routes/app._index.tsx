import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
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
} from "@shopify/polaris";
import { LockIcon, DeleteIcon, DragHandleIcon } from "@shopify/polaris-icons";
import { useMemo, useState } from "react";
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

import { createRouteDraft, defaultRoutePlanningSettings } from "../lib/routeDrafts.server";
import { authenticate } from "../shopify.server";
import { getDeliveryOrders, type DeliveryOrder } from "../lib/shopifyOrders.server";

interface Stop {
  id: string;
  orderNumber: string;
  customerName: string;
  postcode: string;
  eta: string;
  isLocked: boolean;
}

const UK_BOUNDS = {
  north: 58.8,
  south: 49.8,
  west: -8.7,
  east: 1.9,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const orders = await getDeliveryOrders(admin);

  return json({
    orders,
    addressLookupEnabled: Boolean(process.env.GETADDRESS_API_KEY),
    defaults: defaultRoutePlanningSettings,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const routeName = String(formData.get("routeName") || "").trim();
  const routeDate = String(formData.get("routeDate") || "").trim();
  const plannedStartTime = String(formData.get("plannedStartTime") || "").trim();
  const timePerDropMinutes = Number(formData.get("timePerDropMinutes") || defaultRoutePlanningSettings.timePerDropMinutes);
  const customerSlotMinutes = Number(formData.get("customerSlotMinutes") || defaultRoutePlanningSettings.customerSlotMinutes);
  const startAddress = String(formData.get("startAddress") || "").trim();
  const finishAddress = String(formData.get("finishAddress") || "").trim();
  const selectedOrderIds = String(formData.get("selectedOrderIds") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!selectedOrderIds.length) {
    return json({ ok: false, error: "Select at least one order before saving a draft route." }, { status: 400 });
  }

  const orders = await getDeliveryOrders(admin);
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const selectedOrders = selectedOrderIds
    .map((id) => ordersById.get(id))
    .filter((order): order is DeliveryOrder => Boolean(order));

  if (!selectedOrders.length) {
    return json({ ok: false, error: "Selected orders could not be found." }, { status: 400 });
  }

  await createRouteDraft({
    orders: selectedOrders,
    routeName,
    routeDate,
    plannedStartTime,
    timePerDropMinutes,
    customerSlotMinutes,
    startAddress,
    finishAddress,
  });

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

function deliveryOrderToStop(order: DeliveryOrder, stopNumber: number, plannedStartTime: string, timePerDropMinutes: string): Stop {
  const [hours, minutes = "0"] = plannedStartTime.split(":");
  const startMinutes = Number(hours) * 60 + Number(minutes);
  const dropMinutes = Number(timePerDropMinutes) || defaultRoutePlanningSettings.timePerDropMinutes;
  const etaMinutes = startMinutes + ((stopNumber - 1) * dropMinutes);
  const etaHours = Math.floor(etaMinutes / 60) % 24;
  const etaMinuteValue = etaMinutes % 60;

  return {
    id: order.id,
    orderNumber: order.name,
    customerName: order.customerName,
    postcode: order.postcode || "",
    eta: `${String(etaHours).padStart(2, "0")}:${String(etaMinuteValue).padStart(2, "0")}`,
    isLocked: false,
  };
}

function addressLabel(order: DeliveryOrder) {
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

function getPinPosition(order: DeliveryOrder) {
  if (!hasCoordinates(order)) {
    return null;
  }

  const latitude = order.latitude as number;
  const longitude = order.longitude as number;
  const x = ((longitude - UK_BOUNDS.west) / (UK_BOUNDS.east - UK_BOUNDS.west)) * 100;
  const y = ((UK_BOUNDS.north - latitude) / (UK_BOUNDS.north - UK_BOUNDS.south)) * 100;

  return {
    left: `${Math.max(2, Math.min(98, x))}%`,
    top: `${Math.max(2, Math.min(98, y))}%`,
  };
}

function MapPin({ order, selected, onClick }: { order: DeliveryOrder; selected: boolean; onClick: () => void }) {
  const position = getPinPosition(order);

  if (!position) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Select ${order.name}`}
      title={`${order.name} · ${order.customerName} · ${order.postcode || "No postcode"}`}
      style={{
        position: "absolute",
        left: position.left,
        top: position.top,
        transform: "translate(-50%, -100%)",
        border: 0,
        background: "transparent",
        cursor: "pointer",
        padding: 0,
        zIndex: selected ? 3 : 2,
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          width: selected ? 34 : 28,
          height: selected ? 34 : 28,
          borderRadius: "50% 50% 50% 0",
          transform: "rotate(-45deg)",
          background: selected ? "#323841" : "#509AE6",
          boxShadow: selected ? "0 0 0 4px rgba(80,154,230,0.22)" : "0 2px 8px rgba(0,0,0,0.25)",
          border: "2px solid #ffffff",
        }}
      >
        <span
          style={{
            transform: "rotate(45deg)",
            color: "#ffffff",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {order.name.replace("#", "")}
        </span>
      </span>
    </button>
  );
}

function DeliveryMap({ orders, selectedIds, onToggleOrder }: { orders: DeliveryOrder[]; selectedIds: Set<string>; onToggleOrder: (order: DeliveryOrder) => void }) {
  const ordersWithCoordinates = orders.filter(hasCoordinates);
  const ordersWithoutCoordinates = orders.filter((order) => !hasCoordinates(order));

  return (
    <BlockStack gap="300">
      <div
        style={{
          position: "relative",
          minHeight: 520,
          overflow: "hidden",
          borderRadius: 16,
          border: "1px solid #d0d5dd",
          background:
            "linear-gradient(180deg, #e8f3ff 0%, #d6ecff 100%)",
        }}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        >
          <path d="M52 4 C42 10 39 22 41 32 C31 36 30 50 37 59 C29 65 31 79 41 84 C52 90 66 84 68 72 C78 66 78 51 69 44 C72 31 66 15 52 4 Z" fill="#eef7ef" stroke="#b7d7c2" strokeWidth="1" />
          <path d="M46 54 C38 59 38 72 47 76 C56 80 65 74 64 64 C63 55 54 50 46 54 Z" fill="#e5f4e9" stroke="#b7d7c2" strokeWidth="0.8" />
          <path d="M43 78 C36 81 33 90 40 94 C48 98 57 93 55 85 C54 79 49 76 43 78 Z" fill="#e5f4e9" stroke="#b7d7c2" strokeWidth="0.8" />
        </svg>

        <div style={{ position: "absolute", inset: 16 }}>
          <InlineStack align="space-between">
            <Badge tone="info">UK map view</Badge>
            <Badge tone="success">{ordersWithCoordinates.length} pins</Badge>
          </InlineStack>
        </div>

        {ordersWithCoordinates.map((order) => (
          <MapPin
            key={order.id}
            order={order}
            selected={selectedIds.has(order.id)}
            onClick={() => onToggleOrder(order)}
          />
        ))}
      </div>

      {ordersWithoutCoordinates.length ? (
        <LegacyCard sectioned>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">Needs location check before a pin can be shown</Text>
            {ordersWithoutCoordinates.map((order) => (
              <InlineStack key={order.id} align="space-between">
                <Text as="span" variant="bodySm">
                  {order.name} · {order.customerName} · {order.postcode || "No postcode"}
                </Text>
                <Badge tone="warning">{addressLabel(order)}</Badge>
              </InlineStack>
            ))}
          </BlockStack>
        </LegacyCard>
      ) : null}
    </BlockStack>
  );
}

export default function OrdersMap() {
  const { orders, addressLookupEnabled, defaults } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [stops, setStops] = useState<Stop[]>([]);
  const [routeName, setRouteName] = useState("");
  const [routeDate, setRouteDate] = useState(defaults.routeDate);
  const [plannedStartTime, setPlannedStartTime] = useState(defaults.plannedStartTime);
  const [timePerDropMinutes, setTimePerDropMinutes] = useState(String(defaults.timePerDropMinutes));
  const [customerSlotMinutes, setCustomerSlotMinutes] = useState(String(defaults.customerSlotMinutes));
  const [startAddress, setStartAddress] = useState(defaults.startAddress);
  const [finishAddress, setFinishAddress] = useState(defaults.finishAddress);

  const selectedIds = useMemo(() => new Set(stops.map((stop) => stop.id)), [stops]);
  const selectedOrderIds = stops.map((stop) => stop.id).join(",");

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setStops((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);

        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const toggleOrder = (order: DeliveryOrder) => {
    if (!hasCoordinates(order)) {
      return;
    }

    setStops((currentStops) => {
      if (currentStops.some((stop) => stop.id === order.id)) {
        return currentStops.filter((stop) => stop.id !== order.id);
      }

      return [...currentStops, deliveryOrderToStop(order, currentStops.length + 1, plannedStartTime, timePerDropMinutes)];
    });
  };

  const removeStop = (id: string) => {
    setStops(stops.filter((s) => s.id !== id));
  };

  const toggleLock = (id: string) => {
    setStops(stops.map((s) => s.id === id ? { ...s, isLocked: !s.isLocked } : s));
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
                    Showing Rapid Delivery, Free Rapid Delivery and Local Delivery orders from the last 7 working days.
                  </Text>
                  {!addressLookupEnabled ? (
                    <Text as="p" variant="bodySm" tone="critical">
                      getAddress.io lookup is not enabled yet. Add GETADDRESS_API_KEY to the app environment before testing live coordinates.
                    </Text>
                  ) : null}
                  {actionData && "error" in actionData ? (
                    <Text as="p" variant="bodySm" tone="critical">{actionData.error}</Text>
                  ) : null}
                </BlockStack>
                <Badge tone="info">{orders.length} orders</Badge>
              </InlineStack>
            </Box>

            <Box minHeight="420px" background="bg-surface-secondary" padding="400">
              {orders.length === 0 ? (
                <EmptyState
                  heading="No matching delivery orders found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>No orders matched the current delivery filters.</p>
                </EmptyState>
              ) : (
                <DeliveryMap orders={orders} selectedIds={selectedIds} onToggleOrder={toggleOrder} />
              )}
            </Box>
          </LegacyCard>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <LegacyCard title="Current Route" actions={[{ content: "Optimise", onAction: () => {} }]}>
            <Box padding="300" borderBlockEndWidth="025" borderColor="border">
              <BlockStack gap="300">
                <BlockStack gap="100">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">Stops: {stops.length}</Text>
                    <Text as="span" variant="bodySm">Mileage: pending</Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">Time: pending</Text>
                    <Badge tone="info">Draft</Badge>
                  </InlineStack>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Route planning</Text>
                  <TextField label="Route date" type="date" value={routeDate} onChange={setRouteDate} autoComplete="off" />
                  <TextField label="Driver start time" type="time" value={plannedStartTime} onChange={setPlannedStartTime} autoComplete="off" />
                  <TextField label="Minutes per drop" type="number" value={timePerDropMinutes} onChange={setTimePerDropMinutes} autoComplete="off" />
                  <TextField label="Customer slot minutes" type="number" value={customerSlotMinutes} onChange={setCustomerSlotMinutes} autoComplete="off" />
                  <TextField label="Driver start location" value={startAddress} onChange={setStartAddress} autoComplete="off" multiline={2} />
                  <TextField label="Driver finish location" value={finishAddress} onChange={setFinishAddress} autoComplete="off" multiline={2} />
                </BlockStack>
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
                <input type="hidden" name="selectedOrderIds" value={selectedOrderIds} />
                <input type="hidden" name="routeDate" value={routeDate} />
                <input type="hidden" name="plannedStartTime" value={plannedStartTime} />
                <input type="hidden" name="timePerDropMinutes" value={timePerDropMinutes} />
                <input type="hidden" name="customerSlotMinutes" value={customerSlotMinutes} />
                <input type="hidden" name="startAddress" value={startAddress} />
                <input type="hidden" name="finishAddress" value={finishAddress} />
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
