import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  BlockStack,
  Text,
  TextField,
  Button,
  DataTable,
  InlineStack,
  Badge,
  Box,
  Select,
} from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { assignReturnTicketToDraftRoute, listDraftRoutesForReturnAssignment, searchReturnTickets } from "../lib/returns.server";
import { createReturnCollectionFromShopifyOrder, findShopifyOrderForReturn } from "../lib/returnCollections.server";
import { calculateEtaSlots } from "../lib/routeDrafts.server";

type ReturnLineInput = {
  itemName: string;
  quantityExpected: number;
};

type ReturnTicketForRows = Awaited<ReturnType<typeof searchReturnTickets>>[number];
type DraftRouteForAssignment = Awaited<ReturnType<typeof listDraftRoutesForReturnAssignment>>[number];

const ARCHIVE_STATUSES = new Set(["COLLECTED", "COULD_NOT_COLLECT", "CANCELLED"]);
const DELETABLE_RETURN_STATUSES = new Set(["OPEN", "ASSIGNED", "OUT_FOR_COLLECTION"]);

function parseSelectedLines(value: FormDataEntryValue | null): ReturnLineInput[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as ReturnLineInput[];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((line) => ({
        itemName: String(line.itemName || "").trim(),
        quantityExpected: Math.max(1, Math.round(Number(line.quantityExpected) || 1)),
      }))
      .filter((line) => line.itemName && line.quantityExpected > 0);
  } catch {
    return [];
  }
}

function clampReturnQuantity(value: number, max: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(0, Math.round(value)), Math.max(0, max));
}

