import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
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
  Box,
} from "@shopify/polaris";
import { useMemo, useState } from "react";

import { createDriver, deleteDriver, listDrivers, updateDriver, type DriverInput } from "../lib/drivers.server";
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

type DriverFormValues = {
  name: string;
  phoneNumber: string;
  email: string;
  photoUrl: string;
  vehicleName: string;
  vehicleRegistration: string;
  vehicleType: string;
  fuelCardNumber: string;
  fuelCardProvider: string;
  startAddress: string;
  endAddress: string;
  notes: string;
  isActive: string;
};

const emptyDriverForm: DriverFormValues = {
  name: "",
  phoneNumber: "",
  email: "",
  photoUrl: "",
  vehicleName: "",
  vehicleRegistration: "",
  vehicleType: "",
  fuelCardNumber: "",
  fuelCardProvider: "",
  startAddress: "",
  endAddress: "",
  notes: "",
  isActive: "true",
};

const DRIVER_PHONE_HELP = "For UK mobiles, 07123 456789 is fine. The app converts it to +44 before sending SMS.";

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

function driverInputFromForm(formData: FormData): DriverInput {
  return {
    name: String(formData.get("name") || "").trim(),
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
  };
}

function buildPhotoOptions(photoUrl: string, shopifyImageFiles: ShopifyImageFile[]) {
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
  const intent = String(formData.get("intent") || "createDriver");

  if (intent === "deleteDriver") {
    const driverId = String(formData.get("driverId") || "").trim();

    if (!driverId) {
      return json({ ok: false, error: "Driver could not be found." }, { status: 400 });
    }

    await deleteDriver(driverId);
    return redirect("/app/drivers");
  }

  const driverInput = driverInputFromForm(formData);

  if (!driverInput.name) {
    return json({ ok: false, error: "Driver name is required." }, { status: 400 });
  }

  if (intent === "updateDriver") {
    const driverId = String(formData.get("driverId") || "").trim();

    if (!driverId) {
      return json({ ok: false, error: "Driver could not be found." }, { status: 400 });
    }

    await updateDriver(driverId, driverInput);
    return redirect("/app/drivers");
  }

  await createDriver(driverInput);

  return redirect("/app/drivers");
};

