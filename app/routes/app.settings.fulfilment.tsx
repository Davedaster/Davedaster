import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Button, Layout, LegacyCard, Page, Select, Text } from "@shopify/polaris";
import { useEffect, useState } from "react";

import { getFulfilmentSettings, saveFulfilmentSettings, type RoutePublishFulfilmentMode } from "../lib/fulfilmentSettings.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const fulfilmentSettings = await getFulfilmentSettings();

  return json({ fulfilmentSettings });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const routePublishFulfilmentMode = String(formData.get("routePublishFulfilmentMode") || "on_delivery_complete") as RoutePublishFulfilmentMode;
  const fulfilmentSettings = await saveFulfilmentSettings({ routePublishFulfilmentMode });

  return json({ ok: true, fulfilmentSettings, saved: true });
};

export default function FulfilmentSettingsPage() {
  const { fulfilmentSettings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const currentSettings = actionData?.fulfilmentSettings || fulfilmentSettings;
  const [mode, setMode] = useState(currentSettings.routePublishFulfilmentMode);

  useEffect(() => {
    setMode(currentSettings.routePublishFulfilmentMode);
  }, [currentSettings.routePublishFulfilmentMode]);

  return (
    <Page title="Fulfilment settings" backAction={{ content: "Settings", url: "/app/settings" }}>
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <Form method="post">
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Shopify fulfilment timing</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Choose when Shopify orders are marked fulfilled for published delivery routes.
                </Text>
                {actionData?.saved ? <Badge tone="success">Fulfilment settings saved</Badge> : null}
                <Select
                  label="When should route orders be fulfilled?"
                  name="routePublishFulfilmentMode"
                  value={mode}
                  onChange={(value) => setMode(value as RoutePublishFulfilmentMode)}
                  options={[
                    { label: "Fulfil orders when the route is published", value: "on_publish" },
                    { label: "Fulfil each order when the driver completes that delivery", value: "on_delivery_complete" },
                  ]}
                  helpText="The safer default is to fulfil when the driver completes the delivery. Choose publish fulfilment only if you want every order fulfilled as soon as the route is published and booked slot notifications are sent."
                />
                <Button submit variant="primary">Save fulfilment settings</Button>
              </BlockStack>
            </Form>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
