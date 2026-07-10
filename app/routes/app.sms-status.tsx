import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Box, InlineStack, Layout, LegacyCard, Page, Text } from "@shopify/polaris";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const deliveries = await prisma.smsDelivery.findMany({
    orderBy: {
      createdAt: "desc",
    },
    take: 100,
  });

  return json({
    deliveries: deliveries.map((delivery) => ({
      ...delivery,
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
      submittedAt: delivery.submittedAt?.toISOString() || null,
      deliveredAt: delivery.deliveredAt?.toISOString() || null,
    })),
  });
};

function maskedRecipient(recipient: string) {
  if (recipient.length <= 7) {
    return recipient;
  }

  return `${recipient.slice(0, 3)}••••${recipient.slice(-4)}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(new Date(value));
}

function StatusBadge({ status }: { status: string }) {
  if (status === "DELIVERED") {
    return <Badge tone="success">Delivered</Badge>;
  }

  if (status === "UNDELIVERED" || status === "FAILED" || status === "CANCELED") {
    return <Badge tone="critical">{status === "UNDELIVERED" ? "Undelivered" : status === "CANCELED" ? "Cancelled" : "Failed"}</Badge>;
  }

  if (status === "SENT") {
    return <Badge tone="info">Sent to network</Badge>;
  }

  return <Badge tone="attention">{status.toLowerCase().replaceAll("_", " ")}</Badge>;
}

export default function SmsStatus() {
  const { deliveries } = useLoaderData<typeof loader>();
  const delivered = deliveries.filter((delivery) => delivery.status === "DELIVERED").length;
  const failed = deliveries.filter((delivery) => ["FAILED", "UNDELIVERED", "CANCELED"].includes(delivery.status)).length;
  const pending = deliveries.length - delivered - failed;

  return (
    <Page title="SMS delivery status" backAction={{ content: "Notifications", url: "/app/notifications" }}>
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Recent Twilio delivery results</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Submitted means Twilio accepted the request. Delivered confirms the mobile network reported delivery. Filtered or opted-out messages appear as undelivered with an error code.
              </Text>
              <InlineStack gap="200">
                <Badge tone="success">{`${delivered} delivered`}</Badge>
                <Badge tone="attention">{`${pending} pending`}</Badge>
                <Badge tone={failed ? "critical" : "success"}>{`${failed} failed or undelivered`}</Badge>
              </InlineStack>
            </BlockStack>
          </LegacyCard>

          {deliveries.length ? deliveries.map((delivery) => (
            <LegacyCard key={delivery.id} sectioned>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingSm">{maskedRecipient(delivery.recipient)}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{formatDateTime(delivery.createdAt)}</Text>
                  </BlockStack>
                  <StatusBadge status={delivery.status} />
                </InlineStack>

                <Box background="bg-surface-secondary" padding="300" borderRadius="300">
                  <Text as="p" variant="bodySm">{delivery.bodyPreview}</Text>
                </Box>

                <InlineStack gap="300" wrap>
                  <Text as="p" variant="bodySm" tone="subdued">{`SID: ${delivery.twilioSid || "Waiting for Twilio"}`}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{`Segments: ${delivery.numSegments || "Unknown"}`}</Text>
                </InlineStack>

                {delivery.errorCode || delivery.errorMessage ? (
                  <Box background="bg-surface-critical" padding="300" borderRadius="300">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" fontWeight="bold" tone="critical">{`Twilio error ${delivery.errorCode || "unknown"}`}</Text>
                      {delivery.errorMessage ? <Text as="p" variant="bodySm" tone="critical">{delivery.errorMessage}</Text> : null}
                    </BlockStack>
                  </Box>
                ) : null}
              </BlockStack>
            </LegacyCard>
          )) : (
            <LegacyCard sectioned>
              <Text as="p" variant="bodyMd" tone="subdued">No SMS attempts have been recorded yet.</Text>
            </LegacyCard>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
