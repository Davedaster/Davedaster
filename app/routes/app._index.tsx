import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
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
  ResourceList,
  ResourceItem,
  EmptyState,
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const orders = await getDeliveryOrders(admin);

  return json({ orders, addressLookupEnabled: Boolean(process.env.GETADDRESS_API_KEY) });
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

function deliveryOrderToStop(order: DeliveryOrder, stopNumber: number): Stop {
  return {
    id: order.id,
    orderNumber: order.name,
    customerName: order.customerName,
    postcode: order.postcode || "",
    eta: `${String(5 + stopNumber).padStart(2, "0")}:00`,
    isLocked: false,
  };
}

function addressTone(status: DeliveryOrder["addressStatus"], confidence: DeliveryOrder["addressConfidence"]) {
  if (status === "READY" && confidence === "HIGH") {
    return "success" as const;
  }

  return "warning" as const;
}

function addressLabel(order: DeliveryOrder) {
  if (order.addressStatus === "NEEDS_ADDRESS") {
    return "Needs address";
  }

  if (order.addressStatus === "NEEDS_LOCATION_CHECK") {
    return "Needs location check";
  }

  return order.addressConfidence === "HIGH" ? "Location ready" : "Ready";
}

export default function OrdersMap() {
  const { orders, addressLookupEnabled } = useLoaderData<typeof loader>();
  const [stops, setStops] = useState<Stop[]>([]);

  const selectedIds = useMemo(() => new Set(stops.map((stop) => stop.id)), [stops]);

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
    setStops((currentStops) => {
      if (currentStops.some((stop) => stop.id === order.id)) {
        return currentStops.filter((stop) => stop.id !== order.id);
      }

      return [...currentStops, deliveryOrderToStop(order, currentStops.length + 1)];
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
                </BlockStack>
                <Badge tone="info">{orders.length} orders</Badge>
              </InlineStack>
            </Box>

            <Box minHeight="420px" background="bg-surface-secondary" padding="400">
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Map pins will use the latitude and longitude shown below when the real map component is added.
                </Text>

                {orders.length === 0 ? (
                  <EmptyState
                    heading="No matching delivery orders found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>No orders matched the current delivery filters.</p>
                  </EmptyState>
                ) : (
                  <ResourceList
                    resourceName={{ singular: "order", plural: "orders" }}
                    items={orders}
                    renderItem={(order) => {
                      const selected = selectedIds.has(order.id);
                      const coordinates = order.latitude && order.longitude
                        ? `${order.latitude.toFixed(5)}, ${order.longitude.toFixed(5)}`
                        : "No coordinates yet";

                      return (
                        <ResourceItem
                          id={order.id}
                          accessibilityLabel={`Select ${order.name}`}
                          onClick={() => toggleOrder(order)}
                        >
                          <Box
                            padding="300"
                            borderColor={selected ? "border-info" : "border"}
                            borderWidth="025"
                            borderRadius="200"
                            background={selected ? "bg-surface-info" : "bg-surface"}
                          >
                            <InlineStack align="space-between">
                              <BlockStack gap="050">
                                <Text as="h3" variant="bodyMd" fontWeight="bold">
                                  {order.name} · {order.customerName}
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {order.postcode || "No postcode"} · {order.shippingMethod || "No shipping method"}
                                </Text>
                                <Text as="p" variant="bodySm" tone="subdued">
                                  Shopify address: {order.addressSummary}
                                </Text>
                                {order.formattedAddress ? (
                                  <Text as="p" variant="bodySm" tone="subdued">
                                    Matched address: {order.formattedAddress}
                                  </Text>
                                ) : null}
                                <Text as="p" variant="bodySm" tone="subdued">
                                  Coordinates: {coordinates}
                                </Text>
                              </BlockStack>
                              <BlockStack gap="100" align="end">
                                <Badge tone={addressTone(order.addressStatus, order.addressConfidence)}>
                                  {addressLabel(order)}
                                </Badge>
                                {selected ? <Badge tone="info">Selected</Badge> : null}
                              </BlockStack>
                            </InlineStack>
                          </Box>
                        </ResourceItem>
                      );
                    }}
                  />
                )}
              </BlockStack>
            </Box>
          </LegacyCard>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <LegacyCard title="Current Route" actions={[{ content: "Optimise", onAction: () => {} }]}>
            <Box padding="300" borderBlockEndWidth="025" borderColor="border">
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
              <Button fullWidth variant="primary" disabled={stops.length === 0}>Save Draft Route</Button>
            </Box>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
