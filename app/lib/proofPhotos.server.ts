import prisma from "../db.server";

export async function deleteProofPhoto(input: {
  routeId: string;
  proofPhotoId: string;
}) {
  const proofPhoto = await prisma.proofPhoto.findUnique({
    where: {
      id: input.proofPhotoId,
    },
    include: {
      deliveryGroup: {
        include: {
          proofPhotos: {
            orderBy: {
              createdAt: "asc",
            },
          },
          stops: {
            where: {
              routeId: input.routeId,
            },
          },
        },
      },
    },
  });

  if (!proofPhoto || !proofPhoto.deliveryGroup.stops.length) {
    throw new Error("Proof photo not found for this route.");
  }

  const remainingPhotos = proofPhoto.deliveryGroup.proofPhotos.filter((photo) => photo.id !== proofPhoto.id);
  const nextPrimaryProofPhotoUrl = remainingPhotos[0]?.url || null;
  const stop = proofPhoto.deliveryGroup.stops[0];

  await prisma.$transaction(async (tx) => {
    await tx.proofPhoto.delete({
      where: {
        id: proofPhoto.id,
      },
    });

    await tx.deliveryGroup.update({
      where: {
        id: proofPhoto.deliveryGroupId,
      },
      data: {
        proofPhotoUrl: proofPhoto.deliveryGroup.proofPhotoUrl === proofPhoto.url
          ? nextPrimaryProofPhotoUrl
          : proofPhoto.deliveryGroup.proofPhotoUrl,
      },
    });

    await tx.route.update({
      where: {
        id: input.routeId,
      },
      data: {
        history: {
          create: {
            action: "Proof photo deleted",
            details: `Proof photo deleted from stop ${stop.orderIndex}. Storage file was left in place.`,
          },
        },
      },
    });
  });
}
