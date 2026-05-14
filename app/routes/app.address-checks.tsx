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

  return json({ orders: addressCheckOrders });
};

export default function AddressChecks() {
  const { orders } = useLoaderData<typeof loader>();

  return (
    <Page title="Address Checks">
      <Layout>
        <Layout.Section>
          <LegacyCard>
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
                renderItem={(order) => (
                  <ResourceItem id={order.id} accessibilityLabel={`Review ${order.name}`}>
                    <InlineStack align="space-between">
                      <BlockStack gap="100">
                        <Text as="h3" variant="bodyMd" fontWeight="bold">
                          {order.name} · {order.customerName}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {order.addressSummary}
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
                )}
              />
            )}
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
