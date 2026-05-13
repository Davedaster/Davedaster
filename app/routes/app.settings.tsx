import {
  Page,
  Layout,
  LegacyCard,
  FormLayout,
  TextField,
  Text,
  Divider,
} from "@shopify/polaris";

export default function Settings() {
  return (
    <Page title="Settings">
      <Layout>
        <Layout.Section>
          <LegacyCard title="API Credentials" sectioned>
            <FormLayout>
              <Text as="h3" variant="headingMd">RouteXL</Text>
              <FormLayout.Group>
                <TextField label="Username" value="Bathroompanelsdirect" autoComplete="off" />
                <TextField label="Password" type="password" autoComplete="off" />
              </FormLayout.Group>
              <Divider />
              <Text as="h3" variant="headingMd">getAddress.io</Text>
              <TextField label="API Key" type="password" autoComplete="off" />
              <Divider />
              <Text as="h3" variant="headingMd">Twilio (SMS)</Text>
              <FormLayout.Group>
                <TextField label="Account SID" type="password" autoComplete="off" />
                <TextField label="Auth Token" type="password" autoComplete="off" />
              </FormLayout.Group>
              <TextField label="From Number" autoComplete="off" />
              <Divider />
              <Text as="h3" variant="headingMd">Resend (Email)</Text>
              <TextField label="API Key" type="password" autoComplete="off" />
              <TextField label="From Email" value="notifications@bathroom-panels-direct.co.uk" autoComplete="off" />
            </FormLayout>
          </LegacyCard>

          <LegacyCard title="Default Route Settings" sectioned>
            <FormLayout>
              <FormLayout.Group>
                <TextField label="Default start time" value="05:00" type="time" autoComplete="off" />
                <TextField label="Default stop time (mins)" value="10" type="number" autoComplete="off" />
              </FormLayout.Group>
              <FormLayout.Group>
                <TextField label="Default loading time (mins)" value="0" type="number" autoComplete="off" />
                <TextField label="Customer slot size (hours)" value="1" type="number" autoComplete="off" />
              </FormLayout.Group>
              <TextField label="Default Start/End Address" value="Bathroom Panels Direct, Unit 1 Olympus Business Park, Newton Abbot, TQ12 2SN, United Kingdom" multiline={2} autoComplete="off" />
            </FormLayout>
          </LegacyCard>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
