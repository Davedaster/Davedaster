import { Page, Layout, LegacyCard, Text } from "@shopify/polaris";

export default function Routes() {
  return (
    <Page title="Routes">
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <Text as="p" variant="bodyMd">Routes placeholder content.</Text>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
