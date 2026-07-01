import prisma from "../db.server";
import { createSignedProofPhotoUrls } from "./proofPhotoStorage.server";

function normaliseSearchTerm(value: string) {
  return value.trim().replace(/^#/, "");
}

function phoneDigits(value: string) {
  return value.replace(/\D/g, "");
}

export async function searchProofOfDelivery(term: string) {
  const query = normaliseSearchTerm(term);
  const digitsOnly = phoneDigits(query);
  const phoneQueries = Array.from(new Set([query, digitsOnly].filter((value) => value.length >= 3)));

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
        ...phoneQueries.map((phoneQuery) => ({
          orders: {
            some: {
              customerPhone: {
                contains: phoneQuery,
                mode: "insensitive" as const,
              },
            },
          },
        })),
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
