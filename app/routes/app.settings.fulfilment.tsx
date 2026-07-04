import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Button, Checkbox, Layout, LegacyCard, Page, Select, Text } from "@shopify/polaris";
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
  const notifyCustomerOnFulfilment = String(formData.get("notifyCustomerOnFulfilment") || "") === "true";
  const fulfilmentSettings = await saveFulfilmentSettings({ routePublishFulfilmentMode, notifyCustomerOnFulfilment });

  return json({ ok: true, fulfilmentSettings, saved: true });
};

export default function FulfilmentSettingsPage() {
  const { fulfilmentSettings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const currentSettings = actionData?.fulfilmentSettings || fulfilmentSettings;
  const [mode, setMode] = useState(currentSettings.routePublishFulfilmentMode);
  const [notifyCustomer, setNotifyCustomer] = useState(currentSettings.notifyCustomerOnFulfilment);

  useEffect(() => {
    setMode(currentSettings.routePublishFulfilmentMode);
    setNotifyCustomer(currentSettings.notifyCustomerOnFulfilment);
  }, [currentSettings.routePublishFulfilmentMode, currentSettings.notifyCustomerOnFulfilment]);

  return (
    <Page title="Fulfilment settings" backAction={{ content: "Settings", url: "/app/settings" }}>
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <Form method="post">
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Shopify fulfilment timing</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Choose when Shopify orders are fulfilled and whether local deliveries should be marked delivered straight away.
                </Text>
                {actionData?.saved ? <Badge tone="success">Fulfilment settings saved</Badge> : null}
                <Select
                  label="When should route orders be fulfilled?"
                  name="routePublishFulfilmentMode"
                  value={mode}
                  onChange={(value) => setMode(value as RoutePublishFulfilmentMode)}
                  options={[
                    { label: "Fulfil each order when the driver completes POD", value: "on_delivery_complete" },
                    { label: "Fulfil orders when the route is published", value: "on_publish" },
                    { label: "Fulfil and mark delivered when the route is published", value: "on_publish_delivered" },
                  ]}
                  helpText="POD completion is safest. Publish fulfilment is available when you deliberately want Shopify updated as soon as a route is published."
                />
                <input type="hidden" name="notifyCustomerOnFulfilment" value={notifyCustomer ? "true" : "false"} />
                <Checkbox
                  label="Send Shopify fulfilment notification to customers"
                  checked={notifyCustomer}
                  onChange={setNotifyCustomer}
                  helpText="Off means the app updates Shopify silently and only your BPD delivery messages go out. On lets Shopify send its own fulfilment notification too."
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
