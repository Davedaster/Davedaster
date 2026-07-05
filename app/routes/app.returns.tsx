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
} from "@shopify/polaris";
import { useEffect, useMemo, useState } from "react";

import { authenticate } from "../shopify.server";
import { searchReturnTickets } from "../lib/returns.server";
import { createReturnCollectionFromShopifyOrder, findShopifyOrderForReturn } from "../lib/returnCollections.server";

type ReturnLineInput = {
  itemName: string;
  quantityExpected: number;
};

function parseReturnLines(value: string): ReturnLineInput[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const quantityMatch = line.match(/^(\d+)\s*(?:x|×)?\s*(.+)$/i);

      if (!quantityMatch) {
        return { itemName: line, quantityExpected: 1 };
      }

      return {
        quantityExpected: Math.max(1, Math.round(Number(quantityMatch[1]) || 1)),
        itemName: quantityMatch[2].trim(),
      };
    })
    .filter((line) => line.itemName);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const orderNumber = url.searchParams.get("orderNumber") || "";
  const [tickets, returnOrder] = await Promise.all([
    searchReturnTickets(query),
    orderNumber.trim() ? findShopifyOrderForReturn(admin, orderNumber) : Promise.resolve(null),
  ]);

  return json({ tickets, query, orderNumber, returnOrder, orderLookupAttempted: Boolean(orderNumber.trim()) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const orderNumber = String(formData.get("orderNumber") || "").trim();
  const itemsText = String(formData.get("itemsText") || "").trim();

  if (!orderNumber) {
    return json({ ok: false, error: "Load a Shopify order before creating the return collection." }, { status: 400 });
  }

  const selectedLines = parseReturnLines(itemsText);

  if (!selectedLines.length) {
    return json({ ok: false, error: "Add at least one item and quantity to collect." }, { status: 400 });
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
    return json({ ok: false, error: error instanceof Error ? error.message : "Return collection could not be created." }, { status: 400 });
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

export default function ReturnsPage() {
  const { tickets, query, orderNumber, returnOrder, orderLookupAttempted } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useState(query);
  const [lookupOrderNumber, setLookupOrderNumber] = useState(orderNumber);
  const [itemsText, setItemsText] = useState("");
  const [notes, setNotes] = useState("");
  const isCreating = navigation.state !== "idle";

  const suggestedItemsText = useMemo(() => {
    if (!returnOrder) {
      return "";
    }

    return returnOrder.lineItems.map((line) => formatTicketLine(line.quantity, line.title)).join("\n");
  }, [returnOrder]);

  useEffect(() => {
    setItemsText(suggestedItemsText);
  }, [suggestedItemsText]);

  const ticketRows = tickets.map((ticket) => [
    ticket.reference,
    <Badge tone={statusTone(ticket.status)}>{ticket.status}</Badge>,
    ticket.orderNumber || "No order number",
    ticket.customerName,
    ticket.postcode || "No postcode",
    ticket.lines.map((line) => formatTicketLine(line.quantityExpected, line.itemName)).join(", "),
    ticket.route ? ticket.route.name : "Not assigned",
    ticket.collectedAt ? formatDate(ticket.collectedAt) : "Pending",
  ]);

  return (
    <Page title="Returns & Collections" subtitle="Load a Shopify order, choose what is coming back and create a return collection" fullWidth>
      <Layout>
        <Layout.Section variant="oneThird">
          <LegacyCard sectioned title="Create return collection">
            <BlockStack gap="400">
              {actionData && "error" in actionData ? (
                <Text as="p" tone="critical">{actionData.error}</Text>
              ) : null}

              <Form method="get">
                <BlockStack gap="200">
                  <TextField
                    label="Shopify order number"
                    name="orderNumber"
                    value={lookupOrderNumber}
                    onChange={setLookupOrderNumber}
                    autoComplete="off"
                    placeholder="Example, #1234"
                    helpText="This can find fulfilled Shopify orders so return collections still show in the app."
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
                  <input type="hidden" name="orderNumber" value={returnOrder.name} />
                  <BlockStack gap="300">
                    <Box background="bg-surface-secondary" padding="300" borderRadius="300">
                      <BlockStack gap="100">
                        <Text as="h3" variant="headingSm">{returnOrder.name} · {returnOrder.customerName}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Original order: {formatDate(returnOrder.createdAt)}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Postcode: {returnOrder.postcode || "No postcode"}</Text>
                      </BlockStack>
                    </Box>

                    <BlockStack gap="100">
                      <Text as="h3" variant="headingSm">Original order items</Text>
                      {returnOrder.lineItems.map((line) => (
                        <Text key={line.id} as="p" variant="bodySm" tone="subdued">
                          {formatTicketLine(line.quantity, line.title)}{line.sku ? ` · ${line.sku}` : ""}
                        </Text>
                      ))}
                    </BlockStack>

                    <TextField
                      label="Items to collect"
                      name="itemsText"
                      value={itemsText}
                      onChange={setItemsText}
                      autoComplete="off"
                      multiline={5}
                      helpText="Edit the quantities here. The driver can add extra items later from the phone proof screen."
                    />
                    <TextField label="Internal notes" name="notes" value={notes} onChange={setNotes} autoComplete="off" multiline={3} />
                    <Button submit variant="primary" loading={isCreating} disabled={!itemsText.trim()}>Create return collection</Button>
                  </BlockStack>
                </Form>
              ) : null}
            </BlockStack>
          </LegacyCard>
        </Layout.Section>

        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Search return collections</Text>
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

          <LegacyCard title="Return collections">
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text"]}
              headings={["Ticket", "Status", "Order", "Customer", "Postcode", "Items", "Route", "Collected"]}
              rows={ticketRows}
            />
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
