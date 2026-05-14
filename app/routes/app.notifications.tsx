import { Page, Layout, LegacyCard, Text } from "@shopify/polaris";

export default function Notifications() {
  return (
    <Page title="Notifications">
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <Text as="p" variant="bodyMd">Notifications placeholder content.</Text>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
