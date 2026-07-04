import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { Page, LegacyCard, Text, BlockStack } from "@shopify/polaris";

import { authenticate } from "../shopify.server";

const QUERY = `#graphql
  query CurrentAppScopes {
    currentAppInstallation {
      accessScopes {
        handle
      }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(QUERY);
  const payload = await response.json() as {
    data?: { currentAppInstallation?: { accessScopes?: Array<{ handle: string }> } };
    errors?: Array<{ message: string }>;
  };

  return json({
    scopes: payload.data?.currentAppInstallation?.accessScopes?.map((scope) => scope.handle).sort() || [],
    errors: payload.errors?.map((error) => error.message) || [],
  });
};

export default function ShopifyPermissions() {
  const { scopes, errors } = useLoaderData<typeof loader>();

  return (
    <Page title="Shopify permissions" backAction={{ content: "Settings", url: "/app/settings" }}>
      <LegacyCard sectioned>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Current Shopify access scopes</Text>
          {errors.map((error) => <Text key={error} as="p" tone="critical">{error}</Text>)}
          <Text as="p" variant="bodyMd">{scopes.length ? scopes.join(", ") : "No scopes returned"}</Text>
        </BlockStack>
      </LegacyCard>
    </Page>
  );
}