export default function Drivers() {
  const { drivers, shopifyImageFiles } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [createForm, setCreateForm] = useState<DriverFormValues>(emptyDriverForm);
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<DriverFormValues | null>(null);

  const createPhotoOptions = useMemo(() => buildPhotoOptions(createForm.photoUrl, shopifyImageFiles), [createForm.photoUrl, shopifyImageFiles]);

  const resourceName = {
    singular: "driver",
    plural: "drivers",
  };

  const updateCreateField = (field: keyof DriverFormValues) => (value: string) => {
    setCreateForm((currentForm) => ({ ...currentForm, [field]: value }));
  };

  const updateEditField = (field: keyof DriverFormValues) => (value: string) => {
    setEditForm((currentForm) => currentForm ? { ...currentForm, [field]: value } : currentForm);
  };

  const startEditing = (driver: typeof drivers[number]) => {
    setEditingDriverId(driver.id);
    setEditForm({
      name: driver.name || "",
      phoneNumber: driver.phoneNumber || "",
      email: driver.email || "",
      photoUrl: driver.photoUrl || "",
      vehicleName: driver.vehicleName || "",
      vehicleRegistration: driver.vehicleRegistration || "",
      vehicleType: driver.vehicleType || "",
      fuelCardNumber: driver.fuelCardNumber || "",
      fuelCardProvider: driver.fuelCardProvider || "",
      startAddress: driver.startAddress || "",
      endAddress: driver.endAddress || "",
      notes: driver.notes || "",
      isActive: driver.isActive ? "true" : "false",
    });
  };

  const cancelEditing = () => {
    setEditingDriverId(null);
    setEditForm(null);
  };

  return (
    <Page title="Drivers">
      <Layout>
        <Layout.Section>
          <LegacyCard title="Driver profiles">
            <Box padding="400">
              <BlockStack gap="300">
                {actionData && "error" in actionData ? (
                  <Text as="p" variant="bodySm" tone="critical">{actionData.error}</Text>
                ) : null}

                <ResourceList
                  resourceName={resourceName}
                  items={drivers}
                  renderItem={(item) => {
                    const { id, name, photoUrl, vehicleName, vehicleRegistration, isActive } = item;
                    const media = <Avatar customer name={name} source={photoUrl || undefined} />;
                    const isEditing = editingDriverId === id && editForm;

                    return (
                      <ResourceItem
                        id={id}
                        media={media}
                        accessibilityLabel={`View details for ${name}`}
                        onClick={() => {}}
                      >
                        {isEditing ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="updateDriver" />
                            <input type="hidden" name="driverId" value={id} />
                            <BlockStack gap="300">
                              <InlineStack align="space-between" blockAlign="center">
                                <Text variant="bodyMd" fontWeight="bold" as="h3">Edit {name}</Text>
                                <Badge tone={editForm.isActive === "true" ? "success" : "info"}>{editForm.isActive === "true" ? "Active" : "Inactive"}</Badge>
                              </InlineStack>
                              <FormLayout>
                                <TextField label="Driver name" name="name" value={editForm.name} onChange={updateEditField("name")} autoComplete="off" />
                                <TextField label="Phone number" name="phoneNumber" value={editForm.phoneNumber} onChange={updateEditField("phoneNumber")} type="tel" autoComplete="off" helpText={DRIVER_PHONE_HELP} />
                                <TextField label="Email address" name="email" value={editForm.email} onChange={updateEditField("email")} type="email" autoComplete="off" />
                                <Select
                                  label="Driver photo from Shopify files"
                                  name="photoUrl"
                                  options={buildPhotoOptions(editForm.photoUrl, shopifyImageFiles)}
                                  value={editForm.photoUrl}
                                  onChange={updateEditField("photoUrl")}
                                  helpText="Choose an image already uploaded to Shopify files."
                                />
                                <TextField
                                  label="Or paste driver photo URL"
                                  value={editForm.photoUrl}
                                  onChange={updateEditField("photoUrl")}
                                  type="url"
                                  autoComplete="off"
                                />
                                {editForm.photoUrl ? (
                                  <InlineStack gap="200" blockAlign="center">
                                    <Avatar customer name={editForm.name || "Driver"} source={editForm.photoUrl} />
                                    <Text as="span" variant="bodySm" tone="subdued">Photo preview</Text>
                                  </InlineStack>
                                ) : null}
                                <TextField label="Vehicle name" name="vehicleName" value={editForm.vehicleName} onChange={updateEditField("vehicleName")} autoComplete="off" />
                                <TextField label="Vehicle registration" name="vehicleRegistration" value={editForm.vehicleRegistration} onChange={updateEditField("vehicleRegistration")} autoComplete="off" />
                                <TextField label="Vehicle type" name="vehicleType" value={editForm.vehicleType} onChange={updateEditField("vehicleType")} autoComplete="off" />
                                <TextField label="Fuel card number" name="fuelCardNumber" value={editForm.fuelCardNumber} onChange={updateEditField("fuelCardNumber")} autoComplete="off" helpText="Admin only" />
                                <TextField label="Fuel card provider" name="fuelCardProvider" value={editForm.fuelCardProvider} onChange={updateEditField("fuelCardProvider")} autoComplete="off" helpText="Admin only" />
                                <TextField label="Start address" name="startAddress" value={editForm.startAddress} onChange={updateEditField("startAddress")} autoComplete="off" multiline={2} />
                                <TextField label="End address" name="endAddress" value={editForm.endAddress} onChange={updateEditField("endAddress")} autoComplete="off" multiline={2} />
                                <TextField label="Driver notes" name="notes" value={editForm.notes} onChange={updateEditField("notes")} autoComplete="off" multiline={3} />
                                <Select
                                  label="Status"
                                  name="isActive"
                                  options={[
                                    { label: "Active", value: "true" },
                                    { label: "Inactive", value: "false" },
                                  ]}
                                  value={editForm.isActive}
                                  onChange={updateEditField("isActive")}
                                />
                                <InlineStack gap="200">
                                  <Button submit variant="primary" disabled={!editForm.name.trim()}>Save changes</Button>
                                  <Button onClick={cancelEditing}>Cancel</Button>
                                </InlineStack>
                              </FormLayout>
                            </BlockStack>
                          </Form>
                        ) : (
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                            <div>
                              <Text variant="bodyMd" fontWeight="bold" as="h3">
                                {name}
                              </Text>
                              <div>
                                {vehicleName || "No vehicle"}{vehicleRegistration ? ` (${vehicleRegistration})` : ""}
                              </div>
                            </div>
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone={isActive ? "success" : "info"}>
                                {isActive ? "Active" : "Inactive"}
                              </Badge>
                              <Button onClick={() => startEditing(item)}>Edit</Button>
                              <Form method="post">
                                <input type="hidden" name="intent" value="deleteDriver" />
                                <input type="hidden" name="driverId" value={id} />
                                <Button submit tone="critical">Delete</Button>
                              </Form>
                            </InlineStack>
                          </div>
                        )}
                      </ResourceItem>
                    );
                  }}
                />
              </BlockStack>
            </Box>
          </LegacyCard>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <LegacyCard title="Add driver" sectioned>
            <Form method="post">
              <input type="hidden" name="intent" value="createDriver" />
              <BlockStack gap="300">
                <FormLayout>
                  <TextField label="Driver name" name="name" value={createForm.name} onChange={updateCreateField("name")} autoComplete="off" />
                  <TextField label="Phone number" name="phoneNumber" value={createForm.phoneNumber} onChange={updateCreateField("phoneNumber")} type="tel" autoComplete="off" helpText={DRIVER_PHONE_HELP} />
                  <TextField label="Email address" name="email" value={createForm.email} onChange={updateCreateField("email")} type="email" autoComplete="off" />
                  <Select
                    label="Driver photo from Shopify files"
                    name="photoUrl"
                    options={createPhotoOptions}
                    value={createForm.photoUrl}
                    onChange={updateCreateField("photoUrl")}
                    helpText={shopifyImageFiles.length ? "Choose an image already uploaded to Shopify files." : "No Shopify image files were found, or the app does not have file access."}
                  />
                  <TextField
                    label="Or paste driver photo URL"
                    value={createForm.photoUrl}
                    onChange={updateCreateField("photoUrl")}
                    type="url"
                    autoComplete="off"
                    helpText="The saved URL is used on customer tracking when this driver is assigned to a route."
                  />
                  {createForm.photoUrl ? (
                    <InlineStack gap="200" blockAlign="center">
                      <Avatar customer name={createForm.name || "Driver"} source={createForm.photoUrl} />
                      <Text as="span" variant="bodySm" tone="subdued">Photo preview</Text>
                    </InlineStack>
                  ) : null}
                  <TextField label="Vehicle name" name="vehicleName" value={createForm.vehicleName} onChange={updateCreateField("vehicleName")} autoComplete="off" />
                  <TextField label="Vehicle registration" name="vehicleRegistration" value={createForm.vehicleRegistration} onChange={updateCreateField("vehicleRegistration")} autoComplete="off" />
                  <TextField label="Vehicle type" name="vehicleType" value={createForm.vehicleType} onChange={updateCreateField("vehicleType")} autoComplete="off" />
                  <TextField label="Fuel card number" name="fuelCardNumber" value={createForm.fuelCardNumber} onChange={updateCreateField("fuelCardNumber")} autoComplete="off" helpText="Admin only" />
                  <TextField label="Fuel card provider" name="fuelCardProvider" value={createForm.fuelCardProvider} onChange={updateCreateField("fuelCardProvider")} autoComplete="off" helpText="Admin only" />
                  <TextField label="Start address" name="startAddress" value={createForm.startAddress} onChange={updateCreateField("startAddress")} autoComplete="off" multiline={2} />
                  <TextField label="End address" name="endAddress" value={createForm.endAddress} onChange={updateCreateField("endAddress")} autoComplete="off" multiline={2} />
                  <TextField label="Driver notes" name="notes" value={createForm.notes} onChange={updateCreateField("notes")} autoComplete="off" multiline={3} />
                  <Select
                    label="Status"
                    name="isActive"
                    options={[
                      { label: "Active", value: "true" },
                      { label: "Inactive", value: "false" },
                    ]}
                    value={createForm.isActive}
                    onChange={updateCreateField("isActive")}
                  />
                  <Button submit variant="primary" disabled={!createForm.name.trim()}>Save driver</Button>
                </FormLayout>
              </BlockStack>
            </Form>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
