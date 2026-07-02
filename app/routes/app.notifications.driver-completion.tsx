import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { Page, Layout, LegacyCard, Text, BlockStack, TextField, Button, Box, InlineStack, Badge } from "@shopify/polaris";
import { useEffect, useState } from "react";

import {
  defaultDriverCompletionMessageTemplate,
  driverCompletionVariables,
  getDriverCompletionMessageTemplate,
  renderDriverCompletionMessage,
  saveDriverCompletionMessageTemplate,
} from "../lib/driverCompletionSettings.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const message = await getDriverCompletionMessageTemplate();

  return json({
    message,
    preview: renderDriverCompletionMessage(message, { driverName: "Chris", routeName: "Devon route", completedStops: 12, totalStops: 12 }),
    variables: driverCompletionVariables(),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "save") {
    await saveDriverCompletionMessageTemplate(String(formData.get("message") || ""));
    return json({ ok: true, saved: "Driver completion pop-up saved" });
  }

  if (intent === "reset") {
    await saveDriverCompletionMessageTemplate(defaultDriverCompletionMessageTemplate());
    return json({ ok: true, saved: "Driver completion pop-up reset" });
  }

  return json({ ok: false, error: "Action was not recognised." }, { status: 400 });
};

function MessagePreview({ body }: { body: string }) {
  return <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit", fontSize: 14 }}>{body}</pre>;
}

export default function DriverCompletionPopupEditor() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [message, setMessage] = useState(data.message);

  useEffect(() => setMessage(data.message), [data.message]);

  return (
    <Page title="Driver last drop pop-up" backAction={{ content: "Notifications", url: "/app/notifications" }}>
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">Driver completion message</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">This appears on the driver's phone after their final delivery has been completed. It is an in app pop-up, not an SMS.</Text>
                </BlockStack>
                <Badge tone="info">Driver app</Badge>
              </InlineStack>

              {actionData?.ok ? <Badge tone="success">{actionData.saved}</Badge> : null}
              {actionData && "error" in actionData ? <Text as="p" tone="critical">{actionData.error}</Text> : null}

              <Form method="post">
                <input type="hidden" name="intent" value="save" />
                <BlockStack gap="300">
                  <TextField label="Pop-up message" name="message" value={message} onChange={setMessage} autoComplete="off" multiline={5} helpText="Use variables like {{ driver.name }} and {{ route.name }}." />
                  <Button submit variant="primary">Save driver pop-up</Button>
                </BlockStack>
              </Form>

              <Form method="post">
                <input type="hidden" name="intent" value="reset" />
                <Button submit>Reset default message</Button>
              </Form>

              <Box background="bg-surface-secondary" padding="300" borderRadius="300">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" fontWeight="bold">Saved preview</Text>
                  <MessagePreview body={data.preview} />
                </BlockStack>
              </Box>

              <BlockStack gap="200">
                <Text as="p" variant="bodySm" fontWeight="bold">Available variables</Text>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{data.variables.map((variable) => <code key={variable} style={{ background: "#f2f4f7", padding: "4px 7px", borderRadius: 8 }}>{variable}</code>)}</div>
              </BlockStack>
            </BlockStack>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
