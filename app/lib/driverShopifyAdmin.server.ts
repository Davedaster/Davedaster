import { unauthenticated } from "../shopify.server";

export async function getOfflineShopifyAdmin() {
  const shop = process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOP_CUSTOM_DOMAIN;

  if (!shop) {
    throw new Error("SHOPIFY_SHOP_DOMAIN or SHOP_CUSTOM_DOMAIN is missing from the app environment.");
  }

  const { admin } = await unauthenticated.admin(shop);

  return admin;
}
