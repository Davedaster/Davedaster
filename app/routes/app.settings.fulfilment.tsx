import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Badge, BlockStack, Button, Checkbox, Layout, LegacyCard, Page, Select, Text } from "@shopify/polaris";
import { useEffect, useState } from "react";

import { AdminToastStack, type AdminToastMessage } from "../components/AdminToastStack";
import { getFulfilmentSettings, saveFulfilmentSettings, type RoutePublishFulfilmentMode } from "../lib/fulfilmentSettings.server";
import { authenticate } from "../shopify.server";

type FulfilmentSettingsActionData = {
  ok: boolean;
  fulfilmentSettings?: Awaited<ReturnType<typeof getFulfilmentSettings>>;
  saved?: boolean;
  error?: string;
  toasts?: AdminToastMessage[];
};

function actionToast(title: string, detail?: string, tone: AdminToastMessage["tone"] = "success"): AdminToastMessage {
  return { title, detail, tone };
}

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

  try {
    const fulfilmentSettings = await saveFulfilmentSettings({ routePublishFulfilmentMode, notifyCustomerOnFulfilment });

    return json<FulfilmentSettingsActionData>({
      ok: true,
      fulfilmentSettings,
      saved: true,
      toasts: [actionToast("Fulfilment settings saved", "Shopify fulfilment timing has been updated.")],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fulfilment settings could not be saved.";
    return json<FulfilmentSettingsActionData>({
      ok: false,
      error: message,
      toasts: [actionToast("Fulfilment settings failed", message, "critical")],
    }, { status: 400 });
  }
};

export default function FulfilmentSettingsPage() {
  const { fulfilmentSettings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const currentSettings = actionData?.fulfilmentSettings || fulfilmentSettings;
  const [mode, setMode] = useState(currentSettings.routePublishFulfilmentMode);
  const [notifyCustomer, setNotifyCustomer] = useState(currentSettings.notifyCustomerOnFulfilment);
  const isSaving = navigation.state !== "idle";
  const actionToasts = actionData?.toasts || (actionData?.error ? [actionToast("Fulfilment settings failed", actionData.error, "critical")] : []);

  useEffect(() => {
    setMode(currentSettings.routePublishFulfilmentMode);
    setNotifyCustomer(currentSettings.notifyCustomerOnFulfilment);
  }, [currentSettings.routePublishFulfilmentMode, currentSettings.notifyCustomerOnFulfilment]);

  return (
    <Page title="Fulfilment settings" backAction={{ content: "Settings", url: "/app/settings" }}>
      <AdminToastStack messages={actionToasts} />
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
                {actionData?.error ? <Text as="p" tone="critical">{actionData.error}</Text> : null}
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
                <Button submit variant="primary" loading={isSaving} disabled={isSaving}>{isSaving ? "Saving..." : "Save fulfilment settings"}</Button>
              </BlockStack>
            </Form>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
