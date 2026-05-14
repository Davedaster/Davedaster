import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  Text,
  ResourceList,
  ResourceItem,
  Badge,
  BlockStack,
  InlineStack,
  EmptyState,
  FormLayout,
  TextField,
  Button,
} from "@shopify/polaris";

import { upsertAddressOverride } from "../lib/addressOverrides.server";
import { getDeliveryOrders } from "../lib/shopifyOrders.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const orders = await getDeliveryOrders(admin);
  const addressCheckOrders = orders.filter((order) => order.addressStatus !== "READY");

  return json({ orders: addressCheckOrders, addressLookupEnabled: Boolean(process.env.GETADDRESS_API_KEY) });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();

  const shopifyOrderId = String(formData.get("shopifyOrderId") || "");
  const shopifyOrderName = String(formData.get("shopifyOrderName") || "");
  const manualAddress = String(formData.get("manualAddress") || "").trim();
  const postcode = String(formData.get("postcode") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  const latitudeValue = String(formData.get("latitude") || "").trim();
  const longitudeValue = String(formData.get("longitude") || "").trim();
  const latitude = latitudeValue ? Number(latitudeValue) : null;
  const longitude = longitudeValue ? Number(longitudeValue) : null;

  if (!shopifyOrderId || !manualAddress) {
    return json({ ok: false, error: "Order and manual address are required." }, { status: 400 });
  }

  await upsertAddressOverride({
    shopifyOrderId,
    shopifyOrderName,
    manualAddress,
    postcode,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    notes,
  });

  return redirect("/app/address-checks");
};

export default function AddressChecks() {
  const { orders, addressLookupEnabled } = useLoaderData<typeof loader>();

  return (
    <Page title="Address Checks">
      <Layout>
        <Layout.Section>
          <LegacyCard>
            <BlockStack gap="300">
              {!addressLookupEnabled ? (
                <LegacyCard sectioned>
                  <Text as="p" variant="bodyMd" tone="critical">
                    getAddress.io lookup is not enabled yet. Add GETADDRESS_API_KEY to the app environment before testing live address matching.
                  </Text>
                </LegacyCard>
              ) : null}

              {orders.length === 0 ? (
                <EmptyState
                  heading="No address checks needed"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>All matching delivery orders currently have enough address information for the next stage.</p>
                </EmptyState>
              ) : (
                <ResourceList
                  resourceName={{ singular: "order", plural: "orders" }}
                  items={orders}
                  renderItem={(order) => {
                    const coordinates = order.latitude && order.longitude
                      ? `${order.latitude.toFixed(5)}, ${order.longitude.toFixed(5)}`
                      : "No coordinates yet";

                    return (
                      <ResourceItem id={order.id} accessibilityLabel={`Review ${order.name}`}>
                        <BlockStack gap="300">
                          <InlineStack align="space-between">
                            <BlockStack gap="100">
                              <Text as="h3" variant="bodyMd" fontWeight="bold">
                                {order.name} · {order.customerName}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Shopify address: {order.addressSummary}
                              </Text>
                              {order.formattedAddress ? (
                                <Text as="p" variant="bodySm" tone="subdued">
                                  Matched address: {order.formattedAddress}
                                </Text>
                              ) : null}
                              {order.hasManualOverride ? (
                                <Text as="p" variant="bodySm" tone="success">
                                  Manual address override saved: {order.manualAddress}
                                </Text>
                              ) : null}
                              <Text as="p" variant="bodySm" tone="subdued">
                                Coordinates: {coordinates}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {order.shippingMethod}
                              </Text>
                            </BlockStack>
                            <Badge tone="warning">
                              {order.addressStatus === "NEEDS_ADDRESS" ? "Needs address" : "Needs location check"}
                            </Badge>
                          </InlineStack>

                          <LegacyCard sectioned>
                            <Form method="post">
                              <input type="hidden" name="shopifyOrderId" value={order.id} />
                              <input type="hidden" name="shopifyOrderName" value={order.name} />
                              <FormLayout>
                                <TextField
                                  label="Manual delivery address"
                                  name="manualAddress"
                                  defaultValue={order.manualAddress || order.addressSummary}
                                  autoComplete="off"
                                  multiline={3}
                                  helpText="Use this when Shopify has no delivery address, or when the matched address is not accurate enough."
                                />
                                <FormLayout.Group>
                                  <TextField
                                    label="Postcode"
                                    name="postcode"
                                    defaultValue={order.postcode || ""}
                                    autoComplete="off"
                                  />
                                  <TextField
                                    label="Latitude, optional"
                                    name="latitude"
                                    defaultValue={order.latitude ? String(order.latitude) : ""}
                                    autoComplete="off"
                                  />
                                  <TextField
                                    label="Longitude, optional"
                                    name="longitude"
                                    defaultValue={order.longitude ? String(order.longitude) : ""}
                                    autoComplete="off"
                                  />
                                </FormLayout.Group>
                                <TextField
                                  label="Internal address notes"
                                  name="notes"
                                  defaultValue={order.manualAddressNotes || ""}
                                  autoComplete="off"
                                  multiline={2}
                                />
                                <Button submit variant="primary">Save manual address</Button>
                              </FormLayout>
                            </Form>
                          </LegacyCard>
                        </BlockStack>
                      </ResourceItem>
                    );
                  }}
                />
              )}
            </BlockStack>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
