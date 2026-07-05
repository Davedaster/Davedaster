import prisma from "../db.server";
import { createSignedProofPhotoUrl } from "./proofPhotoStorage.server";

const TRACKABLE_ROUTE_STATUSES = ["PUBLISHED", "NOTIFICATIONS_SENT", "OUT_FOR_DELIVERY", "COMPLETED"];

function splitLineItems(summary?: string | null) {
  return (summary || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseProofOfDeliveryMetadata(deliveryNote?: string | null) {
  const lines = (deliveryNote || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const receiverPrefix = "Receiver:";
  const locationPrefix = "POD location:";
  const receiverLine = lines.find((line) => line.toLowerCase().startsWith(receiverPrefix.toLowerCase()));
  const locationLine = lines.find((line) => line.toLowerCase().startsWith(locationPrefix.toLowerCase()));
  const customerNote = lines
    .filter((line) => !line.toLowerCase().startsWith(receiverPrefix.toLowerCase()))
    .filter((line) => !line.toLowerCase().startsWith(locationPrefix.toLowerCase()))
    .join("\n");

  const locationValue = locationLine?.slice(locationPrefix.length).trim() || "";
  const [latValue, lngValue] = locationValue.split(",").map((part) => Number(part.trim()));
  const hasLocation = Number.isFinite(latValue) && Number.isFinite(lngValue);

  return {
    customerNote: customerNote || null,
    receiverName: receiverLine?.slice(receiverPrefix.length).trim() || null,
    location: hasLocation ? { latitude: latValue, longitude: lngValue } : null,
  };
}

function isReceiverMark(label?: string | null) {
  return (label || "").toLowerCase().startsWith("receiver mark");
}

function returnCollectionItems(returnTickets: Array<{ lines: Array<{ itemName: string; quantityExpected: number; quantityCollected: number }> }>) {
  return returnTickets.flatMap((ticket) => ticket.lines.map((line) => {
    const collectedQuantity = line.quantityCollected || line.quantityExpected || 1;
    return `${collectedQuantity} × ${line.itemName}`;
  }));
}

export async function getCustomerTracking(routeId: string, shopifyOrderId: string) {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: {
      driver: true,
      stops: {
        include: {
          returnTickets: {
            include: {
              lines: {
                orderBy: {
                  createdAt: "asc",
                },
              },
            },
            orderBy: {
              createdAt: "asc",
            },
          },
          deliveryGroup: {
            include: {
              orders: true,
              proofPhotos: {
                orderBy: {
                  createdAt: "asc",
                },
              },
            },
          },
        },
        orderBy: {
          orderIndex: "asc",
        },
      },
    },
  });

  if (!route || !TRACKABLE_ROUTE_STATUSES.includes(route.status)) {
    return null;
  }

  const stop = route.stops.find((routeStop) => (
    routeStop.deliveryGroup?.orders.some((order) => order.shopifyOrderId === shopifyOrderId)
  ));

  if (!stop || !stop.deliveryGroup) {
    return null;
  }

  const order = stop.deliveryGroup.orders.find((deliveryOrder) => deliveryOrder.shopifyOrderId === shopifyOrderId);

  if (!order) {
    return null;
  }

  const pendingStops = route.stops.filter((routeStop) => routeStop.status === "PENDING");
  const completedStops = route.stops.filter((routeStop) => routeStop.status === "DELIVERED").length;
  const failedStops = route.stops.filter((routeStop) => routeStop.status === "FAILED").length;
  const activeStops = route.stops.filter((routeStop) => routeStop.status !== "FAILED");
  const nextPendingOrderIndex = pendingStops.length
    ? Math.min(...pendingStops.map((routeStop) => routeStop.orderIndex))
    : null;
  const isNextDrop = route.status === "OUT_FOR_DELIVERY" && stop.status === "PENDING" && stop.orderIndex === nextPendingOrderIndex;
  const stopsBeforeCustomer = route.stops.filter((routeStop) => (
    routeStop.orderIndex < stop.orderIndex && routeStop.status === "PENDING"
  )).length;
  const remainingStops = route.stops.filter((routeStop) => routeStop.status === "PENDING").length;
  const progressPercent = route.stops.length
    ? Math.round((completedStops / route.stops.length) * 100)
    : 0;
  const podMeta = parseProofOfDeliveryMetadata(stop.deliveryGroup.deliveryNote);
  const receiverMark = stop.deliveryGroup.proofPhotos.find((photo) => isReceiverMark(photo.label));
  const signedProofPhotos = await Promise.all(
    stop.deliveryGroup.proofPhotos
      .filter((photo) => !isReceiverMark(photo.label))
      .map(async (photo) => ({
        id: photo.id,
        url: await createSignedProofPhotoUrl(photo.url),
        label: photo.label,
        createdAt: photo.createdAt,
      })),
  );
  const signedReceiverMark = receiverMark ? {
    id: receiverMark.id,
    url: await createSignedProofPhotoUrl(receiverMark.url),
    label: receiverMark.label,
    createdAt: receiverMark.createdAt,
  } : null;
  const returnTickets = stop.returnTickets || [];
  const isCollection = returnTickets.length > 0;
  const primaryReturnTicket = returnTickets[0] || null;
  const collectionPhotoUrl = primaryReturnTicket?.collectionPhotoUrl
    ? await createSignedProofPhotoUrl(primaryReturnTicket.collectionPhotoUrl)
    : null;

  return {
    serviceType: isCollection ? "collection" as const : "delivery" as const,
    route: {
      id: route.id,
      name: route.name,
      date: route.date,
      status: route.status,
      driver: route.driver ? {
        name: route.driver.name,
        photoUrl: route.driver.photoUrl,
      } : null,
    },
    stop: {
      id: stop.id,
      orderIndex: stop.orderIndex,
      estimatedArrival: stop.estimatedArrival,
      actualArrival: stop.actualArrival,
      status: stop.status,
    },
    deliveryGroup: {
      postcode: stop.deliveryGroup.postcode,
      deliveryNote: podMeta.customerNote,
      safePlaceNote: stop.deliveryGroup.safePlaceNote,
      proofPhotoUrl: await createSignedProofPhotoUrl(stop.deliveryGroup.proofPhotoUrl),
      proofPhotos: signedProofPhotos,
      proofOfDelivery: {
        receiverName: podMeta.receiverName,
        location: podMeta.location,
        receiverMark: signedReceiverMark,
      },
    },
    collection: isCollection ? {
      status: primaryReturnTicket?.status || null,
      collectedAt: primaryReturnTicket?.collectedAt || null,
      proofPhotoUrl: collectionPhotoUrl,
      customerSignature: primaryReturnTicket?.customerSignature || null,
      driverNote: primaryReturnTicket?.driverNote || null,
      items: returnCollectionItems(returnTickets),
    } : null,
    order: {
      shopifyOrderNumber: order.shopifyOrderNumber,
      items: splitLineItems(order.lineItemSummary),
    },
    progress: {
      totalStops: route.stops.length,
      activeStops: activeStops.length,
      completedStops,
      failedStops,
      remainingStops,
      stopsBeforeCustomer,
      progressPercent,
    },
    isNextDrop,
  };
}
