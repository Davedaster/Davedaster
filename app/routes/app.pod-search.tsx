import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Box, Button, Divider, FormLayout, InlineStack, Layout, LegacyCard, Page, Text, TextField } from "@shopify/polaris";
import { useEffect, useState } from "react";

import { ProofPhotoGallery } from "../components/ProofPhotoGallery";
import { searchProofOfDelivery } from "../lib/proofOfDeliverySearch.server";
import { deleteProofPhoto } from "../lib/proofPhotos.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const results = query.trim() ? await searchProofOfDelivery(query) : [];

  return json({ query, results });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent !== "deleteProofPhoto") {
    return redirect(`/app/pod-search${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  }

  const routeId = String(formData.get("routeId") || "").trim();
  const proofPhotoId = String(formData.get("proofPhotoId") || "").trim();

  if (!routeId || !proofPhotoId) {
    return json({ ok: false, error: "Proof photo removal is missing route details." }, { status: 400 });
  }

  try {
    await deleteProofPhoto({ routeId, proofPhotoId });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Proof photo remove failed." }, { status: 400 });
  }

  return redirect(`/app/pod-search${query ? `?q=${encodeURIComponent(query)}` : ""}`);
};

function formatDateTime(value?: string | Date | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value?: string | Date | null) {
  if (!value) {
    return "No route date";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default function PodSearchPage() {
  const { query, results } = useLoaderData<typeof loader>();
  const [searchValue, setSearchValue] = useState(query);

  useEffect(() => {
    setSearchValue(query);
  }, [query]);

  return (
    <Page title="Proof of Delivery Search">
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text as="p" variant="bodyMd" tone="subdued">
                Search delivered proof photos and signatures by order number, customer name, email address or phone number.
              </Text>
              <Form method="get">
                <FormLayout>
                  <TextField
                    label="Order number, customer name, email or phone"
                    name="q"
                    value={searchValue}
                    onChange={setSearchValue}
                    autoComplete="off"
                    placeholder="4462, John Smith, john@email.com or 07700 900123"
                  />
                  <Button submit variant="primary">Search POD</Button>
                </FormLayout>
              </Form>
              {query.trim() ? <Text as="p" variant="bodySm" tone="subdued">Showing {results.length} result{results.length === 1 ? "" : "s"} for {query}</Text> : null}
            </BlockStack>
          </LegacyCard>

          {query.trim() && !results.length ? (
            <LegacyCard sectioned>
              <Text as="p" variant="bodyMd">No proof of delivery records found.</Text>
            </LegacyCard>
          ) : null}

          <BlockStack gap="300">
            {results.map((group) => {
              const orders = group.orders.map((order) => order.shopifyOrderNumber).filter(Boolean).join(", ") || "No order number";
              const customers = group.orders.map((order) => order.customerName).filter(Boolean).join(", ") || "No customer name";
              const stop = group.stops[0];
              const route = stop?.route;
              const deliveredAt = stop?.actualArrival || null;
              const driverName = route?.driver?.name || "No driver recorded";

              return (
                <LegacyCard key={group.id} sectioned>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start">
                      <BlockStack gap="100">
                        <Text as="h2" variant="headingMd">Orders: {orders}</Text>
                        <Text as="p" variant="bodyMd" fontWeight="bold">{customers}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">{group.address || group.formattedAddress || "No address"}</Text>
                        {group.postcode ? <Text as="p" variant="bodySm" tone="subdued">Postcode: {group.postcode}</Text> : null}
                      </BlockStack>
                      <Badge tone="success">POD saved</Badge>
                    </InlineStack>
                    <Divider />
                    <Box background="bg-surface-secondary" padding="300" borderRadius="300">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm">Delivered: {formatDateTime(deliveredAt)}</Text>
                        <Text as="p" variant="bodySm">Route date: {formatDate(route?.date)}</Text>
                        <Text as="p" variant="bodySm">Driver: {driverName}</Text>
                        {route ? <Text as="p" variant="bodySm">Route: {route.name}</Text> : null}
                        {group.deliveryNote ? <Text as="p" variant="bodySm">Delivery note: {group.deliveryNote}</Text> : null}
                        {group.safePlaceNote ? <Text as="p" variant="bodySm">Safe place: {group.safePlaceNote}</Text> : null}
                      </BlockStack>
                    </Box>
                    <ProofPhotoGallery proofPhotos={group.proofPhotos} routeId={route?.id} />
                  </BlockStack>
                </LegacyCard>
              );
            })}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
