import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const REQUIRED_SCOPES = [
  "read_orders",
  "read_all_orders",
  "read_assigned_fulfillment_orders",
  "read_customers",
  "read_files",
  "write_files",
  "read_fulfillments",
  "read_inventory",
  "read_locations",
  "read_merchant_managed_fulfillment_orders",
  "read_products",
  "read_shipping",
  "read_third_party_fulfillment_orders",
  "write_orders",
  "write_fulfillments",
  "write_assigned_fulfillment_orders",
  "write_merchant_managed_fulfillment_orders",
  "write_third_party_fulfillment_orders",
];

function requestedScopes() {
  const configuredScopes = process.env.SCOPES
    ?.split(",")
    .map((scope) => scope.trim())
    .filter(Boolean) || [];

  return [...new Set([...configuredScopes, ...REQUIRED_SCOPES])];
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: requestedScopes(),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.SingleMerchant,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
