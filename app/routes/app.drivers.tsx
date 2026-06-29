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
  InlineStack,
} from "@shopify/polaris";
import { useMemo, useState } from "react";

import { createDriver, listDrivers } from "../lib/drivers.server";
import { authenticate } from "../shopify.server";

type ShopifyImageFile = {
  id: string;
  label: string;
  url: string;
};

type ShopifyImageFilesPayload = {
  data?: {
    files?: {
      edges: Array<{
        node: {
          id: string;
          image?: {
            url?: string | null;
            altText?: string | null;
          } | null;
        };
      }>;
    };
  };
  errors?: Array<{ message: string }>;
};

const DRIVER_IMAGE_FILES_QUERY = `#graphql
  query DriverImageFiles {
    files(first: 50, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          ... on MediaImage {
            image {
              url
              altText
            }
          }
        }
      }
    }
  }
`;

function fileNameFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split("/").filter(Boolean).pop() || "Shopify image";

    return decodeURIComponent(filename).replace(/[-_]+/g, " ");
  } catch {
    return "Shopify image";
  }
}

async function listShopifyImageFiles(admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"]): Promise<ShopifyImageFile[]> {
  try {
    const response = await admin.graphql(DRIVER_IMAGE_FILES_QUERY);
    const payload = await response.json() as ShopifyImageFilesPayload;

    if (payload.errors?.length) {
      console.warn("Shopify image files lookup failed", payload.errors.map((error) => error.message).join(", "));
      return [];
    }

    return (payload.data?.files?.edges || [])
      .map((edge) => {
        const url = edge.node.image?.url || "";

        if (!url) {
          return null;
        }

        return {
          id: edge.node.id,
          url,
          label: edge.node.image?.altText || fileNameFromUrl(url),
        };
      })
      .filter((file): file is ShopifyImageFile => Boolean(file));
  } catch (error) {
    console.warn("Shopify image files lookup crashed", error instanceof Error ? error.message : String(error));
    return [];
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const [drivers, shopifyImageFiles] = await Promise.all([
    listDrivers(),
    listShopifyImageFiles(admin),
  ]);

  return json({ drivers, shopifyImageFiles });
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
  const { drivers, shopifyImageFiles } = useLoaderData<typeof loader>();
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [vehicleName, setVehicleName] = useState("");
  const [vehicleRegistration, setVehicleRegistration] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [fuelCardNumber, setFuelCardNumber] = useState("");
  const [fuelCardProvider, setFuelCardProvider] = useState("");
  const [startAddress, setStartAddress] = useState("");
  const [endAddress, setEndAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [activeStatus, setActiveStatus] = useState("true");

  const photoOptions = useMemo(() => {
    const options = [
      { label: "No driver photo", value: "" },
      ...shopifyImageFiles.map((file) => ({
        label: file.label,
        value: file.url,
      })),
    ];

    if (photoUrl && !options.some((option) => option.value === photoUrl)) {
      options.push({ label: "Custom image URL", value: photoUrl });
    }

    return options;
  }, [photoUrl, shopifyImageFiles]);

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
                    onClick={() => {}}
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
                  <TextField label="Driver name" name="name" value={name} onChange={setName} autoComplete="off" />
                  <TextField label="Phone number" name="phoneNumber" value={phoneNumber} onChange={setPhoneNumber} type="tel" autoComplete="off" />
                  <TextField label="Email address" name="email" value={email} onChange={setEmail} type="email" autoComplete="off" />
                  <Select
                    label="Driver photo from Shopify files"
                    name="photoUrl"
                    options={photoOptions}
                    value={photoUrl}
                    onChange={setPhotoUrl}
                    helpText={shopifyImageFiles.length ? "Choose an image already uploaded to Shopify files." : "No Shopify image files were found, or the app does not have file access."}
                  />
                  <TextField
                    label="Or paste driver photo URL"
                    value={photoUrl}
                    onChange={setPhotoUrl}
                    type="url"
                    autoComplete="off"
                    helpText="The saved URL is used on customer tracking when this driver is assigned to a route."
                  />
                  {photoUrl ? (
                    <InlineStack gap="200" blockAlign="center">
                      <Avatar customer name={name || "Driver"} source={photoUrl} />
                      <Text as="span" variant="bodySm" tone="subdued">Photo preview</Text>
                    </InlineStack>
                  ) : null}
                  <TextField label="Vehicle name" name="vehicleName" value={vehicleName} onChange={setVehicleName} autoComplete="off" />
                  <TextField label="Vehicle registration" name="vehicleRegistration" value={vehicleRegistration} onChange={setVehicleRegistration} autoComplete="off" />
                  <TextField label="Vehicle type" name="vehicleType" value={vehicleType} onChange={setVehicleType} autoComplete="off" />
                  <TextField label="Fuel card number" name="fuelCardNumber" value={fuelCardNumber} onChange={setFuelCardNumber} autoComplete="off" helpText="Admin only" />
                  <TextField label="Fuel card provider" name="fuelCardProvider" value={fuelCardProvider} onChange={setFuelCardProvider} autoComplete="off" helpText="Admin only" />
                  <TextField label="Start address" name="startAddress" value={startAddress} onChange={setStartAddress} autoComplete="off" multiline={2} />
                  <TextField label="End address" name="endAddress" value={endAddress} onChange={setEndAddress} autoComplete="off" multiline={2} />
                  <TextField label="Driver notes" name="notes" value={notes} onChange={setNotes} autoComplete="off" multiline={3} />
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
                  <Button submit variant="primary" disabled={!name.trim()}>Save driver</Button>
                </FormLayout>
              </BlockStack>
            </Form>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
