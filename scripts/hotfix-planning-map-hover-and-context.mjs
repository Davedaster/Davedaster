import { readFileSync, writeFileSync } from "node:fs";

const routeMapPath = "app/components/RouteMap.tsx";
const planningPath = "app/routes/app._index.tsx";

function replaceOnce(source, label, from, to) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Could not apply planning map hotfix: ${label}`);
  return source.replace(from, to);
}

let routeMap = readFileSync(routeMapPath, "utf8");
let planning = readFileSync(planningPath, "utf8");

if (routeMap.includes("onMapContextAction") && routeMap.includes("onPointContextAction") && planning.includes("onMapContextAction")) {
  console.log("Planning map hover and right-click endpoint hotfix already covered.");
  process.exit(0);
}

routeMap = replaceOnce(
  routeMap,
  "add route endpoint selection type",
  `type RouteMapProps = {`,
  `type RouteEndpointSelection = {
  status: "START" | "FINISH";
  address: string;
  latitude: number;
  longitude: number;
};

type RouteMapProps = {`,
);

routeMap = replaceOnce(
  routeMap,
  "add endpoint selection prop",
  `  onSelectPoint?: (point: RouteMapPoint) => void;
  apiKey?: string | null;`,
  `  onSelectPoint?: (point: RouteMapPoint) => void;
  onSetRouteEndpoint?: (endpoint: RouteEndpointSelection) => void;
  apiKey?: string | null;`,
);

routeMap = replaceOnce(
  routeMap,
  "destructure endpoint selection prop",
  `  showRouteLine = true,
  onSelectPoint,
  apiKey,`,
  `  showRouteLine = true,
  onSelectPoint,
  onSetRouteEndpoint,
  apiKey,`,
);

routeMap = replaceOnce(
  routeMap,
  "add context menu state",
  `  const [roadRouteCoordinates, setRoadRouteCoordinates] = useState<number[][]>([]);
  const [resolvedStart, setResolvedStart] = useState<MappableEndpoint | null>(null);`,
  `  const [roadRouteCoordinates, setRoadRouteCoordinates] = useState<number[][]>([]);
  const [contextMenu, setContextMenu] = useState<{ left: number; top: number; latitude: number; longitude: number } | null>(null);
  const [resolvedStart, setResolvedStart] = useState<MappableEndpoint | null>(null);`,
);

routeMap = replaceOnce(
  routeMap,
  "add context menu handlers",
  `    const handleMapMovement = () => {
      hidePopup();
    };`,
  `    const handleMapMovement = () => {
      hidePopup();
      setContextMenu(null);
    };

    const hideContextMenu = () => {
      setContextMenu(null);
    };

    const handleContextMenu = (event: any) => {
      if (!onSetRouteEndpoint) {
        return;
      }

      event.preventDefault?.();
      event.originalEvent?.preventDefault?.();
      hidePopup();

      const latitude = event.lngLat?.lat;
      const longitude = event.lngLat?.lng;

      if (typeof latitude !== "number" || typeof longitude !== "number") {
        return;
      }

      setContextMenu({
        left: event.point?.x || 0,
        top: event.point?.y || 0,
        latitude,
        longitude,
      });
    };`,
);

routeMap = replaceOnce(
  routeMap,
  "expand hover and context map events",
  `    map.on("click", clustersLayerId, handleClusterClick);
    map.on("click", pinsLayerId, handlePinClick);
    map.on("mouseenter", clustersLayerId, handleClusterEnter);
    map.on("mouseleave", clustersLayerId, handleClusterLeave);
    map.on("mouseenter", pinsLayerId, showPopup);
    map.on("mouseleave", pinsLayerId, hidePopup);
    map.on("mouseenter", endpointPinsLayerId, showPopup);
    map.on("mouseleave", endpointPinsLayerId, hidePopup);
    map.on("dragstart", handleMapMovement);
    map.on("movestart", handleMapMovement);`,
  `    map.on("click", clustersLayerId, handleClusterClick);
    map.on("click", pinsLayerId, handlePinClick);
    map.on("click", pinLabelLayerId, handlePinClick);
    map.on("click", hideContextMenu);
    map.on("contextmenu", handleContextMenu);
    map.on("mouseenter", clustersLayerId, handleClusterEnter);
    map.on("mouseleave", clustersLayerId, handleClusterLeave);
    map.on("mouseenter", pinsLayerId, showPopup);
    map.on("mousemove", pinsLayerId, showPopup);
    map.on("mouseleave", pinsLayerId, hidePopup);
    map.on("mouseenter", pinLabelLayerId, showPopup);
    map.on("mousemove", pinLabelLayerId, showPopup);
    map.on("mouseleave", pinLabelLayerId, hidePopup);
    map.on("mouseenter", endpointPinsLayerId, showPopup);
    map.on("mousemove", endpointPinsLayerId, showPopup);
    map.on("mouseleave", endpointPinsLayerId, hidePopup);
    map.on("dragstart", handleMapMovement);
    map.on("movestart", handleMapMovement);`,
);

routeMap = replaceOnce(
  routeMap,
  "expand hover and context cleanup",
  `      map.off("click", clustersLayerId, handleClusterClick);
      map.off("click", pinsLayerId, handlePinClick);
      map.off("mouseenter", clustersLayerId, handleClusterEnter);
      map.off("mouseleave", clustersLayerId, handleClusterLeave);
      map.off("mouseenter", pinsLayerId, showPopup);
      map.off("mouseleave", pinsLayerId, hidePopup);
      map.off("mouseenter", endpointPinsLayerId, showPopup);
      map.off("mouseleave", endpointPinsLayerId, hidePopup);
      map.off("dragstart", handleMapMovement);
      map.off("movestart", handleMapMovement);`,
  `      map.off("click", clustersLayerId, handleClusterClick);
      map.off("click", pinsLayerId, handlePinClick);
      map.off("click", pinLabelLayerId, handlePinClick);
      map.off("click", hideContextMenu);
      map.off("contextmenu", handleContextMenu);
      map.off("mouseenter", clustersLayerId, handleClusterEnter);
      map.off("mouseleave", clustersLayerId, handleClusterLeave);
      map.off("mouseenter", pinsLayerId, showPopup);
      map.off("mousemove", pinsLayerId, showPopup);
      map.off("mouseleave", pinsLayerId, hidePopup);
      map.off("mouseenter", pinLabelLayerId, showPopup);
      map.off("mousemove", pinLabelLayerId, showPopup);
      map.off("mouseleave", pinLabelLayerId, hidePopup);
      map.off("mouseenter", endpointPinsLayerId, showPopup);
      map.off("mousemove", endpointPinsLayerId, showPopup);
      map.off("mouseleave", endpointPinsLayerId, hidePopup);
      map.off("dragstart", handleMapMovement);
      map.off("movestart", handleMapMovement);`,
);

routeMap = replaceOnce(
  routeMap,
  "include endpoint callback dependency",
  `  }, [mapReady, mappablePoints, onSelectPoint, roadRouteCoordinates, routeEndpoints, routePathPoints, selectedPoints.length, showRouteLine]);`,
  `  }, [mapReady, mappablePoints, onSelectPoint, onSetRouteEndpoint, roadRouteCoordinates, routeEndpoints, routePathPoints, selectedPoints.length, showRouteLine]);`,
);

routeMap = replaceOnce(
  routeMap,
  "add context endpoint setter",
  `  const showTitleBadge = title.trim().length > 0 && title !== "Live planning map";

  return (`,
  `  const showTitleBadge = title.trim().length > 0 && title !== "Live planning map";

  const setContextRouteEndpoint = (status: "START" | "FINISH") => {
    if (!contextMenu) {
      return;
    }

    onSetRouteEndpoint?.({
      status,
      address: "Map point " + contextMenu.latitude.toFixed(5) + ", " + contextMenu.longitude.toFixed(5),
      latitude: contextMenu.latitude,
      longitude: contextMenu.longitude,
    });
    setContextMenu(null);
  };

  return (`,
);

routeMap = replaceOnce(
  routeMap,
  "render context endpoint menu",
  `        {!activeApiKey ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24, textAlign: "center", color: "#323841" }}>`,
  `        {contextMenu && onSetRouteEndpoint ? (
          <div
            onContextMenu={(event) => event.preventDefault()}
            style={{
              position: "absolute",
              left: contextMenu.left,
              top: contextMenu.top,
              transform: "translate(10px, 10px)",
              zIndex: 20,
              background: "rgba(255,255,255,0.98)",
              border: "1px solid #d0d5dd",
              borderRadius: 14,
              boxShadow: "0 12px 28px rgba(0,0,0,0.22)",
              color: "#323841",
              display: "grid",
              gap: 8,
              padding: 10,
              width: 220,
              maxWidth: "calc(100% - 24px)",
            }}
          >
            <strong style={{ fontSize: 13 }}>Add this map point</strong>
            <span style={{ color: "#667085", fontSize: 12, fontWeight: 700 }}>{contextMenu.latitude.toFixed(5)}, {contextMenu.longitude.toFixed(5)}</span>
            <button type="button" onClick={() => setContextRouteEndpoint("START")} style={{ border: 0, borderRadius: 10, background: "#16a34a", color: "#ffffff", cursor: "pointer", fontWeight: 900, padding: "10px 12px" }}>Use as start point</button>
            <button type="button" onClick={() => setContextRouteEndpoint("FINISH")} style={{ border: 0, borderRadius: 10, background: "#b42318", color: "#ffffff", cursor: "pointer", fontWeight: 900, padding: "10px 12px" }}>Use as end point</button>
          </div>
        ) : null}

        {!activeApiKey ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24, textAlign: "center", color: "#323841" }}>`,
);

writeFileSync(routeMapPath, routeMap);

planning = replaceOnce(
  planning,
  "add map route point type",
  `type ManualPlanningOrder = ManualDeliveryOrderInput & {
  id: string;
};`,
  `type ManualPlanningOrder = ManualDeliveryOrderInput & {
  id: string;
};

