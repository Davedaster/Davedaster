import { Page, Layout, LegacyCard, Text } from "@shopify/polaris";

export default function ProofOfDelivery() {
  return (
    <Page title="Proof of Delivery">
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <Text as="p" variant="bodyMd">Proof of Delivery placeholder content.</Text>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
