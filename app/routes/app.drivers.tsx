import {
  Page,
  Layout,
  LegacyCard,
  ResourceList,
  ResourceItem,
  Text,
  Modal,
  FormLayout,
  TextField,
  Badge,
  Avatar,
  Checkbox,
} from "@shopify/polaris";
import { useState, useCallback } from "react";

export default function Drivers() {
  const [active, setActive] = useState(false);
  const [drivers] = useState([
    {
      id: "1",
      name: "Chris",
      vehicleName: "Ford Transit",
      vehicleRegistration: "AB12 CDE",
      isActive: true,
    },
    {
      id: "2",
      name: "Dave",
      vehicleName: "Mercedes Sprinter",
      vehicleRegistration: "FG34 HIJ",
      isActive: true,
    },
  ]);

  const toggleModal = useCallback(() => setActive((active) => !active), []);

  const resourceName = {
    singular: "driver",
    plural: "drivers",
  };

  return (
    <Page
      title="Drivers"
      primaryAction={{
        content: "Add Driver",
        onAction: toggleModal,
      }}
    >
      <Layout>
        <Layout.Section>
          <LegacyCard>
            <ResourceList
              resourceName={resourceName}
              items={drivers}
              renderItem={(item) => {
                const { id, name, vehicleName, vehicleRegistration, isActive } = item;
                const media = <Avatar customer name={name} />;

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
                          {vehicleName} ({vehicleRegistration})
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
      </Layout>

      <Modal
        open={active}
        onClose={toggleModal}
        title="Add Driver"
        primaryAction={{
          content: "Save",
          onAction: toggleModal,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: toggleModal,
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <FormLayout.Group>
              <TextField label="Driver name" autoComplete="off" />
              <TextField label="Phone number" type="tel" autoComplete="off" />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField label="Email address" type="email" autoComplete="off" />
              <TextField label="Driver photo URL" type="url" autoComplete="off" />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField label="Vehicle name" autoComplete="off" />
              <TextField label="Vehicle registration" autoComplete="off" />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField label="Vehicle type" autoComplete="off" />
              <Checkbox label="Active" checked={true} onChange={() => {}} />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField label="Fuel card number" autoComplete="off" helpText="Admin only" />
              <TextField label="Fuel card provider" autoComplete="off" helpText="Admin only" />
            </FormLayout.Group>
            <FormLayout.Group>
              <TextField label="Start address" autoComplete="off" multiline={2} />
              <TextField label="End address" autoComplete="off" multiline={2} />
            </FormLayout.Group>
            <TextField label="Driver notes" autoComplete="off" multiline={3} />
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