async function cancelReturnTicket(ticketId: string) {
  if (!ticketId) {
    throw new Error("Return collection not found.");
  }

  const ticket = await prisma.returnTicket.findUnique({
    where: {
      id: ticketId,
    },
    include: {
      route: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
      stop: {
        include: {
          deliveryGroup: {
            include: {
              orders: true,
            },
          },
          returnTickets: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!ticket) {
    throw new Error("Return collection not found.");
  }

  if (!DELETABLE_RETURN_STATUSES.has(ticket.status)) {
    throw new Error("Only active returns can be deleted.");
  }

  const routeId = ticket.routeId;
  const stopId = ticket.stopId;
  const stopOrderIndex = ticket.stop?.orderIndex ?? null;
  const deliveryGroupId = ticket.stop?.deliveryGroupId ?? null;
  const deliveryGroupOrders = ticket.stop?.deliveryGroup?.orders || [];
  const returnOrderId = `return:${ticket.id}`;
  const matchingReturnOrderIds = deliveryGroupOrders
    .filter((order) => order.shopifyOrderId === returnOrderId)
    .map((order) => order.id);
  const deliveryGroupOnlyContainsThisReturn = deliveryGroupOrders.length === 0 || deliveryGroupOrders.every((order) => order.shopifyOrderId === returnOrderId);
  const otherReturnTicketsOnStop = ticket.stop?.returnTickets.filter((item) => item.id !== ticket.id && item.status !== "CANCELLED") || [];
  const shouldDeleteRouteStop = Boolean(
    stopId &&
    deliveryGroupId &&
    deliveryGroupOnlyContainsThisReturn &&
    otherReturnTicketsOnStop.length === 0,
  );

  await prisma.$transaction(async (tx) => {
    await tx.returnTicket.update({
      where: {
        id: ticket.id,
      },
      data: {
        status: "CANCELLED",
        routeId: null,
        stopId: null,
      },
    });

    if (shouldDeleteRouteStop && deliveryGroupId) {
      await tx.orderStop.deleteMany({
        where: {
          deliveryGroupId,
        },
      });

      await tx.proofPhoto.deleteMany({
        where: {
          deliveryGroupId,
        },
      });
    } else if (matchingReturnOrderIds.length) {
      await tx.orderStop.deleteMany({
        where: {
          id: {
            in: matchingReturnOrderIds,
          },
        },
      });
    }

    if (shouldDeleteRouteStop) {
      await tx.stop.delete({
        where: {
          id: stopId!,
        },
      });

      await tx.deliveryGroup.delete({
        where: {
          id: deliveryGroupId!,
        },
      });

      if (routeId && stopOrderIndex !== null) {
        await tx.stop.updateMany({
          where: {
            routeId,
            orderIndex: {
              gt: stopOrderIndex,
            },
          },
          data: {
            orderIndex: {
              decrement: 1,
            },
          },
        });
      }
    }

    if (routeId) {
      await tx.route.update({
        where: {
          id: routeId,
        },
        data: {
          totalMileage: null,
          totalDuration: null,
          history: {
            create: {
              action: "Return collection deleted",
              details: `${ticket.reference} · ${ticket.orderNumber || "No order number"} · ${ticket.customerName}${shouldDeleteRouteStop ? " · route stop removed" : ""}`,
            },
          },
        },
      });
    }
  });

  if (routeId) {
    await calculateEtaSlots(routeId);
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const orderNumber = url.searchParams.get("orderNumber") || "";
  const created = url.searchParams.get("created") === "1";
  const assigned = url.searchParams.get("assigned") === "1";
  const deleted = url.searchParams.get("deleted") === "1";
  const [tickets, draftRoutes, returnOrder] = await Promise.all([
    searchReturnTickets(query),
    listDraftRoutesForReturnAssignment(),
    orderNumber.trim() ? findShopifyOrderForReturn(admin, orderNumber) : Promise.resolve(null),
  ]);

  return json({ tickets, draftRoutes, query, orderNumber, returnOrder, orderLookupAttempted: Boolean(orderNumber.trim()), created, assigned, deleted });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "assignReturnToRoute") {
    try {
      await assignReturnTicketToDraftRoute(
        String(formData.get("ticketId") || ""),
        String(formData.get("routeId") || ""),
      );

      return redirect("/app/returns?assigned=1");
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Return could not be assigned." }, { status: 400 });
    }
  }

  if (intent === "cancelReturn") {
    try {
      await cancelReturnTicket(String(formData.get("ticketId") || ""));

      return redirect("/app/returns?deleted=1");
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Return could not be deleted." }, { status: 400 });
    }
  }

  const orderNumber = String(formData.get("orderNumber") || "").trim();
  const selectedLines = parseSelectedLines(formData.get("selectedLinesJson"));

  if (!orderNumber) {
    return json({ ok: false, error: "Load a Shopify order before creating the return." }, { status: 400 });
  }

  if (!selectedLines.length) {
    return json({ ok: false, error: "Choose at least one item and quantity to return." }, { status: 400 });
  }

  try {
    await createReturnCollectionFromShopifyOrder({
      admin,
      orderNumber,
      selectedLines,
      notes: String(formData.get("notes") || "").trim(),
    });

    return redirect("/app/returns?created=1");
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Return could not be created." }, { status: 400 });
  }
};

function formatDate(value: string | Date | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusTone(status: string) {
  if (status === "OPEN") return "attention" as const;
  if (status === "ASSIGNED" || status === "OUT_FOR_COLLECTION") return "info" as const;
  if (status === "COLLECTED") return "success" as const;
  if (status === "COULD_NOT_COLLECT" || status === "CANCELLED") return "critical" as const;
  return "info" as const;
}

function formatTicketLine(quantity: number, itemName: string) {
  return `${quantity} x ${itemName}`;
}

function formatCollectedLine(line: ReturnTicketForRows["lines"][number]) {
  const collected = Number(line.quantityCollected || 0);
  return collected > 0
    ? `${collected} / ${line.quantityExpected} x ${line.itemName}`
    : `${line.quantityExpected} x ${line.itemName}`;
}

function isArchivedTicket(ticket: ReturnTicketForRows) {
  return ARCHIVE_STATUSES.has(ticket.status);
}

function proofPhotoSrc(value?: string | null) {
  if (!value) return "";
  if (value.startsWith("http") || value.startsWith("data:image/")) return value;
  return `/driver/routes/proof-of-delivery/${encodeURIComponent(value.replace(/^proof-of-delivery\//, ""))}`;
}

function ProofLink({ value, label }: { value?: string | null; label: string }) {
  const href = proofPhotoSrc(value);

  if (!href) {
    return <Text as="span" tone="subdued">No {label.toLowerCase()}</Text>;
  }

  return <a href={href} target="_blank" rel="noreferrer">View {label.toLowerCase()}</a>;
}

function noteText(ticket: ReturnTicketForRows) {
  return ticket.driverNote || ticket.notes || "No notes";
}

function ReturnsPageSummary({ tickets }: { tickets: ReturnTicketForRows[] }) {
  const activeCount = tickets.filter((ticket) => !isArchivedTicket(ticket)).length;
  const collectedCount = tickets.filter((ticket) => ticket.status === "COLLECTED").length;
  const failedCount = tickets.filter((ticket) => ticket.status === "COULD_NOT_COLLECT").length;

  return (
    <InlineStack gap="300">
      <Badge tone="info">{activeCount} active</Badge>
      <Badge tone="success">{collectedCount} returned</Badge>
      <Badge tone="critical">{failedCount} not returned</Badge>
    </InlineStack>
  );
}

function routeLabel(route: DraftRouteForAssignment) {
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(route.date));
  return `${route.name} · ${date} · ${route.stops.length} stops`;
}

function AssignmentControl({ ticket, draftRoutes, isAssigning }: { ticket: ReturnTicketForRows; draftRoutes: DraftRouteForAssignment[]; isAssigning: boolean }) {
  const [routeId, setRouteId] = useState("");
  const options = [
    { label: draftRoutes.length ? "Choose draft route" : "No draft routes available", value: "" },
    ...draftRoutes.map((route) => ({ label: routeLabel(route), value: route.id })),
  ];

  if (ticket.status !== "OPEN") {
    return <Text as="span" tone="subdued">{ticket.route ? ticket.route.name : "Not assignable"}</Text>;
  }

  if (ticket.route) {
    return <Text as="span">{ticket.route.name}</Text>;
  }

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="assignReturnToRoute" />
      <input type="hidden" name="ticketId" value={ticket.id} />
      <input type="hidden" name="routeId" value={routeId} />
      <BlockStack gap="150">
        <Select label="Draft route" labelHidden options={options} value={routeId} onChange={setRouteId} disabled={isAssigning} />
        <Button submit size="slim" loading={isAssigning} disabled={!routeId || isAssigning}>Assign</Button>
      </BlockStack>
    </Form>
  );
}

function DeleteReturnControl({ ticket, isDeleting }: { ticket: ReturnTicketForRows; isDeleting: boolean }) {
  if (!DELETABLE_RETURN_STATUSES.has(ticket.status)) {
    return <Text as="span" tone="subdued">Locked</Text>;
  }

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="cancelReturn" />
      <input type="hidden" name="ticketId" value={ticket.id} />
      <Button submit tone="critical" size="slim" loading={isDeleting} disabled={isDeleting}>Delete</Button>
    </Form>
  );
}

function StatusMessage({ children, tone = "success" }: { children: React.ReactNode; tone?: "success" | "critical" | "info" }) {
  const styles = {
    success: { background: "#ecfdf3", border: "#abefc6", color: "#067647" },
    critical: { background: "#fff7f5", border: "#fecdca", color: "#b42318" },
    info: { background: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
  }[tone];

  return (
    <div style={{ background: styles.background, border: `1px solid ${styles.border}`, borderRadius: 12, color: styles.color, padding: 12, fontWeight: 800 }}>
      {children}
    </div>
  );
}

export default function ReturnsPage() {
  const { tickets, draftRoutes, query, orderNumber, returnOrder, orderLookupAttempted, created, assigned, deleted } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useState(query);
  const [lookupOrderNumber, setLookupOrderNumber] = useState(orderNumber);
  const [quantitiesByItemId, setQuantitiesByItemId] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const activeActionIntent = navigation.state !== "idle" ? String(navigation.formData?.get("intent") || "") : "";
  const activeActionTicketId = navigation.state !== "idle" ? String(navigation.formData?.get("ticketId") || "") : "";
  const isCreating = activeActionIntent === "createReturnCollection";

  useEffect(() => {
    if (!returnOrder) {
      setQuantitiesByItemId({});
      return;
    }

    setQuantitiesByItemId(Object.fromEntries(returnOrder.lineItems.map((line) => [line.id, 0])));
  }, [returnOrder?.id]);

  const selectedLines = useMemo(() => {
    if (!returnOrder) {
      return [];
    }

    return returnOrder.lineItems
      .map((line) => ({
        itemName: line.title,
        quantityExpected: clampReturnQuantity(quantitiesByItemId[line.id] ?? 0, line.quantity),
      }))
      .filter((line) => line.quantityExpected > 0);
  }, [returnOrder, quantitiesByItemId]);

  const selectedLinesJson = JSON.stringify(selectedLines);

  const setItemQuantity = (itemId: string, value: number, max: number) => {
    setQuantitiesByItemId((current) => ({
      ...current,
      [itemId]: clampReturnQuantity(value, max),
    }));
  };

  const activeTickets = tickets.filter((ticket) => !isArchivedTicket(ticket));
  const archivedTickets = tickets.filter(isArchivedTicket);

  const activeTicketRows = activeTickets.map((ticket) => [
    ticket.reference,
    <Badge tone={statusTone(ticket.status)}>{ticket.status}</Badge>,
    ticket.orderNumber || "No order number",
    ticket.customerName,
    ticket.postcode || "No postcode",
    ticket.lines.map((line) => formatTicketLine(line.quantityExpected, line.itemName)).join(", "),
    <AssignmentControl ticket={ticket} draftRoutes={draftRoutes} isAssigning={activeActionIntent === "assignReturnToRoute" && activeActionTicketId === ticket.id} />,
    <DeleteReturnControl ticket={ticket} isDeleting={activeActionIntent === "cancelReturn" && activeActionTicketId === ticket.id} />,
    ticket.returnRequestedAt ? formatDate(ticket.returnRequestedAt) : formatDate(ticket.createdAt),
  ]);

  const archiveRows = archivedTickets.map((ticket) => [
    ticket.reference,
    <Badge tone={statusTone(ticket.status)}>{ticket.status}</Badge>,
    ticket.orderNumber || "No order number",
    ticket.customerName,
    ticket.lines.map(formatCollectedLine).join(", "),
    ticket.collectedAt ? formatDate(ticket.collectedAt) : formatDate(ticket.updatedAt),
    <BlockStack gap="100">
      <ProofLink value={ticket.collectionPhotoUrl} label="Photo" />
      <ProofLink value={ticket.customerSignature} label="Signature" />
    </BlockStack>,
    noteText(ticket),
  ]);

  return (
    <Page title="Returns" subtitle="Load a Shopify order, choose what is coming back and create a return" fullWidth>
      <Layout>
        <Layout.Section variant="oneThird">
          <LegacyCard sectioned title="Create return">
            <BlockStack gap="400">
              {actionData && "error" in actionData ? (
                <StatusMessage tone="critical">{actionData.error}</StatusMessage>
              ) : null}

              {created ? <StatusMessage>Return created successfully.</StatusMessage> : null}
              {assigned ? <StatusMessage>Return assigned to the draft route.</StatusMessage> : null}
              {deleted ? <StatusMessage>Return deleted from Active returns and moved to the archive.</StatusMessage> : null}

              <Form method="get">
                <BlockStack gap="200">
                  <TextField
                    label="Shopify order number"
                    name="orderNumber"
                    value={lookupOrderNumber}
                    onChange={setLookupOrderNumber}
                    autoComplete="off"
                    placeholder="Example, #1234"
                    helpText="This can find fulfilled Shopify orders so returns still show in the app."
                  />
                  <Button submit>Load customer order</Button>
                </BlockStack>
              </Form>

              {orderLookupAttempted && !returnOrder ? (
                <Box background="bg-surface-warning" padding="300" borderRadius="300">
                  <Text as="p" tone="critical">No Shopify order was found for {orderNumber}.</Text>
                </Box>
              ) : null}

              {returnOrder ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="createReturnCollection" />
                  <input type="hidden" name="orderNumber" value={returnOrder.name} />
                  <input type="hidden" name="selectedLinesJson" value={selectedLinesJson} />
                  <BlockStack gap="300">
                    <Box background="bg-surface-secondary" padding="300" borderRadius="300">
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingSm">{returnOrder.name} · {returnOrder.customerName}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Original order: {formatDate(returnOrder.createdAt)}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Postcode: {returnOrder.postcode || "No postcode"}</Text>
                      </BlockStack>
                    </Box>

                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">Items to return</Text>
                      {returnOrder.lineItems.map((line) => {
                        const quantity = quantitiesByItemId[line.id] ?? 0;
                        const maxQuantity = Math.max(0, line.quantity);

                        return (
                          <Box key={line.id} padding="300" borderWidth="025" borderColor="border" borderRadius="300">
                            <BlockStack gap="250">
                              <BlockStack gap="050">
                                <Text as="p" variant="bodyMd" fontWeight="semibold">{line.title}</Text>
                                {line.sku ? <Text as="p" variant="bodySm" tone="subdued">{line.sku}</Text> : null}
                              </BlockStack>
                              <InlineStack align="space-between" blockAlign="center" gap="200">
                                <BlockStack gap="050">
                                  <Text as="span" variant="bodySm" tone="subdued">Quantity</Text>
                                  <Text as="span" variant="headingMd">{quantity} / {maxQuantity}</Text>
                                </BlockStack>
                                <InlineStack gap="100">
                                  <Button disabled={quantity <= 0} onClick={() => setItemQuantity(line.id, quantity - 1, maxQuantity)}>-</Button>
                                  <Button disabled={quantity >= maxQuantity} onClick={() => setItemQuantity(line.id, quantity + 1, maxQuantity)}>+</Button>
                                </InlineStack>
                              </InlineStack>
                            </BlockStack>
                          </Box>
                        );
                      })}
                    </BlockStack>

                    <TextField label="Internal notes" name="notes" value={notes} onChange={setNotes} autoComplete="off" multiline={3} />
                    <Button submit variant="primary" loading={isCreating} disabled={!selectedLines.length || isCreating}>Create return</Button>
                  </BlockStack>
                </Form>
              ) : null}
            </BlockStack>
          </LegacyCard>
        </Layout.Section>

        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center" gap="300">
                <Text as="h2" variant="headingMd">Search returns</Text>
                <ReturnsPageSummary tickets={tickets} />
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Open returns can be assigned to draft routes from this page. They will appear on the driver route as return stops.
              </Text>
              <Form method="get">
                <InlineStack gap="200" blockAlign="end">
                  <TextField
                    label="Search"
                    name="q"
                    value={searchQuery}
                    onChange={setSearchQuery}
                    autoComplete="off"
                    placeholder="Order number, name, address or postcode"
                  />
                  <Button submit>Search</Button>
                </InlineStack>
              </Form>
            </BlockStack>
          </LegacyCard>
        </Layout.Section>

        <Layout.Section>
          <LegacyCard title="Active returns">
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text", "text"]}
              headings={["Ticket", "Status", "Order", "Customer", "Postcode", "Items", "Route action", "Delete", "Requested"]}
              rows={activeTicketRows}
            />
          </LegacyCard>
        </Layout.Section>

        <Layout.Section>
          <LegacyCard title="Return archive">
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text"]}
              headings={["Ticket", "Status", "Order", "Customer", "Returned items", "Completed", "Proof", "Notes"]}
              rows={archiveRows}
            />
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
