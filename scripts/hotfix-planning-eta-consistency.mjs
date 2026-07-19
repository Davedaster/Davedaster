import fs from "node:fs";

const files = [
  {
    path: "app/routes/app._index.tsx",
    replacements: [
      {
        from: `type PlanningEtaPreviewResult = {\n  ok: true;\n  stopEtas: StopEta[];`,
        to: `type PlanningEtaPreviewResult = {\n  ok: true;\n  requestKey: string;\n  stopEtas: StopEta[];`,
      },
      {
        from: `  const selectedOrderIds = stops.map((stop) => stop.id).join(",");\n  const manualOrdersJson = JSON.stringify(manualOrders);`,
        to: `  const selectedOrderIds = stops.map((stop) => stop.id).join(",");\n  const manualOrdersJson = JSON.stringify(manualOrders);\n  const etaPreviewKey = [\n    selectedOrderIds,\n    manualOrdersJson,\n    routeDate,\n    plannedStartTime,\n    timePerDropMinutes,\n    customerSlotMinutes,\n    startAddress,\n    startLatitude ?? "",\n    startLongitude ?? "",\n    finishAddress,\n    finishLatitude ?? "",\n    finishLongitude ?? "",\n    returnToBase ? "1" : "0",\n  ].join("|");`,
      },
      {
        from: `    setStops([...orderedStops, ...missingStops]);\n    setRouteDistanceKm(optimisationFetcher.data.totalDistanceKm);\n    setRouteFinishEta(optimisationFetcher.data.routeFinishEta);\n    setRouteDurationMinutes(optimisationFetcher.data.totalDurationMinutes);\n    setRouteOptimised(true);`,
        to: `    setStops([...orderedStops, ...missingStops]);\n    setRouteDistanceKm(null);\n    setRouteFinishEta(null);\n    setRouteDurationMinutes(null);\n    setRouteOptimised(true);`,
      },
      {
        from: `    if (!etaPreviewFetcher.data?.ok) {\n      return;\n    }`,
        to: `    if (!etaPreviewFetcher.data?.ok || etaPreviewFetcher.data.requestKey !== etaPreviewKey) {\n      return;\n    }`,
      },
      {
        from: `  }, [etaPreviewFetcher.data]);`,
        to: `  }, [etaPreviewFetcher.data, etaPreviewKey]);`,
      },
      {
        from: `    formData.set("selectedOrderIds", selectedOrderIds);\n    formData.set("manualOrdersJson", manualOrdersJson);`,
        to: `    formData.set("selectedOrderIds", selectedOrderIds);\n    formData.set("manualOrdersJson", manualOrdersJson);\n    formData.set("requestKey", etaPreviewKey);`,
      },
      {
        from: `    formData.set("requestKey", etaPreviewKey);\n    formData.set("routeDate", routeDate);`,
        to: `    formData.set("requestKey", etaPreviewKey);\n    formData.set("draftRouteId", draftRoute?.id || "");\n    formData.set("routeDate", routeDate);`,
      },
    ],
  },
  {
    path: "app/routes/app.planning-eta.tsx",
    replacements: [
      {
        from: `import { lookupAddress } from "../lib/getAddress.server";\nimport { listOpenReturnPlanningOrders } from "../lib/returns.server";`,
        to: `import { lookupAddress } from "../lib/getAddress.server";\nimport { getRoute } from "../lib/routeDrafts.server";\nimport { listOpenReturnPlanningOrders } from "../lib/returns.server";`,
      },
      {
        from: `import { getDeliveryOrders, toManualDeliveryOrder, type DeliveryOrder, type ManualDeliveryOrderInput } from "../lib/shopifyOrders.server";`,
        to: `import { getDeliveryOrders, toManualDeliveryOrder, type ManualDeliveryOrderInput } from "../lib/shopifyOrders.server";`,
      },
      {
        from: `type ManualPlanningOrder = ManualDeliveryOrderInput & {\n  id: string;\n};`,
        to: `type ManualPlanningOrder = ManualDeliveryOrderInput & {\n  id: string;\n};\n\ntype PlanningOrderPoint = {\n  id: string;\n  latitude: number | null;\n  longitude: number | null;\n};\n\ntype DraftRouteRecord = NonNullable<Awaited<ReturnType<typeof getRoute>>>;`,
      },
      {
        from: `type PlanningEtaPreviewResult = {\n  ok: true;\n  stopEtas: StopEtaPreview[];`,
        to: `type PlanningEtaPreviewResult = {\n  ok: true;\n  requestKey: string;\n  stopEtas: StopEtaPreview[];`,
      },
      {
        from: `async function getSelectedPlanningOrders(\n  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],\n  selectedOrderIds: string[],\n  manualOrders: ManualPlanningOrder[],\n) {\n  const [shopifyOrders, returnPlanningOrders, manualDeliveryOrders] = await Promise.all([\n    getDeliveryOrders(admin),\n    listReturnPlanningOrdersSafely(),\n    Promise.all(manualOrders.map((order) => toManualDeliveryOrder(order))),\n  ]);\n  const ordersById = new Map([...shopifyOrders, ...returnPlanningOrders, ...manualDeliveryOrders].map((order) => [order.id, order]));\n\n  return selectedOrderIds\n    .map((id) => ordersById.get(id))\n    .filter((order): order is DeliveryOrder => Boolean(order));\n}`,
        to: `function draftPlanningOrders(route: DraftRouteRecord | null): PlanningOrderPoint[] {\n  if (!route) {\n    return [];\n  }\n\n  return route.stops.flatMap((stop) => {\n    const orderId = stop.deliveryGroup?.orders[0]?.shopifyOrderId;\n\n    if (!orderId) {\n      return [];\n    }\n\n    return [{\n      id: orderId,\n      latitude: stop.deliveryGroup?.latitude ?? null,\n      longitude: stop.deliveryGroup?.longitude ?? null,\n    }];\n  });\n}\n\nasync function getSelectedPlanningOrders(\n  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],\n  selectedOrderIds: string[],\n  manualOrders: ManualPlanningOrder[],\n  draftRoute: DraftRouteRecord | null,\n) {\n  const [shopifyOrders, returnPlanningOrders, manualDeliveryOrders] = await Promise.all([\n    getDeliveryOrders(admin),\n    listReturnPlanningOrdersSafely(),\n    Promise.all(manualOrders.map((order) => toManualDeliveryOrder(order))),\n  ]);\n  const ordersById = new Map<string, PlanningOrderPoint>([\n    ...shopifyOrders,\n    ...returnPlanningOrders,\n    ...manualDeliveryOrders,\n    ...draftPlanningOrders(draftRoute),\n  ].map((order) => [order.id, {\n    id: order.id,\n    latitude: order.latitude,\n    longitude: order.longitude,\n  }] as const));\n\n  return selectedOrderIds\n    .map((id) => ordersById.get(id))\n    .filter((order): order is PlanningOrderPoint => Boolean(order));\n}`,
      },
      {
        from: `  const formData = await request.formData();\n  const selectedOrderIds = String(formData.get("selectedOrderIds") || "")`,
        to: `  const formData = await request.formData();\n  const requestKey = String(formData.get("requestKey") || "");\n  const draftRouteId = String(formData.get("draftRouteId") || "").trim();\n  const selectedOrderIds = String(formData.get("selectedOrderIds") || "")`,
      },
      {
        from: `    const returnToBase = String(formData.get("returnToBase") || "") === "true";\n    const manualOrders = parseManualOrders(formData.get("manualOrdersJson"));\n    const selectedOrders = await getSelectedPlanningOrders(admin, selectedOrderIds, manualOrders);`,
        to: `    const returnToBase = String(formData.get("returnToBase") || "") === "true";\n    const manualOrders = parseManualOrders(formData.get("manualOrdersJson"));\n    const draftRoute = draftRouteId ? await getRoute(draftRouteId) : null;\n\n    if (draftRouteId && !draftRoute) {\n      return json<PlanningEtaPreviewResult>({ ok: false, error: "Draft route could not be found for the ETA preview." }, { status: 404 });\n    }\n\n    if (draftRoute && draftRoute.status !== "DRAFT") {\n      return json<PlanningEtaPreviewResult>({ ok: false, error: "Only draft routes can be previewed in the planner." }, { status: 400 });\n    }\n\n    const selectedOrders = await getSelectedPlanningOrders(admin, selectedOrderIds, manualOrders, draftRoute);`,
      },
      {
        from: `    return json<PlanningEtaPreviewResult>({\n      ok: true,\n      stopEtas,`,
        to: `    return json<PlanningEtaPreviewResult>({\n      ok: true,\n      requestKey,\n      stopEtas,`,
      },
    ],
  },
];

for (const file of files) {
  let source = fs.readFileSync(file.path, "utf8");

  for (const replacement of file.replacements) {
    if (source.includes(replacement.to)) {
      continue;
    }

    if (!source.includes(replacement.from)) {
      throw new Error(`Could not find expected planning ETA source in ${file.path}`);
    }

    source = source.replace(replacement.from, replacement.to);
  }

  fs.writeFileSync(file.path, source);
}
