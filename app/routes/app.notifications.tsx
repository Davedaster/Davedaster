import { Page, Layout, LegacyCard, Text, BlockStack, Badge, Divider } from "@shopify/polaris";

import {
  buildBookedSlotMessage,
  buildDelayMessage,
  buildDeliveryCompleteMessage,
  buildNextDropTrackingMessage,
  buildOutForDeliveryMessage,
} from "../lib/notificationTemplates.server";

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

const previews = [
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

export default function Notifications() {
  return (
    <Page title="Notifications">
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Customer message templates</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                These are preview templates only. Sending through Twilio and Resend will be added in a later milestone.
              </Text>
            </BlockStack>
          </LegacyCard>

          {previews.map((preview) => (
            <LegacyCard key={preview.title} sectioned>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">{preview.title}</Text>
                <Badge tone="info">SMS</Badge>
                <Text as="pre" variant="bodyMd">
                  {preview.sms.body}
                </Text>
                <Divider />
                <Badge tone="success">Email</Badge>
                {preview.email.subject ? (
                  <Text as="p" variant="bodyMd" fontWeight="bold">
                    Subject: {preview.email.subject}
                  </Text>
                ) : null}
                <Text as="pre" variant="bodyMd">
                  {preview.email.body}
                </Text>
              </BlockStack>
            </LegacyCard>
          ))}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
