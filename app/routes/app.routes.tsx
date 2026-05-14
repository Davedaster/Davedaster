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

import { listRoutes } from "../lib/routeDrafts.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const routes = await listRoutes();

  return json({ routes });
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default function Routes() {
  const { routes } = useLoaderData<typeof loader>();

  return (
    <Page title="Routes">
      <Layout>
        <Layout.Section>
          <LegacyCard>
            {routes.length === 0 ? (
              <EmptyState
                heading="No saved routes yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Create a draft route from the Orders Map by selecting delivery pins.</p>
              </EmptyState>
            ) : (
              <ResourceList
                resourceName={{ singular: "route", plural: "routes" }}
                items={routes}
                renderItem={(route) => (
                  <ResourceItem id={route.id} accessibilityLabel={`View ${route.name}`}>
                    <InlineStack align="space-between">
                      <BlockStack gap="100">
                        <Text as="h3" variant="bodyMd" fontWeight="bold">
                          {route.name}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {formatDate(route.date)} · {route.stops.length} stops
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {route.stops
                            .map((stop) => stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).join(", "))
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </BlockStack>
                      <Badge tone={route.status === "DRAFT" ? "info" : "success"}>{route.status}</Badge>
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
