import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  Text,
  BlockStack,
  ResourceList,
  ResourceItem,
  Badge,
  Button,
  InlineStack,
} from "@shopify/polaris";

import { listDriverRoutes, startDriverRoute } from "../lib/driverRoutes.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const routes = await listDriverRoutes();

  return json({ routes });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const routeId = String(formData.get("routeId") || "").trim();

  if (routeId) {
    await startDriverRoute(routeId);
  }

  return redirect("/app/driver-routes");
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function statusTone(status: string) {
  if (status === "OUT_FOR_DELIVERY") {
    return "success" as const;
  }

  if (status === "NOTIFICATIONS_SENT") {
    return "info" as const;
  }

  return "attention" as const;
}

export default function DriverRoutes() {
  const { routes } = useLoaderData<typeof loader>();

  return (
    <Page title="Driver Routes">
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Driver route view</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                This is the first driver route screen. Driver login will be added later, so this page is still inside the admin app for now.
              </Text>
            </BlockStack>
          </LegacyCard>

          <LegacyCard title="Active driver routes">
            <ResourceList
              resourceName={{ singular: "route", plural: "routes" }}
              items={routes}
              renderItem={(route) => {
                const deliveredStops = route.stops.filter((stop) => stop.status === "DELIVERED").length;
                const failedStops = route.stops.filter((stop) => stop.status === "FAILED").length;
                const pendingStops = route.stops.filter((stop) => stop.status === "PENDING").length;

                return (
                  <ResourceItem id={route.id} accessibilityLabel={`Open ${route.name}`}>
                    <BlockStack gap="200">
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="h3" variant="bodyMd" fontWeight="bold">
                            <Link to={`/app/driver-routes/${route.id}`}>{route.name}</Link>
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {formatDate(route.date)} · Driver: {route.driver?.name || "No driver assigned"}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {pendingStops} pending · {deliveredStops} delivered · {failedStops} failed
                          </Text>
                        </BlockStack>
                        <BlockStack gap="200">
                          <Badge tone={statusTone(route.status)}>{route.status}</Badge>
                          {route.status !== "OUT_FOR_DELIVERY" ? (
                            <Form method="post">
                              <input type="hidden" name="routeId" value={route.id} />
                              <Button submit>Start route</Button>
                            </Form>
                          ) : null}
                        </BlockStack>
                      </InlineStack>
                    </BlockStack>
                  </ResourceItem>
                );
              }}
            />
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
