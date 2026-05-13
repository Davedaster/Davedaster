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
} from "@shopify/polaris";
import { LockIcon, DeleteIcon, DragHandleIcon } from "@shopify/polaris-icons";
import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Stop {
  id: string;
  orderNumber: string;
  customerName: string;
  postcode: string;
  eta: string;
  isLocked: boolean;
}

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
                #{stop.orderNumber} - {stop.customerName}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {stop.postcode} • ETA: {stop.eta}
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

export default function OrdersMap() {
  const [stops, setStops] = useState<Stop[]>([
    { id: "1", orderNumber: "1001", customerName: "John Doe", postcode: "TQ12 2SN", eta: "09:00", isLocked: false },
    { id: "2", orderNumber: "1002", customerName: "Jane Smith", postcode: "EX1 1AA", eta: "09:45", isLocked: false },
    { id: "3", orderNumber: "1003", customerName: "Bob Brown", postcode: "PL1 1BB", eta: "10:30", isLocked: true },
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      setStops((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);

        return arrayMove(items, oldIndex, newIndex);
      });
    }
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
            <Box
              minHeight="600px"
              background="bg-surface-secondary"
              padding="0"
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "600px" }}>
                <BlockStack align="center" gap="200">
                  <Text as="p" variant="bodyLg" tone="subdued">UK Map Placeholder</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">Interactive map with pins will be implemented here.</Text>
                </BlockStack>
              </div>
            </Box>
          </LegacyCard>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <LegacyCard title="Current Route" actions={[{ content: "Optimise", onAction: () => {} }]}>
            <Box padding="300" borderBlockEndWidth="025" borderColor="border">
              <BlockStack gap="100">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">Stops: {stops.length}</Text>
                  <Text as="span" variant="bodySm">Mileage: 45 miles</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodySm">Time: 2h 15m</Text>
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
              <Button fullWidth variant="primary">Save Draft Route</Button>
            </Box>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