type MapRoutePoint = {
  address: string;
  latitude: number;
  longitude: number;
};`,
);

planning = replaceOnce(
  planning,
  "add delivery map endpoint prop",
  `  fulfilmentWindowDays,
  onToggleOrder,
}: {`,
  `  fulfilmentWindowDays,
  onToggleOrder,
  onSetRouteEndpoint,
}: {`,
);

planning = replaceOnce(
  planning,
  "add delivery map endpoint prop type",
  `  fulfilmentWindowDays: number;
  onToggleOrder: (order: DeliveryOrder) => void;
}) {`,
  `  fulfilmentWindowDays: number;
  onToggleOrder: (order: DeliveryOrder) => void;
  onSetRouteEndpoint: (endpoint: { status: "START" | "FINISH"; address: string; latitude: number; longitude: number }) => void;
}) {`,
);

planning = replaceOnce(
  planning,
  "pass endpoint callback to route map",
  `        routeFinish={{ address: returnToBase ? startAddress : finishAddress || startAddress, label: "FINISH", latitude: returnToBase ? startLatitude : finishLatitude, longitude: returnToBase ? startLongitude : finishLongitude, status: "FINISH" }}
        onSelectPoint={(point) => {`,
  `        routeFinish={{ address: returnToBase ? startAddress : finishAddress || startAddress, label: "FINISH", latitude: returnToBase ? startLatitude : finishLatitude, longitude: returnToBase ? startLongitude : finishLongitude, status: "FINISH" }}
        onSetRouteEndpoint={onSetRouteEndpoint}
        onSelectPoint={(point) => {`,
);

planning = replaceOnce(
  planning,
  "add map endpoint state",
  `  const [customStartAddress, setCustomStartAddress] = useState<StructuredAddress>(normaliseStructuredAddress(emptyStructuredAddress));
  const [customFinishAddress, setCustomFinishAddress] = useState<StructuredAddress>(normaliseStructuredAddress(emptyStructuredAddress));`,
  `  const [customStartAddress, setCustomStartAddress] = useState<StructuredAddress>(normaliseStructuredAddress(emptyStructuredAddress));
  const [customFinishAddress, setCustomFinishAddress] = useState<StructuredAddress>(normaliseStructuredAddress(emptyStructuredAddress));
  const [mapStartPoint, setMapStartPoint] = useState<MapRoutePoint | null>(null);
  const [mapFinishPoint, setMapFinishPoint] = useState<MapRoutePoint | null>(null);`,
);

planning = replaceOnce(
  planning,
  "use map endpoint coordinates",
  `  const customStartSummary = formatStructuredAddress(customStartAddress);
  const customFinishSummary = formatStructuredAddress(customFinishAddress);
  const startAddress = useCustomStartPoint && customStartSummary ? customStartSummary : defaultStartAddress;
  const startLatitude = useCustomStartPoint ? null : defaultStartLatitude;
  const startLongitude = useCustomStartPoint ? null : defaultStartLongitude;
  const finishAddress = returnToBase ? startAddress : customFinishSummary;
  const finishLatitude = returnToBase ? startLatitude : null;
  const finishLongitude = returnToBase ? startLongitude : null;`,
  `  const customStartSummary = formatStructuredAddress(customStartAddress);
  const customFinishSummary = formatStructuredAddress(customFinishAddress);
  const mapStartAddress = mapStartPoint?.address || "";
  const mapFinishAddress = mapFinishPoint?.address || "";
  const startAddress = useCustomStartPoint ? (mapStartAddress || customStartSummary || defaultStartAddress) : defaultStartAddress;
  const startLatitude = useCustomStartPoint ? (mapStartPoint?.latitude ?? null) : defaultStartLatitude;
  const startLongitude = useCustomStartPoint ? (mapStartPoint?.longitude ?? null) : defaultStartLongitude;
  const finishAddress = returnToBase ? startAddress : (mapFinishAddress || customFinishSummary || startAddress);
  const finishLatitude = returnToBase ? startLatitude : (mapFinishPoint?.latitude ?? null);
  const finishLongitude = returnToBase ? startLongitude : (mapFinishPoint?.longitude ?? null);`,
);

planning = replaceOnce(
  planning,
  "reset map endpoints",
  `    setCustomStartAddress(normaliseStructuredAddress(emptyStructuredAddress));
    setCustomFinishAddress(normaliseStructuredAddress(emptyStructuredAddress));
    setManualAddress(normaliseStructuredAddress(emptyStructuredAddress));`,
  `    setCustomStartAddress(normaliseStructuredAddress(emptyStructuredAddress));
    setCustomFinishAddress(normaliseStructuredAddress(emptyStructuredAddress));
    setMapStartPoint(null);
    setMapFinishPoint(null);
    setManualAddress(normaliseStructuredAddress(emptyStructuredAddress));`,
);

planning = replaceOnce(
  planning,
  "add map endpoint handler",
  `  const toggleLock = (id: string) => {
    setStops(stops.map((s) => s.id === id ? { ...s, isLocked: !s.isLocked } : s));
  };

  const appendEndpointFields = (formData: FormData) => {`,
  `  const toggleLock = (id: string) => {
    setStops(stops.map((s) => s.id === id ? { ...s, isLocked: !s.isLocked } : s));
  };

  const handleMapRouteEndpoint = (endpoint: { status: "START" | "FINISH"; address: string; latitude: number; longitude: number }) => {
    const nextPoint = {
      address: endpoint.address,
      latitude: endpoint.latitude,
      longitude: endpoint.longitude,
    };

    if (endpoint.status === "START") {
      setUseCustomStartPoint(true);
      setMapStartPoint(nextPoint);
    } else {
      setReturnToBase(false);
      setMapFinishPoint(nextPoint);
    }

    clearOptimisedStats();
  };

  const appendEndpointFields = (formData: FormData) => {`,
);

planning = replaceOnce(
  planning,
  "wire endpoint handler into map",
  `                  fulfilmentWindowDays={fulfilmentWindowDays}
                  onToggleOrder={toggleOrder}
                  tomtomApiKey={tomtomApiKey}`, 
  `                  fulfilmentWindowDays={fulfilmentWindowDays}
                  onToggleOrder={toggleOrder}
                  onSetRouteEndpoint={handleMapRouteEndpoint}
                  tomtomApiKey={tomtomApiKey}`,
);

planning = replaceOnce(
  planning,
  "make custom start controls map aware",
  `                  <Checkbox label="Use custom start point" checked={useCustomStartPoint} onChange={(checked) => { setUseCustomStartPoint(checked); clearOptimisedStats(); }} />
                  {useCustomStartPoint ? <CollapsibleAddressEditor title="Custom start point" address={customStartAddress} onChange={(value) => { setCustomStartAddress(value); clearOptimisedStats(); }} summary={customStartSummary} /> : null}`, 
  `                  <Checkbox label="Use custom start point" checked={useCustomStartPoint} onChange={(checked) => { setUseCustomStartPoint(checked); if (!checked) setMapStartPoint(null); clearOptimisedStats(); }} />
                  {mapStartPoint ? <Box background="bg-surface-secondary" padding="300" borderRadius="300"><InlineStack align="space-between" blockAlign="center"><BlockStack gap="050"><Text as="p" variant="bodySm" fontWeight="bold">Start point set from map</Text><Text as="p" variant="bodySm" tone="subdued">{mapStartPoint.address}</Text></BlockStack><Button variant="tertiary" onClick={() => { setMapStartPoint(null); clearOptimisedStats(); }}>Clear</Button></InlineStack></Box> : null}
                  {useCustomStartPoint && !mapStartPoint ? <CollapsibleAddressEditor title="Custom start point" address={customStartAddress} onChange={(value) => { setCustomStartAddress(value); setMapStartPoint(null); clearOptimisedStats(); }} summary={customStartSummary} /> : null}`,
);

planning = replaceOnce(
  planning,
  "make custom finish controls map aware",
  `                  <Checkbox label="Return to base after last drop" checked={returnToBase} onChange={(checked) => { setReturnToBase(checked); clearOptimisedStats(); }} />
                  {!returnToBase ? <CollapsibleAddressEditor title="Custom finish location" address={customFinishAddress} onChange={(value) => { setCustomFinishAddress(value); clearOptimisedStats(); }} summary={customFinishSummary} /> : null}`, 
  `                  <Checkbox label="Return to base after last drop" checked={returnToBase} onChange={(checked) => { setReturnToBase(checked); if (checked) setMapFinishPoint(null); clearOptimisedStats(); }} />
                  {!returnToBase && mapFinishPoint ? <Box background="bg-surface-secondary" padding="300" borderRadius="300"><InlineStack align="space-between" blockAlign="center"><BlockStack gap="050"><Text as="p" variant="bodySm" fontWeight="bold">End point set from map</Text><Text as="p" variant="bodySm" tone="subdued">{mapFinishPoint.address}</Text></BlockStack><Button variant="tertiary" onClick={() => { setMapFinishPoint(null); clearOptimisedStats(); }}>Clear</Button></InlineStack></Box> : null}
                  {!returnToBase && !mapFinishPoint ? <CollapsibleAddressEditor title="Custom finish location" address={customFinishAddress} onChange={(value) => { setCustomFinishAddress(value); setMapFinishPoint(null); clearOptimisedStats(); }} summary={customFinishSummary} /> : null}`,
);

writeFileSync(planningPath, planning);
console.log("Planning map hover and right-click endpoint hotfix applied.");
