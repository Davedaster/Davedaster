import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  FormLayout,
  TextField,
  Text,
  Divider,
  Button,
  Checkbox,
  BlockStack,
  Badge,
  InlineStack,
} from "@shopify/polaris";
import { useEffect, useState } from "react";

import { getRouteSettings, saveRouteSettings } from "../lib/routeSettings.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const routeSettings = await getRouteSettings();

  return json({
    routeSettings,
    routexlEnabled: Boolean(process.env.ROUTEXL_USERNAME && process.env.ROUTEXL_PASSWORD),
    getAddressEnabled: Boolean(process.env.GETADDRESS_API_KEY),
    twilioEnabled: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    resendEnabled: Boolean(process.env.RESEND_API_KEY),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();

  const routeSettings = await saveRouteSettings({
    plannedStartTime: String(formData.get("plannedStartTime") || ""),
    timePerDropMinutes: Number(formData.get("timePerDropMinutes") || 10),
    customerSlotMinutes: Number(formData.get("customerSlotMinutes") || 60),
    startAddress: String(formData.get("startAddress") || ""),
    finishAddress: String(formData.get("finishAddress") || ""),
    returnToBaseDefault: String(formData.get("returnToBaseDefault") || "") === "true",
  });

  return json({ ok: true, routeSettings });
};

export default function Settings() {
  const { routeSettings, routexlEnabled, getAddressEnabled, twilioEnabled, resendEnabled } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const currentSettings = actionData?.ok ? actionData.routeSettings : routeSettings;
  const [plannedStartTime, setPlannedStartTime] = useState(currentSettings.plannedStartTime);
  const [timePerDropMinutes, setTimePerDropMinutes] = useState(String(currentSettings.timePerDropMinutes));
  const [customerSlotMinutes, setCustomerSlotMinutes] = useState(String(currentSettings.customerSlotMinutes));
  const [startAddress, setStartAddress] = useState(currentSettings.startAddress);
  const [finishAddress, setFinishAddress] = useState(currentSettings.finishAddress);
  const [returnToBaseDefault, setReturnToBaseDefault] = useState(currentSettings.returnToBaseDefault);

  useEffect(() => {
    setPlannedStartTime(currentSettings.plannedStartTime);
    setTimePerDropMinutes(String(currentSettings.timePerDropMinutes));
    setCustomerSlotMinutes(String(currentSettings.customerSlotMinutes));
    setStartAddress(currentSettings.startAddress);
    setFinishAddress(currentSettings.finishAddress);
    setReturnToBaseDefault(currentSettings.returnToBaseDefault);
  }, [currentSettings]);

  return (
    <Page title="Settings">
      <Layout>
        <Layout.Section>
          <LegacyCard title="Route Planning Defaults" sectioned>
            <Form method="post">
              <BlockStack gap="400">
                <Text as="p" variant="bodyMd" tone="subdued">
                  These values are used automatically on the Orders Map when building a new delivery route. The default start and finish location should normally be the Newton Abbot depot.
                </Text>

                {actionData?.ok ? (
                  <Badge tone="success">Route settings saved</Badge>
                ) : null}

                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Default driver start time"
                      name="plannedStartTime"
                      value={plannedStartTime}
                      onChange={setPlannedStartTime}
                      type="time"
                      autoComplete="off"
                    />
                    <TextField
                      label="Default minutes per drop"
                      name="timePerDropMinutes"
                      value={timePerDropMinutes}
                      onChange={setTimePerDropMinutes}
                      type="number"
                      autoComplete="off"
                    />
                  </FormLayout.Group>
                  <TextField
                    label="Default customer delivery slot minutes"
                    name="customerSlotMinutes"
                    value={customerSlotMinutes}
                    onChange={setCustomerSlotMinutes}
                    type="number"
                    autoComplete="off"
                    helpText="60 means customers get a one hour delivery slot."
                  />
                  <TextField
                    label="Default start address"
                    name="startAddress"
                    value={startAddress}
                    onChange={setStartAddress}
                    multiline={2}
                    autoComplete="off"
                  />
                  <Checkbox
                    label="Return to base by default"
                    checked={returnToBaseDefault}
                    onChange={setReturnToBaseDefault}
                    helpText="When ticked, planning optimisation includes the finish address in total route miles and time."
                  />
                  <input type="hidden" name="returnToBaseDefault" value={returnToBaseDefault ? "true" : "false"} />
                  <TextField
                    label="Default finish address"
                    name="finishAddress"
                    value={finishAddress}
                    onChange={setFinishAddress}
                    multiline={2}
                    autoComplete="off"
                    helpText="Usually the same as the start address, unless the driver normally finishes somewhere else."
                  />
                  <Button submit variant="primary">Save route settings</Button>
                </FormLayout>
              </BlockStack>
            </Form>
          </LegacyCard>

          <LegacyCard title="API Credentials" sectioned>
            <FormLayout>
              <Text as="h3" variant="headingMd">RouteXL</Text>
              <InlineStack gap="200">
                <Badge tone={routexlEnabled ? "success" : "warning"}>{`RouteXL ${routexlEnabled ? "enabled" : "not set up"}`}</Badge>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                RouteXL credentials are still read from the app environment for security.
              </Text>
              <Divider />
              <Text as="h3" variant="headingMd">getAddress.io</Text>
              <Badge tone={getAddressEnabled ? "success" : "warning"}>{`getAddress.io ${getAddressEnabled ? "enabled" : "not set up"}`}</Badge>
              <Divider />
              <Text as="h3" variant="headingMd">Twilio (SMS)</Text>
              <Badge tone={twilioEnabled ? "success" : "warning"}>{`Twilio ${twilioEnabled ? "enabled" : "not set up"}`}</Badge>
              <Divider />
              <Text as="h3" variant="headingMd">Resend (Email)</Text>
              <Badge tone={resendEnabled ? "success" : "warning"}>{`Resend ${resendEnabled ? "enabled" : "not set up"}`}</Badge>
            </FormLayout>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
