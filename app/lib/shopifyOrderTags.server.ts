import prisma from "../db.server";
import { formatEtaSlot } from "./etaSlots.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type TagsAddPayload = {
  data?: {
    tagsAdd?: {
      userErrors?: Array<{
        field?: string[];
        message: string;
      }>;
    };
  };
  errors?: Array<{ message: string }>;
};

const TAGS_ADD_MUTATION = `#graphql
  mutation AddOrderTags($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors {
        field
        message
      }
    }
  }
`;

function formatRouteDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

function addMinutes(date: Date, minutes: number) {
  return new Date(new Date(date).getTime() + minutes * 60 * 1000);
}

function buildPublishedRouteTags(input: {
  routeName: string;
  routeDate: Date;
  driverName?: string | null;
  estimatedArrival?: Date | null;
}) {
  const tags = [
    "BPD route published",
    `BPD route ${input.routeName}`,
    `BPD route date ${formatRouteDate(input.routeDate)}`,
  ];

  if (input.driverName) {
    tags.push(`BPD driver ${input.driverName}`);
  }

  if (input.estimatedArrival) {
    tags.push(`BPD ETA ${formatEtaSlot(input.estimatedArrival, addMinutes(input.estimatedArrival, 60))}`);
  }

  return tags;
}

async function addTagsToShopifyOrder(admin: ShopifyAdmin, shopifyOrderId: string, tags: string[]) {
  const response = await admin.graphql(TAGS_ADD_MUTATION, {
    variables: {
      id: shopifyOrderId,
      tags,
    },
  });
  const payload = await response.json() as TagsAddPayload;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join(", "));
  }

  const userErrors = payload.data?.tagsAdd?.userErrors || [];

  if (userErrors.length) {
    throw new Error(userErrors.map((error) => error.message).join(", "));
  }
}

export async function tagPublishedRouteOrders(admin: ShopifyAdmin, routeId: string) {
  const route = await prisma.route.findUnique({
    where: {
      id: routeId,
    },
    include: {
      driver: true,
      stops: {
        include: {
          deliveryGroup: {
            include: {
              orders: true,
            },
          },
        },
        orderBy: {
          orderIndex: "asc",
        },
      },
    },
  });

  if (!route) {
    throw new Error("Route not found.");
  }

  let taggedOrders = 0;

  for (const stop of route.stops) {
    const deliveryOrders = stop.deliveryGroup?.orders || [];
    const tags = buildPublishedRouteTags({
      routeName: route.name,
      routeDate: route.date,
      driverName: route.driver?.name,
      estimatedArrival: stop.estimatedArrival,
    });

    for (const order of deliveryOrders) {
      await addTagsToShopifyOrder(admin, order.shopifyOrderId, tags);
      taggedOrders += 1;
    }
  }

  await prisma.route.update({
    where: {
      id: routeId,
    },
    data: {
      history: {
        create: {
          action: "Shopify orders tagged",
          details: `${taggedOrders} Shopify orders tagged with route details`,
        },
      },
    },
  });

  return taggedOrders;
}
