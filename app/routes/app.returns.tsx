import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  BlockStack,
  Text,
  TextField,
  Button,
  DataTable,
  Select,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { useMemo, useState } from "react";

import { authenticate } from "../shopify.server";
import { createReturnTicket, listReturnAssignableStops, searchReturnTickets } from "../lib/returns.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const [tickets, assignableStops] = await Promise.all([
    searchReturnTickets(query),
    listReturnAssignableStops(),
  ]);

  return json({ tickets, assignableStops, query });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();

  try {
    await createReturnTicket({
      stopId: String(formData.get("stopId") || "").trim() || null,
      orderNumber: String(formData.get("orderNumber") || "").trim(),
      customerName: String(formData.get("customerName") || "").trim(),
      customerEmail: String(formData.get("customerEmail") || "").trim(),
      customerPhone: String(formData.get("customerPhone") || "").trim(),
      address: String(formData.get("address") || "").trim(),
      postcode: String(formData.get("postcode") || "").trim(),
      notes: String(formData.get("notes") || "").trim(),
      itemsText: String(formData.get("itemsText") || "").trim(),
    });

    return redirect("/app/returns");
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Return ticket could not be created." }, { status: 400 });
  }
};

function formatDate(value: string | Date | null) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusTone(status: string) {
  if (status === "OPEN") return "attention" as const;
  if (status === "COLLECTED") return "success" as const;
  return "info" as const;
}

export default function ReturnsPage() {
  const { tickets, assignableStops, query } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [selectedStopId, setSelectedStopId] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [itemsText, setItemsText] = useState("");
  const [notes, setNotes] = useState("");
  const [searchQuery, setSearchQuery] = useState(query);

  const stopOptions = useMemo(() => [
    { label: "Not assigned to a route stop yet", value: "" },
    ...assignableStops.map((stop) => ({ label: stop.label, value: stop.value })),
  ], [assignableStops]);

  const onSelectStop = (value: string) => {
    setSelectedStopId(value);
    const selected = assignableStops.find((stop) => stop.value === value);

    if (!selected) {
      return;
    }

    setOrderNumber(selected.orderNumber || "");
    setCustomerName(selected.customerName || "");
    setCustomerEmail(selected.customerEmail || "");
    setCustomerPhone(selected.customerPhone || "");
    setAddress(selected.address || "");
    setPostcode(selected.postcode || "");
  };

  const ticketRows = tickets.map((ticket) => [
    ticket.reference,
    <Badge tone={statusTone(ticket.status)}>{ticket.status}</Badge>,
    ticket.orderNumber || "No order number",
    ticket.customerName,
    ticket.postcode || "No postcode",
    ticket.lines.map((line) => `${line.quantityExpected} x ${line.itemName}`).join(", "),
    ticket.route ? ticket.route.name : "Not assigned",
    ticket.collectedAt ? formatDate(ticket.collectedAt) : "Pending",
  ]);

  return (
    <Page title="Returns" subtitle="Create return tickets and search by order number, customer name or address" fullWidth>
      <Layout>
        <Layout.Section variant="oneThird">
          <LegacyCard sectioned title="Create return ticket">
            <Form method="post">
              <BlockStack gap="300">
                {actionData && "error" in actionData ? (
                  <Text as="p" tone="critical">{actionData.error}</Text>
                ) : null}

                <Select
                  label="Attach to delivery stop, optional"
                  name="stopId"
                  options={stopOptions}
                  value={selectedStopId}
                  onChange={onSelectStop}
                />
                <TextField label="Order number" name="orderNumber" value={orderNumber} onChange={setOrderNumber} autoComplete="off" />
                <TextField label="Customer name" name="customerName" value={customerName} onChange={setCustomerName} autoComplete="off" />
                <TextField label="Customer email" name="customerEmail" type="email" value={customerEmail} onChange={setCustomerEmail} autoComplete="off" />
                <TextField label="Customer phone" name="customerPhone" value={customerPhone} onChange={setCustomerPhone} autoComplete="off" />
                <TextField label="Collection address" name="address" value={address} onChange={setAddress} autoComplete="off" multiline={3} />
                <TextField label="Postcode" name="postcode" value={postcode} onChange={setPostcode} autoComplete="off" />
                <TextField
                  label="Items to collect"
                  name="itemsText"
                  value={itemsText}
                  onChange={setItemsText}
                  autoComplete="off"
                  multiline={5}
                  helpText="One item per line, for example: 2 x Grey Marble panels"
                />
                <TextField label="Internal notes" name="notes" value={notes} onChange={setNotes} autoComplete="off" multiline={3} />
                <Button submit variant="primary">Create return ticket</Button>
              </BlockStack>
            </Form>
          </LegacyCard>
        </Layout.Section>

        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Search return tickets</Text>
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

          <LegacyCard title="Return tickets">
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
