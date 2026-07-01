import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { Page, Layout, LegacyCard, Text, BlockStack, Badge, Divider, InlineStack, TextField, Button, Box } from "@shopify/polaris";
import { useEffect, useState } from "react";

import {
  isResendEnabled,
  isTwilioEnabled,
  sendSmsWithTwilio,
} from "../lib/notificationSenders.server";
import {
  availableNotificationVariables,
  buildNotificationTemplatePreview,
  listNotificationTemplates,
  resetNotificationTemplate,
  saveNotificationTemplate,
  type EditableNotificationTemplate,
} from "../lib/notificationTemplates.server";
import { authenticate } from "../shopify.server";

const previewInput = {
  customerName: "Chris",
  orderNumber: "#1234",
  itemsSummary: "Gold Vein Marble Luxury Matt panels",
  routeName: "Devon route",
  driverName: "Ashley",
  driverPhotoUrl: "https://cdn.shopify.com/s/files/1/0873/6250/2974/files/driver-preview.jpg",
  driverVehicleName: "BPD van",
  driverVehicleRegistration: "BP24 DPD",
  deliveryDate: new Date("2026-05-14T05:00:00.000Z"),
  estimatedArrival: new Date("2026-05-14T09:30:00.000Z"),
  slotMinutes: 60,
  trackingUrl: "https://www.bathroompanelsdirect.co.uk/apps/track/example",
  proofPhotoUrl: "https://example.com/proof-of-delivery-photo.jpg",
  delayMinutes: 45,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const [twilioEnabled, resendEnabled, templates] = await Promise.all([
    isTwilioEnabled(),
    isResendEnabled(),
    listNotificationTemplates(),
  ]);
  const previews = templates.map((template) => ({
    id: template.id,
    sms: buildNotificationTemplatePreview(previewInput, template, "sms"),
    email: buildNotificationTemplatePreview(previewInput, template, "email"),
  }));

  return json({
    twilioEnabled,
    resendEnabled,
    templates,
    previews,
    variables: availableNotificationVariables(),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");
  const templateId = String(formData.get("templateId") || "");

  if (intent === "sendTestSms") {
    const testPhone = String(formData.get("testPhone") || "").trim();

    if (!testPhone) {
      return json({ ok: false, error: "Enter a phone number to send the test SMS." }, { status: 400 });
    }

    try {
      const result = await sendSmsWithTwilio({
        to: testPhone,
        message: {
          body: "Bathroom Panels Direct SMS test. Your delivery SMS setup is working.",
        },
      });

      return json({ ok: true, savedSection: result.id ? `Test SMS sent, ${result.id}` : "Test SMS sent" });
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Test SMS failed." }, { status: 400 });
    }
  }

  if (intent === "resetTemplate") {
    await resetNotificationTemplate(templateId);
    return json({ ok: true, savedSection: "Template reset" });
  }

  if (intent === "saveTemplate") {
    await saveNotificationTemplate(templateId, {
      emailSubject: String(formData.get("emailSubject") || ""),
      emailHtml: String(formData.get("emailHtml") || ""),
      smsBody: String(formData.get("smsBody") || ""),
    });

    return json({ ok: true, savedSection: "Template saved" });
  }

  return json({ ok: false, error: "Template action was not recognised." }, { status: 400 });
};

function MessagePreview({ body }: { body: string }) {
  return (
    <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit", fontSize: 13 }}>
      {body}
    </pre>
  );
}

function TestSmsCard({ twilioEnabled, sent }: { twilioEnabled: boolean; sent: boolean }) {
  const [testPhone, setTestPhone] = useState("");

  return (
    <LegacyCard title="SMS setup test" sectioned>
      <Form method="post">
        <input type="hidden" name="intent" value="sendTestSms" />
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center" gap="300">
            <BlockStack gap="100">
              <Text as="p" variant="bodyMd">
                Send one test SMS before using route messages with customers.
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Add your Twilio details in Settings, Notifications first. UK numbers can be typed as 07 or +44.
              </Text>
            </BlockStack>
            {sent ? <Badge tone="success">Test sent</Badge> : null}
          </InlineStack>
          <TextField
            label="Test phone number"
            name="testPhone"
            value={testPhone}
            onChange={setTestPhone}
            placeholder="07123 456789"
            autoComplete="off"
            helpText="The app converts UK 07 numbers to +44 before sending to Twilio."
          />
          <Button submit variant="primary" disabled={!twilioEnabled || !testPhone.trim()}>
            Send test SMS
          </Button>
        </BlockStack>
      </Form>
    </LegacyCard>
  );
}

function TemplateEditor({
  template,
  preview,
  isOpen,
  onToggle,
}: {
  template: EditableNotificationTemplate;
  preview: {
    sms: { body: string };
    email: { subject?: string; body: string; html?: string };
  };
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [emailSubject, setEmailSubject] = useState(template.emailSubject);
  const [emailHtml, setEmailHtml] = useState(template.emailHtml);
  const [smsBody, setSmsBody] = useState(template.smsBody);

  useEffect(() => {
    setEmailSubject(template.emailSubject);
    setEmailHtml(template.emailHtml);
    setSmsBody(template.smsBody);
  }, [template]);

  return (
    <LegacyCard sectioned>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" gap="300">
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h3" variant="headingMd">{template.label}</Text>
              <Badge tone={isOpen ? "info" : "attention"}>{isOpen ? "Editing" : "Saved"}</Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">{template.description}</Text>
          </BlockStack>
          <InlineStack gap="200">
            <Button onClick={onToggle}>{isOpen ? "Close" : "Edit"}</Button>
            <Form method="post">
              <input type="hidden" name="intent" value="resetTemplate" />
              <input type="hidden" name="templateId" value={template.id} />
              <Button submit>Reset default</Button>
            </Form>
          </InlineStack>
        </InlineStack>

        {!isOpen ? (
          <Box background="bg-surface-secondary" padding="300" borderRadius="300">
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="bold">Saved preview</Text>
              <Text as="p" variant="bodySm" tone="subdued">{preview.email.subject || "No email subject set"}</Text>
              <MessagePreview body={preview.sms.body} />
            </BlockStack>
          </Box>
        ) : null}

        {isOpen ? (
          <BlockStack gap="400">
            <Form method="post">
              <input type="hidden" name="intent" value="saveTemplate" />
              <input type="hidden" name="templateId" value={template.id} />
              <BlockStack gap="300">
                <TextField label="Email subject" name="emailSubject" value={emailSubject} onChange={setEmailSubject} autoComplete="off" />
                <TextField
                  label="Email HTML template"
                  name="emailHtml"
                  value={emailHtml}
                  onChange={setEmailHtml}
                  autoComplete="off"
                  multiline={14}
                  helpText="Use variables such as {{ customer.name }}. The editor supports simple {% if driver.name %}...{% endif %} sections."
                />
                <TextField label="SMS template" name="smsBody" value={smsBody} onChange={setSmsBody} autoComplete="off" multiline={4} />
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <Text as="p" variant="bodySm" tone="subdued">The preview refreshes after you save.</Text>
                  <Button submit variant="primary">Save {template.label}</Button>
                </InlineStack>
              </BlockStack>
            </Form>

            <Divider />

            <BlockStack gap="300">
              <Text as="h4" variant="headingSm">Saved preview</Text>
              <Text as="p" variant="bodySm" tone="subdued">This shows the last saved version, using example route details.</Text>
              <Badge tone="info">SMS</Badge>
              <Box background="bg-surface-secondary" padding="300" borderRadius="300">
                <MessagePreview body={preview.sms.body} />
              </Box>
              <Badge tone="success">Email</Badge>
              {preview.email.subject ? <Text as="p" variant="bodyMd" fontWeight="bold">Subject: {preview.email.subject}</Text> : null}
              <div style={{ border: "1px solid #d0d5dd", borderRadius: 12, overflow: "hidden", background: "#ffffff" }}>
                <iframe
                  title={`${template.label} email preview`}
                  srcDoc={preview.email.html || preview.email.body}
                  sandbox=""
                  style={{ width: "100%", minHeight: 380, border: 0, display: "block", background: "#ffffff" }}
                />
              </div>
            </BlockStack>
          </BlockStack>
        ) : null}
      </BlockStack>
    </LegacyCard>
  );
}

export default function Notifications() {
  const { twilioEnabled, resendEnabled, templates, previews, variables } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const previewsById = new Map(previews.map((preview) => [preview.id, preview]));
  const [openTemplateId, setOpenTemplateId] = useState<string | null>(templates[0]?.id || null);

  return (
    <Page title="Notifications">
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Customer notification templates</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Edit the SMS text, email subject and HTML email used for delivery updates. Only one template opens at a time, so this page stays easier to work through.
              </Text>
              <InlineStack gap="200">
                <Badge tone={twilioEnabled ? "success" : "warning"}>{`Twilio ${twilioEnabled ? "enabled" : "not set up"}`}</Badge>
                <Badge tone={resendEnabled ? "success" : "warning"}>{`Resend ${resendEnabled ? "enabled" : "not set up"}`}</Badge>
              </InlineStack>
              {actionData?.ok ? <Badge tone="success">{actionData.savedSection}</Badge> : null}
              {actionData && "error" in actionData ? <Text as="p" tone="critical">{actionData.error}</Text> : null}
            </BlockStack>
          </LegacyCard>

          <TestSmsCard twilioEnabled={twilioEnabled} sent={Boolean(actionData?.ok && actionData.savedSection?.startsWith("Test SMS sent"))} />

          <LegacyCard title="Variables" sectioned>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Copy these into subjects, SMS templates or HTML templates. The renderer supports variables and simple if or else sections only.
              </Text>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {variables.map((variable) => <code key={variable} style={{ background: "#f2f4f7", padding: "4px 7px", borderRadius: 8 }}>{variable}</code>)}
              </div>
            </BlockStack>
          </LegacyCard>

          {templates.map((template) => {
            const preview = previewsById.get(template.id);

            if (!preview) {
              return null;
            }

            return (
              <TemplateEditor
                key={template.id}
                template={template}
                preview={preview}
                isOpen={openTemplateId === template.id}
                onToggle={() => setOpenTemplateId(openTemplateId === template.id ? null : template.id)}
              />
            );
          })}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
