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

import { RouteMap } from "../components/RouteMap";
import { createRouteDraft, defaultRoutePlanningSettings } from "../lib/routeDrafts.server";
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const orders = await getDeliveryOrders(admin);

  return json({
    orders,
    addressLookupEnabled: Boolean(process.env.GETADDRESS_API_KEY),
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
  const manualOrders = parseManualOrders(formData.get("manualOrdersJson"));
  const selectedOrderIds = String(formData.get("selectedOrderIds") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (!selectedOrderIds.length) {
    return json({ ok: false, error: "Select at least one order before saving a draft route." }, { status: 400 });
  }

  const [shopifyOrders, manualDeliveryOrders] = await Promise.all([
    getDeliveryOrders(admin),
    Promise.all(manualOrders.map((order) => toManualDeliveryOrder(order))),
  ]);
  const ordersById = new Map([...shopifyOrders, ...manualDeliveryOrders].map((order) => [order.id, order]));
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

function DeliveryMap({ orders, selectedIds, onToggleOrder }: { orders: DeliveryOrder[]; selectedIds: Set<string>; onToggleOrder: (order: DeliveryOrder) => void }) {
  const ordersWithCoordinates = orders.filter(hasCoordinates);
  const ordersWithoutCoordinates = orders.filter((order) => !hasCoordinates(order));
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const mapPoints = ordersWithCoordinates.map((order) => ({
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
        title="Delivery planning map"
        badge={`${ordersWithCoordinates.length} pins`}
        points={mapPoints}
        showRouteLine={false}
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
  const [manualOrders, setManualOrders] = useState<ManualPlanningOrder[]>([]);
  const [manualCustomerName, setManualCustomerName] = useState("");
  const [manualAddress, setManualAddress] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [manualItems, setManualItems] = useState("");

  const manualDeliveryOrders = useMemo(() => manualOrders.map(manualOrderToDeliveryOrder), [manualOrders]);
  const allOrders = useMemo(() => [...orders, ...manualDeliveryOrders], [orders, manualDeliveryOrders]);
  const selectedIds = useMemo(() => new Set(stops.map((stop) => stop.id)), [stops]);
  const selectedOrderIds = stops.map((stop) => stop.id).join(",");
  const manualOrdersJson = JSON.stringify(manualOrders);

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
    if (!hasCoordinates(order) && order.orderSource !== "manual") {
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
    setStops((currentStops) => [...currentStops, deliveryOrderToStop(deliveryOrder, currentStops.length + 1, plannedStartTime, timePerDropMinutes)]);
    setManualCustomerName("");
    setManualAddress("");
    setManualEmail("");
    setManualPhone("");
    setManualItems("");
  };

  const removeManualOrder = (id: string) => {
    setManualOrders((currentOrders) => currentOrders.filter((order) => order.id !== id));
    setStops((currentStops) => currentStops.filter((stop) => stop.id !== id));
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
                    Showing Rapid Delivery, Free Rapid Delivery and Local Delivery orders from the last 7 working days. Manual orders can be added on this screen too.
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
                <DeliveryMap orders={allOrders} selectedIds={selectedIds} onToggleOrder={toggleOrder} />
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

            <Box padding="300" borderBlockEndWidth="025" borderColor="border">
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Add manual order</Text>
                <TextField label="Customer name" value={manualCustomerName} onChange={setManualCustomerName} autoComplete="off" />
                <TextField label="Address" value={manualAddress} onChange={setManualAddress} autoComplete="off" multiline={2} />
                <TextField label="Email" type="email" value={manualEmail} onChange={setManualEmail} autoComplete="off" />
                <TextField label="Phone" value={manualPhone} onChange={setManualPhone} autoComplete="off" />
                <TextField label="What they ordered" value={manualItems} onChange={setManualItems} autoComplete="off" multiline={2} />
                <Button onClick={addManualOrder} disabled={!manualCustomerName.trim() || !manualAddress.trim() || !manualItems.trim()}>Add manual order to route</Button>
                {manualOrders.length ? (
                  <BlockStack gap="100">
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
                <input type="hidden" name="selectedOrderIds" value={selectedOrderIds} />
                <input type="hidden" name="manualOrdersJson" value={manualOrdersJson} />
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
