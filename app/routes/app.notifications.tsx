import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, Layout, LegacyCard, Text, BlockStack, Badge, Divider, InlineStack } from "@shopify/polaris";

import {
  isResendEnabled,
  isTwilioEnabled,
} from "../lib/notificationSenders.server";
import {
  buildBookedSlotMessage,
  buildDelayMessage,
  buildDeliveryCompleteMessage,
  buildNextDropTrackingMessage,
  buildOutForDeliveryMessage,
} from "../lib/notificationTemplates.server";
import { authenticate } from "../shopify.server";

const previewInput = {
  customerName: "Chris",
  orderNumber: "#1234",
  routeName: "Devon route",
  driverName: "Ashley",
  deliveryDate: new Date("2026-05-14T05:00:00.000Z"),
  estimatedArrival: new Date("2026-05-14T09:30:00.000Z"),
  slotMinutes: 60,
  trackingUrl: "https://www.bathroompanelsdirect.co.uk/apps/track/example",
  proofPhotoUrl: "https://example.com/proof-of-delivery-photo.jpg",
};

function buildPreviews() {
  return [
    {
      title: "Booked slot",
      sms: buildBookedSlotMessage(previewInput, "sms"),
      email: buildBookedSlotMessage(previewInput, "email"),
    },
    {
      title: "Out for delivery",
      sms: buildOutForDeliveryMessage(previewInput, "sms"),
      email: buildOutForDeliveryMessage(previewInput, "email"),
    },
    {
      title: "Next drop tracking",
      sms: buildNextDropTrackingMessage(previewInput, "sms"),
      email: buildNextDropTrackingMessage(previewInput, "email"),
    },
    {
      title: "Delay, 45 minutes",
      sms: buildDelayMessage({ ...previewInput, delayMinutes: 45 }, "sms"),
      email: buildDelayMessage({ ...previewInput, delayMinutes: 45 }, "email"),
    },
    {
      title: "Delay, 90 minutes",
      sms: buildDelayMessage({ ...previewInput, delayMinutes: 90 }, "sms"),
      email: buildDelayMessage({ ...previewInput, delayMinutes: 90 }, "email"),
    },
    {
      title: "Delivery complete",
      sms: buildDeliveryCompleteMessage(previewInput, "sms"),
      email: buildDeliveryCompleteMessage(previewInput, "email"),
    },
  ];
}

function MessagePreview({ body }: { body: string }) {
  return (
    <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>
      {body}
    </pre>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return json({
    twilioEnabled: isTwilioEnabled(),
    resendEnabled: isResendEnabled(),
    previews: buildPreviews(),
  });
};

export default function Notifications() {
  const { twilioEnabled, resendEnabled, previews } = useLoaderData<typeof loader>();

  return (
    <Page title="Notifications">
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Customer message templates</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Twilio and Resend sender helpers are now ready. Actual route message sending will stay behind a manual Send notifications button in a later milestone.
              </Text>
              <InlineStack gap="200">
                <Badge tone={twilioEnabled ? "success" : "warning"}>
                  {`Twilio ${twilioEnabled ? "enabled" : "not set up"}`}
                </Badge>
                <Badge tone={resendEnabled ? "success" : "warning"}>
                  {`Resend ${resendEnabled ? "enabled" : "not set up"}`}
                </Badge>
              </InlineStack>
            </BlockStack>
          </LegacyCard>

          {previews.map((preview) => (
            <LegacyCard key={preview.title} sectioned>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">{preview.title}</Text>
                <Badge tone="info">SMS</Badge>
                <MessagePreview body={preview.sms.body} />
                <Divider />
                <Badge tone="success">Email</Badge>
                {preview.email.subject ? (
                  <Text as="p" variant="bodyMd" fontWeight="bold">
                    Subject: {preview.email.subject}
                  </Text>
                ) : null}
                <MessagePreview body={preview.email.body} />
              </BlockStack>
            </LegacyCard>
          ))}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
