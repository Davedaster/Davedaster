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

import {
  getAppCredentials,
  getStoredAppCredentials,
  hasGetAddressCredentials,
  hasProofPhotoStorageCredentials,
  hasResendCredentials,
  hasRouteXLCredentials,
  hasTomTomCredentials,
  hasTwilioCredentials,
  saveAppCredentialsPatch,
  type AppCredentials,
} from "../lib/appCredentials.server";
import { getRouteSettings, saveRouteSettings } from "../lib/routeSettings.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const [routeSettings, storedCredentials, effectiveCredentials] = await Promise.all([
    getRouteSettings(),
    getStoredAppCredentials(),
    getAppCredentials(),
  ]);

  return json({
    routeSettings,
    storedCredentials,
    credentialStatus: {
      routexlEnabled: hasRouteXLCredentials(effectiveCredentials),
      tomtomEnabled: hasTomTomCredentials(effectiveCredentials),
      getAddressEnabled: hasGetAddressCredentials(effectiveCredentials),
      twilioEnabled: hasTwilioCredentials(effectiveCredentials),
      resendEnabled: hasResendCredentials(effectiveCredentials),
      proofPhotoStorageEnabled: hasProofPhotoStorageCredentials(effectiveCredentials),
      shopPublicUrlEnabled: Boolean(effectiveCredentials.shopPublicUrl),
    },
  });
};

function formValue(formData: FormData, key: keyof AppCredentials) {
  return String(formData.get(key) || "").trim();
}

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "saveRouteSettings");

  if (intent === "saveTomTom") {
    await saveAppCredentialsPatch({ tomtomApiKey: formValue(formData, "tomtomApiKey") });
    return json({ ok: true, savedSection: "TomTom" });
  }

  if (intent === "saveGetAddress") {
    await saveAppCredentialsPatch({ getAddressApiKey: formValue(formData, "getAddressApiKey") });
    return json({ ok: true, savedSection: "getAddress.io" });
  }

  if (intent === "saveRouteXL") {
    await saveAppCredentialsPatch({
      routexlUsername: formValue(formData, "routexlUsername"),
      routexlPassword: formValue(formData, "routexlPassword"),
    });
    return json({ ok: true, savedSection: "RouteXL" });
  }

  if (intent === "saveTwilio") {
    await saveAppCredentialsPatch({
      twilioAccountSid: formValue(formData, "twilioAccountSid"),
      twilioAuthToken: formValue(formData, "twilioAuthToken"),
      twilioFromNumber: formValue(formData, "twilioFromNumber"),
    });
    return json({ ok: true, savedSection: "Twilio" });
  }

  if (intent === "saveResend") {
    await saveAppCredentialsPatch({
      resendApiKey: formValue(formData, "resendApiKey"),
      resendFromEmail: formValue(formData, "resendFromEmail"),
    });
    return json({ ok: true, savedSection: "Resend" });
  }

  if (intent === "saveProofPhotoStorage") {
    await saveAppCredentialsPatch({
      proofPhotoStorageEndpoint: formValue(formData, "proofPhotoStorageEndpoint"),
      proofPhotoStorageRegion: formValue(formData, "proofPhotoStorageRegion"),
      proofPhotoStorageBucket: formValue(formData, "proofPhotoStorageBucket"),
      proofPhotoStorageAccessKeyId: formValue(formData, "proofPhotoStorageAccessKeyId"),
      proofPhotoStorageSecretAccessKey: formValue(formData, "proofPhotoStorageSecretAccessKey"),
      proofPhotoPublicBaseUrl: formValue(formData, "proofPhotoPublicBaseUrl"),
    });
    return json({ ok: true, savedSection: "Proof photo storage" });
  }

  if (intent === "saveTrackingUrl") {
    await saveAppCredentialsPatch({ shopPublicUrl: formValue(formData, "shopPublicUrl") });
    return json({ ok: true, savedSection: "Tracking URL" });
  }

  const routeSettings = await saveRouteSettings({
    plannedStartTime: String(formData.get("plannedStartTime") || ""),
    timePerDropMinutes: Number(formData.get("timePerDropMinutes") || 10),
    customerSlotMinutes: Number(formData.get("customerSlotMinutes") || 60),
    startAddress: String(formData.get("startAddress") || ""),
    finishAddress: String(formData.get("finishAddress") || ""),
    returnToBaseDefault: String(formData.get("returnToBaseDefault") || "") === "true",
  });

  return json({ ok: true, routeSettings, savedSection: "Route settings" });
};

function statusBadge(enabled: boolean, label: string) {
  return <Badge tone={enabled ? "success" : "warning"}>{`${label} ${enabled ? "enabled" : "not set up"}`}</Badge>;
}

