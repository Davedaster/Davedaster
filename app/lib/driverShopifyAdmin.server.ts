import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

function cleanShopDomain(value: string | null | undefined) {
  const trimmed = (value || "").trim();

  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    return url.hostname;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

async function getStoredShopDomain() {
  const session = await prisma.session.findFirst({
    where: {
      shop: {
        not: "",
      },
    },
    orderBy: {
      expires: "desc",
    },
    select: {
      shop: true,
    },
  });

  return cleanShopDomain(session?.shop);
}

export async function getOfflineShopifyAdmin() {
  const shop = cleanShopDomain(process.env.SHOPIFY_SHOP_DOMAIN || process.env.SHOP_CUSTOM_DOMAIN) || await getStoredShopDomain();

  if (!shop) {
    throw new Error("Shopify shop domain could not be found. Add SHOPIFY_SHOP_DOMAIN in Railway or open the embedded admin app once to refresh the stored Shopify session.");
  }

  const { admin } = await unauthenticated.admin(shop);

  return admin;
}
