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
        from: `  const buildSaveFormData = () => {\n    const formData = new FormData();\n    formData.set("intent", "saveRoute");\n    formData.set("draftRouteId", draftRoute?.id || "");\n    formData.set("selectedOrderIds", selectedOrderIds);\n    formData.set("manualOrdersJson", manualOrdersJson);\n    formData.set("requestKey", etaPreviewKey);\n    formData.set("driverId", selectedDriverId);`,
        to: `  const buildSaveFormData = () => {\n    const formData = new FormData();\n    formData.set("intent", "saveRoute");\n    formData.set("draftRouteId", draftRoute?.id || "");\n    formData.set("selectedOrderIds", selectedOrderIds);\n    formData.set("manualOrdersJson", manualOrdersJson);\n    formData.set("driverId", selectedDriverId);`,
      },
      {
        from: `  const submitEtaPreview = () => {\n    if (!stops.length) {\n      return;\n    }\n\n    const formData = new FormData();\n    formData.set("selectedOrderIds", selectedOrderIds);\n    formData.set("manualOrdersJson", manualOrdersJson);\n    formData.set("routeDate", routeDate);`,
        to: `  const submitEtaPreview = () => {\n    if (!stops.length) {\n      return;\n    }\n\n    const formData = new FormData();\n    formData.set("selectedOrderIds", selectedOrderIds);\n    formData.set("manualOrdersJson", manualOrdersJson);\n    formData.set("requestKey", etaPreviewKey);\n    formData.set("routeDate", routeDate);`,
      },
    ],
  },
  {
    path: "app/routes/app.planning-eta.tsx",
    replacements: [
      {
        from: `type PlanningEtaPreviewResult = {\n  ok: true;\n  stopEtas: StopEtaPreview[];`,
        to: `type PlanningEtaPreviewResult = {\n  ok: true;\n  requestKey: string;\n  stopEtas: StopEtaPreview[];`,
      },
      {
        from: `  const formData = await request.formData();\n  const selectedOrderIds = String(formData.get("selectedOrderIds") || "")`,
        to: `  const formData = await request.formData();\n  const requestKey = String(formData.get("requestKey") || "");\n  const selectedOrderIds = String(formData.get("selectedOrderIds") || "")`,
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