export default function Settings() {
  const { routeSettings, storedCredentials, credentialStatus } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const currentSettings = actionData && "routeSettings" in actionData && actionData.routeSettings ? actionData.routeSettings : routeSettings;
  const [credentials, setCredentials] = useState(storedCredentials);
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

  useEffect(() => {
    setCredentials(storedCredentials);
  }, [storedCredentials]);

  const setCredential = (key: keyof AppCredentials) => (value: string) => {
    setCredentials((currentCredentials) => ({ ...currentCredentials, [key]: value }));
  };

  return (
    <Page title="Settings">
      <Layout>
        <Layout.Section>
          <LegacyCard title="Route Planning Defaults" sectioned>
            <Form method="post">
              <input type="hidden" name="intent" value="saveRouteSettings" />
              <BlockStack gap="400">
                <Text as="p" variant="bodyMd" tone="subdued">
                  These values are used automatically on the Orders Map when building a new delivery route. The default start and finish location should normally be the Newton Abbot depot.
                </Text>

                {actionData?.ok && actionData.savedSection === "Route settings" ? (
                  <Badge tone="success">Route settings saved</Badge>
                ) : null}

                <FormLayout>
                  <FormLayout.Group>
                    <TextField label="Default driver start time" name="plannedStartTime" value={plannedStartTime} onChange={setPlannedStartTime} type="time" autoComplete="off" />
                    <TextField label="Default minutes per drop" name="timePerDropMinutes" value={timePerDropMinutes} onChange={setTimePerDropMinutes} type="number" autoComplete="off" />
                  </FormLayout.Group>
                  <TextField label="Default customer delivery slot minutes" name="customerSlotMinutes" value={customerSlotMinutes} onChange={setCustomerSlotMinutes} type="number" autoComplete="off" helpText="60 means customers get a one hour delivery slot." />
                  <TextField label="Default start address" name="startAddress" value={startAddress} onChange={setStartAddress} multiline={2} autoComplete="off" />
                  <Checkbox label="Return to base by default" checked={returnToBaseDefault} onChange={setReturnToBaseDefault} helpText="When ticked, planning optimisation includes the finish address in total route miles and time." />
                  <input type="hidden" name="returnToBaseDefault" value={returnToBaseDefault ? "true" : "false"} />
                  <TextField label="Default finish address" name="finishAddress" value={finishAddress} onChange={setFinishAddress} multiline={2} autoComplete="off" helpText="Usually the same as the start address, unless the driver normally finishes somewhere else." />
                  <Button submit variant="primary">Save route settings</Button>
                </FormLayout>
              </BlockStack>
            </Form>
          </LegacyCard>

          <LegacyCard title="API Credentials" sectioned>
            <BlockStack gap="500">
              <Text as="p" variant="bodyMd" tone="subdued">
                Save credentials here instead of editing Railway variables. Existing Railway values are still used as a fallback, but they are not shown in the boxes for security.
              </Text>
              {actionData?.ok && actionData.savedSection !== "Route settings" ? (
                <Badge tone="success">{actionData.savedSection} saved</Badge>
              ) : null}

              <Form method="post">
                <input type="hidden" name="intent" value="saveTomTom" />
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">TomTom</Text>
                    <InlineStack gap="200" blockAlign="center">
                      {statusBadge(credentialStatus.tomtomEnabled, "TomTom")}
                      <Button submit variant="primary">Save</Button>
                    </InlineStack>
                  </InlineStack>
                  <TextField label="TomTom API key" name="tomtomApiKey" value={credentials.tomtomApiKey} onChange={setCredential("tomtomApiKey")} type="password" autoComplete="off" helpText="Used for the live map, route markers and address matching." />
                </BlockStack>
              </Form>

              <Divider />

              <Form method="post">
                <input type="hidden" name="intent" value="saveRouteXL" />
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">RouteXL</Text>
                    <InlineStack gap="200" blockAlign="center">
                      {statusBadge(credentialStatus.routexlEnabled, "RouteXL")}
                      <Button submit variant="primary">Save</Button>
                    </InlineStack>
                  </InlineStack>
                  <FormLayout.Group>
                    <TextField label="RouteXL username" name="routexlUsername" value={credentials.routexlUsername} onChange={setCredential("routexlUsername")} autoComplete="off" />
                    <TextField label="RouteXL password" name="routexlPassword" value={credentials.routexlPassword} onChange={setCredential("routexlPassword")} type="password" autoComplete="off" />
                  </FormLayout.Group>
                </BlockStack>
              </Form>

              <Divider />

              <Form method="post">
                <input type="hidden" name="intent" value="saveGetAddress" />
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">getAddress.io</Text>
                    <InlineStack gap="200" blockAlign="center">
                      {statusBadge(credentialStatus.getAddressEnabled, "getAddress.io")}
                      <Button submit variant="primary">Save</Button>
                    </InlineStack>
                  </InlineStack>
                  <TextField label="getAddress.io API key" name="getAddressApiKey" value={credentials.getAddressApiKey} onChange={setCredential("getAddressApiKey")} type="password" autoComplete="off" helpText="Kept here for address lookup support if we switch the lookup back on." />
                </BlockStack>
              </Form>

              <Divider />

              <Form method="post">
                <input type="hidden" name="intent" value="saveTwilio" />
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">Twilio SMS</Text>
                    <InlineStack gap="200" blockAlign="center">
                      {statusBadge(credentialStatus.twilioEnabled, "Twilio")}
                      <Button submit variant="primary">Save</Button>
                    </InlineStack>
                  </InlineStack>
                  <TextField label="Account SID" name="twilioAccountSid" value={credentials.twilioAccountSid} onChange={setCredential("twilioAccountSid")} autoComplete="off" />
                  <TextField label="Auth token" name="twilioAuthToken" value={credentials.twilioAuthToken} onChange={setCredential("twilioAuthToken")} type="password" autoComplete="off" />
                  <TextField label="From number" name="twilioFromNumber" value={credentials.twilioFromNumber} onChange={setCredential("twilioFromNumber")} autoComplete="off" />
                </BlockStack>
              </Form>

              <Divider />

              <Form method="post">
                <input type="hidden" name="intent" value="saveResend" />
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">Resend Email</Text>
                    <InlineStack gap="200" blockAlign="center">
                      {statusBadge(credentialStatus.resendEnabled, "Resend")}
                      <Button submit variant="primary">Save</Button>
                    </InlineStack>
                  </InlineStack>
                  <TextField label="Resend API key" name="resendApiKey" value={credentials.resendApiKey} onChange={setCredential("resendApiKey")} type="password" autoComplete="off" />
                  <TextField label="From email" name="resendFromEmail" value={credentials.resendFromEmail} onChange={setCredential("resendFromEmail")} type="email" autoComplete="off" />
                </BlockStack>
              </Form>

              <Divider />

              <Form method="post">
                <input type="hidden" name="intent" value="saveProofPhotoStorage" />
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">Proof Photo Storage</Text>
                    <InlineStack gap="200" blockAlign="center">
                      {statusBadge(credentialStatus.proofPhotoStorageEnabled, "Photo storage")}
                      <Button submit variant="primary">Save</Button>
                    </InlineStack>
                  </InlineStack>
                  <TextField label="Storage endpoint" name="proofPhotoStorageEndpoint" value={credentials.proofPhotoStorageEndpoint} onChange={setCredential("proofPhotoStorageEndpoint")} autoComplete="off" />
                  <FormLayout.Group>
                    <TextField label="Region" name="proofPhotoStorageRegion" value={credentials.proofPhotoStorageRegion} onChange={setCredential("proofPhotoStorageRegion")} autoComplete="off" />
                    <TextField label="Bucket" name="proofPhotoStorageBucket" value={credentials.proofPhotoStorageBucket} onChange={setCredential("proofPhotoStorageBucket")} autoComplete="off" />
                  </FormLayout.Group>
                  <TextField label="Access key ID" name="proofPhotoStorageAccessKeyId" value={credentials.proofPhotoStorageAccessKeyId} onChange={setCredential("proofPhotoStorageAccessKeyId")} autoComplete="off" />
                  <TextField label="Secret access key" name="proofPhotoStorageSecretAccessKey" value={credentials.proofPhotoStorageSecretAccessKey} onChange={setCredential("proofPhotoStorageSecretAccessKey")} type="password" autoComplete="off" />
                  <TextField label="Public base URL" name="proofPhotoPublicBaseUrl" value={credentials.proofPhotoPublicBaseUrl} onChange={setCredential("proofPhotoPublicBaseUrl")} autoComplete="off" />
                </BlockStack>
              </Form>

              <Divider />

              <Form method="post">
                <input type="hidden" name="intent" value="saveTrackingUrl" />
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h3" variant="headingMd">Customer Tracking URL</Text>
                    <InlineStack gap="200" blockAlign="center">
                      {statusBadge(credentialStatus.shopPublicUrlEnabled, "Tracking URL")}
                      <Button submit variant="primary">Save</Button>
                    </InlineStack>
                  </InlineStack>
                  <TextField label="Public shop URL" name="shopPublicUrl" value={credentials.shopPublicUrl} onChange={setCredential("shopPublicUrl")} autoComplete="off" helpText="Used when customer SMS and email messages include their tracking link." />
                </BlockStack>
              </Form>
            </BlockStack>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
