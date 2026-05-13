import {
  Page,
  Layout,
  LegacyCard,
  TextField,
  FormLayout,
  BlockStack,
  Text,
} from "@shopify/polaris";

export default function AreaFilters() {
  return (
    <Page title="Area Filters">
      <Layout>
        <Layout.Section>
          <LegacyCard sectioned>
            <FormLayout>
              <TextField
                label="Cornwall"
                value="TR, PL"
                autoComplete="off"
                helpText="Postcode prefixes for Cornwall"
              />
              <TextField
                label="South West"
                value="EX, TQ, TA, BS, BA"
                autoComplete="off"
                helpText="Postcode prefixes for South West"
              />
              <TextField
                label="Wales"
                value="CF, NP, SA, LL, SY, LD"
                autoComplete="off"
                helpText="Postcode prefixes for Wales"
              />
              <TextField
                label="South East"
                value="BN, RH, TN, ME, CT, SS, CM, CO"
                autoComplete="off"
                helpText="Postcode prefixes for South East"
              />
              <TextField
                label="South"
                value="SO, PO, BH, DT, SP, RG"
                autoComplete="off"
                helpText="Postcode prefixes for South"
              />
              <TextField
                label="Central"
                value="GL, OX, MK, NN, HR, WR, DY, B, CV"
                autoComplete="off"
                helpText="Postcode prefixes for Central"
              />
              <TextField
                label="Northern"
                value="DE, NG, LN, ST, TF, WV, WS, LE"
                autoComplete="off"
                helpText="Postcode prefixes for Northern"
              />
            </FormLayout>
          </LegacyCard>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          <LegacyCard title="About Area Filters" sectioned>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">
                Area filters help you group orders by their postcode prefixes.
              </Text>
              <Text as="p" variant="bodyMd">
                You can add multiple prefixes separated by commas.
              </Text>
            </BlockStack>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
