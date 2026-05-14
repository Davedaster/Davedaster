import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
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
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { getDeliveryOrders } from "../lib/shopifyOrders.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const orders = await getDeliveryOrders(admin);
  const addressCheckOrders = orders.filter((order) => order.addressStatus !== "READY");

  return json({ orders: addressCheckOrders, addressLookupEnabled: Boolean(process.env.GETADDRESS_API_KEY) });
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
