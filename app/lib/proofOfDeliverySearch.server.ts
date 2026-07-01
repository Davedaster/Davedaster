import prisma from "../db.server";
import { createSignedProofPhotoUrls } from "./proofPhotoStorage.server";

function normaliseSearchTerm(value: string) {
  return value.trim().replace(/^#/, "");
}

export async function searchProofOfDelivery(term: string) {
  const query = normaliseSearchTerm(term);

  if (!query) {
    return [];
  }

  const groups = await prisma.deliveryGroup.findMany({
    where: {
      proofPhotos: {
        some: {},
      },
      OR: [
        {
          orders: {
            some: {
              shopifyOrderNumber: {
                contains: query,
                mode: "insensitive",
              },
            },
          },
        },
        {
          orders: {
            some: {
              customerName: {
                contains: query,
                mode: "insensitive",
              },
            },
          },
        },
        {
          orders: {
            some: {
              customerEmail: {
                contains: query,
                mode: "insensitive",
              },
            },
          },
        },
        {
          orders: {
            some: {
              customerPhone: {
                contains: query,
                mode: "insensitive",
              },
            },
          },
        },
      ],
    },
    include: {
      orders: true,
      proofPhotos: {
        orderBy: {
          createdAt: "asc",
        },
      },
      stops: {
        include: {
          route: {
            include: {
              driver: true,
            },
          },
        },
        orderBy: [
          { actualArrival: "desc" },
          { updatedAt: "desc" },
        ],
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 25,
  });

  return Promise.all(groups.map(async (group) => ({
    ...group,
    proofPhotos: await createSignedProofPhotoUrls(group.proofPhotos),
  })));
}
