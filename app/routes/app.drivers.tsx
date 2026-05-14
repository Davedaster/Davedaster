import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  ResourceList,
  ResourceItem,
  Text,
  FormLayout,
  TextField,
  Badge,
  Avatar,
  Button,
  BlockStack,
  Select,
} from "@shopify/polaris";
import { useState } from "react";

import { createDriver, listDrivers } from "../lib/drivers.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const drivers = await listDrivers();

  return json({ drivers });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const name = String(formData.get("name") || "").trim();

  if (!name) {
    return json({ ok: false, error: "Driver name is required." }, { status: 400 });
  }

  await createDriver({
    name,
    phoneNumber: String(formData.get("phoneNumber") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    photoUrl: String(formData.get("photoUrl") || "").trim(),
    vehicleName: String(formData.get("vehicleName") || "").trim(),
    vehicleRegistration: String(formData.get("vehicleRegistration") || "").trim(),
    vehicleType: String(formData.get("vehicleType") || "").trim(),
    fuelCardNumber: String(formData.get("fuelCardNumber") || "").trim(),
    fuelCardProvider: String(formData.get("fuelCardProvider") || "").trim(),
    startAddress: String(formData.get("startAddress") || "").trim(),
    endAddress: String(formData.get("endAddress") || "").trim(),
    notes: String(formData.get("notes") || "").trim(),
    isActive: String(formData.get("isActive") || "true") === "true",
  });

  return redirect("/app/drivers");
};

export default function Drivers() {
  const { drivers } = useLoaderData<typeof loader>();
  const [activeStatus, setActiveStatus] = useState("true");

  const resourceName = {
    singular: "driver",
    plural: "drivers",
  };

  return (
    <Page title="Drivers">
      <Layout>
        <Layout.Section>
          <LegacyCard title="Driver profiles">
            <ResourceList
              resourceName={resourceName}
              items={drivers}
              renderItem={(item) => {
                const { id, name, photoUrl, vehicleName, vehicleRegistration, isActive } = item;
                const media = <Avatar customer name={name} source={photoUrl || undefined} />;

                return (
                  <ResourceItem
                    id={id}
                    media={media}
                    accessibilityLabel={`View details for ${name}`}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <Text variant="bodyMd" fontWeight="bold" as="h3">
                          {name}
                        </Text>
                        <div>
                          {vehicleName || "No vehicle"}{vehicleRegistration ? ` (${vehicleRegistration})` : ""}
                        </div>
                      </div>
                      <Badge tone={isActive ? "success" : "info"}>
                        {isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </ResourceItem>
                );
              }}
            />
          </LegacyCard>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <LegacyCard title="Add driver" sectioned>
            <Form method="post">
              <BlockStack gap="300">
                <FormLayout>
                  <TextField label="Driver name" name="name" autoComplete="off" />
                  <TextField label="Phone number" name="phoneNumber" type="tel" autoComplete="off" />
                  <TextField label="Email address" name="email" type="email" autoComplete="off" />
                  <TextField label="Driver photo URL" name="photoUrl" type="url" autoComplete="off" />
                  <TextField label="Vehicle name" name="vehicleName" autoComplete="off" />
                  <TextField label="Vehicle registration" name="vehicleRegistration" autoComplete="off" />
                  <TextField label="Vehicle type" name="vehicleType" autoComplete="off" />
                  <TextField label="Fuel card number" name="fuelCardNumber" autoComplete="off" helpText="Admin only" />
                  <TextField label="Fuel card provider" name="fuelCardProvider" autoComplete="off" helpText="Admin only" />
                  <TextField label="Start address" name="startAddress" autoComplete="off" multiline={2} />
                  <TextField label="End address" name="endAddress" autoComplete="off" multiline={2} />
                  <TextField label="Driver notes" name="notes" autoComplete="off" multiline={3} />
                  <Select
                    label="Status"
                    name="isActive"
                    options={[
                      { label: "Active", value: "true" },
                      { label: "Inactive", value: "false" },
                    ]}
                    value={activeStatus}
                    onChange={setActiveStatus}
                  />
                  <Button submit variant="primary">Save driver</Button>
                </FormLayout>
              </BlockStack>
            </Form>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
