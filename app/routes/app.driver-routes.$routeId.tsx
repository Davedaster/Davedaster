import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useActionData } from "@remix-run/react";
import {
  Page,
  Layout,
  LegacyCard,
  Text,
  BlockStack,
  Badge,
  Button,
  InlineStack,
  Box,
  Divider,
  TextField,
  ProgressBar,
} from "@shopify/polaris";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";

import { ProofPhotoGallery } from "../components/ProofPhotoGallery";
import { markStopFailedDelivery } from "../lib/failedDelivery.server";
import { formatEtaSlot } from "../lib/etaSlots";
import { getDriverRoute, startDriverRoute } from "../lib/driverRoutes.server";
import { saveProofOfDelivery } from "../lib/proofOfDelivery.server";
import { deleteProofPhoto } from "../lib/proofPhotos.server";
import { isProofPhotoStorageEnabled, uploadProofPhoto } from "../lib/proofPhotoStorage.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const routeId = params.routeId;

  if (!routeId) {
    throw new Response("Route not found", { status: 404 });
  }

  const route = await getDriverRoute(routeId);

  if (!route) {
    throw new Response("Route not found", { status: 404 });
  }

  const proofPhotoStorageEnabled = await isProofPhotoStorageEnabled();

  return json({ route, proofPhotoStorageEnabled });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const routeId = params.routeId;

  if (!routeId) {
    throw new Response("Route not found", { status: 404 });
  }

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "startRoute");

  if (intent === "startRoute") {
    await startDriverRoute(routeId);
    return redirect(`/app/driver-routes/${routeId}`);
  }

  if (intent === "deleteProofPhoto") {
    try {
      await deleteProofPhoto({
        routeId,
        proofPhotoId: String(formData.get("proofPhotoId") || "").trim(),
      });

      return redirect(`/app/driver-routes/${routeId}`);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Proof photo remove failed." }, { status: 400 });
    }
  }

  const route = await getDriverRoute(routeId);

  if (!route || route.status !== "OUT_FOR_DELIVERY") {
    return json({ ok: false, error: "Start the route before updating stops." }, { status: 400 });
  }

  if (intent === "completeStop") {
    try {
      const stopId = String(formData.get("stopId") || "").trim();
      const proofPhotoFiles = formData.getAll("proofPhotoFiles").filter((file): file is File => file instanceof File && file.size > 0);
      const fallbackProofPhotoUrl = String(formData.get("proofPhotoUrl") || "").trim();
      const proofPhotoUrls = fallbackProofPhotoUrl ? [fallbackProofPhotoUrl] : [];
      const podLatValue = Number(String(formData.get("podLat") || ""));
      const podLngValue = Number(String(formData.get("podLng") || ""));

      for (const proofPhotoFile of proofPhotoFiles) {
        proofPhotoUrls.push(await uploadProofPhoto(proofPhotoFile, stopId));
      }

      await saveProofOfDelivery({
        admin,
        stopId,
        proofPhotoUrl: proofPhotoUrls,
        deliveryNote: String(formData.get("deliveryNote") || "").trim(),
        safePlaceNote: String(formData.get("safePlaceNote") || "").trim(),
        leftInSafePlace: String(formData.get("leftInSafePlace") || "") === "true",
        podImage: String(formData.get("podImage") || "").trim(),
        podName: String(formData.get("podName") || "").trim(),
        podTicked: String(formData.get("podTicked") || "") === "true",
        podLat: Number.isFinite(podLatValue) ? podLatValue : null,
        podLng: Number.isFinite(podLngValue) ? podLngValue : null,
      });

      return redirect(`/app/driver-routes/${routeId}`);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Stop completion failed." }, { status: 400 });
    }
  }

  if (intent === "failedStop") {
    try {
      await markStopFailedDelivery({
        admin,
        stopId: String(formData.get("stopId") || "").trim(),
        reason: String(formData.get("failedReason") || "").trim(),
        note: String(formData.get("failedNote") || "").trim(),
      });

      return redirect(`/app/driver-routes/${routeId}`);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : "Failed delivery update failed." }, { status: 400 });
    }
  }

  return redirect(`/app/driver-routes/${routeId}`);
};

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatSlot(estimatedArrival: string | Date | null) {
  if (!estimatedArrival) {
    return "Pending";
  }

  const start = new Date(estimatedArrival);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return formatEtaSlot(start, end);
}

function statusTone(status: string) {
  if (status === "DELIVERED") {
    return "success" as const;
  }

  if (status === "FAILED") {
    return "critical" as const;
  }

  return "info" as const;
}

type NavigationStop = {
  deliveryGroup?: {
    latitude?: number | null;
    longitude?: number | null;
    address?: string | null;
    formattedAddress?: string | null;
    postcode?: string | null;
  } | null;
};

function buildNavigationQuery(stop: NavigationStop) {
  const group = stop.deliveryGroup;

  if (!group) {
    return null;
  }

  if (typeof group.latitude === "number" && typeof group.longitude === "number") {
    return {
      label: `${group.latitude},${group.longitude}`,
      encoded: `${group.latitude},${group.longitude}`,
    };
  }

  const label = [group.address, group.formattedAddress, group.postcode]
    .filter(Boolean)
    .join(", ");

  if (!label) {
    return null;
  }

  return {
    label,
    encoded: encodeURIComponent(label),
  };
}

function buildWazeUrl(stop: NavigationStop) {
  const group = stop.deliveryGroup;

  if (!group) {
    return null;
  }

  if (typeof group.latitude === "number" && typeof group.longitude === "number") {
    return `https://waze.com/ul?ll=${group.latitude},${group.longitude}&navigate=yes`;
  }

  const query = buildNavigationQuery(stop);

  if (!query) {
    return null;
  }

  return `https://waze.com/ul?q=${query.encoded}&navigate=yes`;
}
