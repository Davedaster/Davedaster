import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useActionData } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  Text,
  BlockStack,
  ResourceList,
  ResourceItem,
  Badge,
  TextField,
  Button,
  Select,
  Checkbox,
  FormLayout,
} from "@shopify/polaris";
import { useState } from "react";

import { listStopsForProofOfDelivery, saveProofOfDelivery } from "../lib/proofOfDelivery.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const stops = await listStopsForProofOfDelivery();

  return json({ stops });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const stopId = String(formData.get("stopId") || "").trim();
  const proofPhotoUrl = String(formData.get("proofPhotoUrl") || "").trim();
  const deliveryNote = String(formData.get("deliveryNote") || "").trim();
  const safePlaceNote = String(formData.get("safePlaceNote") || "").trim();
  const leftInSafePlace = String(formData.get("leftInSafePlace") || "") === "true";

  try {
    await saveProofOfDelivery({
      admin,
      stopId,
      proofPhotoUrl,
      deliveryNote,
      safePlaceNote,
      leftInSafePlace,
    });

    return redirect("/app/proof-of-delivery");
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Proof of delivery failed." }, { status: 400 });
  }
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default function ProofOfDelivery() {
  const { stops } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [selectedStopId, setSelectedStopId] = useState(stops[0]?.id || "");
  const [proofPhotoUrl, setProofPhotoUrl] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [safePlaceNote, setSafePlaceNote] = useState("");
  const [leftInSafePlace, setLeftInSafePlace] = useState(false);

  const stopOptions = stops.map((stop) => {
    const orders = stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).join(", ") || "No linked orders";

    return {
      label: `${stop.route.name}, stop ${stop.orderIndex}, ${orders}`,
      value: stop.id,
    };
  });

  return (
    <Page title="Proof of Delivery">
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Mark stop delivered</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Paste the hosted proof photo link, then mark the stop delivered. The link will show on the customer tracking page after delivery.
              </Text>

              {actionData && "error" in actionData ? (
                <Text as="p" variant="bodyMd" tone="critical">{actionData.error}</Text>
              ) : null}

              <Form method="post">
                <FormLayout>
                  <Select
                    label="Stop"
                    name="stopId"
                    options={stopOptions}
                    value={selectedStopId}
                    onChange={setSelectedStopId}
                    disabled={stopOptions.length === 0}
                  />
                  <TextField
                    label="Proof photo link"
                    name="proofPhotoUrl"
                    type="url"
                    value={proofPhotoUrl}
                    onChange={setProofPhotoUrl}
                    autoComplete="off"
                    helpText="Use a hosted image link, not Shopify Files. This avoids cluttering your Shopify file library."
                  />
                  <TextField
                    label="Delivery note"
                    name="deliveryNote"
                    value={deliveryNote}
                    onChange={setDeliveryNote}
                    autoComplete="off"
                    multiline={3}
                  />
                  <Checkbox
                    label="Left in safe place"
                    checked={leftInSafePlace}
                    onChange={setLeftInSafePlace}
                  />
                  <input type="hidden" name="leftInSafePlace" value={leftInSafePlace ? "true" : "false"} />
                  <TextField
                    label="Safe place note"
                    name="safePlaceNote"
                    value={safePlaceNote}
                    onChange={setSafePlaceNote}
                    autoComplete="off"
                    multiline={2}
                  />
                  <Button submit variant="primary" disabled={!selectedStopId || !proofPhotoUrl}>Mark delivered and fulfil Shopify order</Button>
                </FormLayout>
              </Form>
            </BlockStack>
          </LegacyCard>

          <LegacyCard title="Active route stops">
            <ResourceList
              resourceName={{ singular: "stop", plural: "stops" }}
              items={stops}
              renderItem={(stop) => {
                const orders = stop.deliveryGroup?.orders.map((order) => order.shopifyOrderNumber).join(", ") || "No linked orders";
                return (
                  <ResourceItem id={stop.id} accessibilityLabel={`View stop ${stop.orderIndex}`}>
                    <BlockStack gap="100">
                      <Text as="h3" variant="bodyMd" fontWeight="bold">
                        {stop.route.name}, stop {stop.orderIndex}, {orders}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {formatDate(stop.route.date)} · Driver: {stop.route.driver?.name || "No driver"} · {stop.deliveryGroup?.postcode || "No postcode"}
                      </Text>
                      <Badge tone={stop.status === "DELIVERED" ? "success" : "info"}>{stop.status}</Badge>
                    </BlockStack>
                  </ResourceItem>
                );
              }}
            />
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
