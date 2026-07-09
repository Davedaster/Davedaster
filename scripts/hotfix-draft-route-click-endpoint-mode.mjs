import { readFileSync, writeFileSync } from "node:fs";

const routeMapPath = "app/components/RouteMap.tsx";
const routeDetailsPath = "app/routes/app.routes.$routeId.tsx";

function replaceOnce(source, label, from, to) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Could not apply draft route click endpoint mode hotfix: ${label}`);
  return source.replace(from, to);
}

let routeMap = readFileSync(routeMapPath, "utf8");

routeMap = replaceOnce(
  routeMap,
  "add endpoint pick mode props",
  `  onSetRouteEndpoint?: (endpoint: RouteEndpointSelection) => void;
  apiKey?: string | null;`,
  `  onSetRouteEndpoint?: (endpoint: RouteEndpointSelection) => void;
  routeEndpointPickMode?: "START" | "FINISH" | null;
  onRouteEndpointPickComplete?: () => void;
  apiKey?: string | null;`,
);

routeMap = replaceOnce(
  routeMap,
  "destructure endpoint pick mode props",
  `  onSelectPoint,
  onSetRouteEndpoint,
  apiKey,`,
  `  onSelectPoint,
  onSetRouteEndpoint,
  routeEndpointPickMode = null,
  onRouteEndpointPickComplete,
  apiKey,`,
);

routeMap = replaceOnce(
  routeMap,
  "add endpoint pick click handler",
  `    const handleContextMenu = (event: any) => {
      if (!onSetRouteEndpoint) {
        return;
      }

      event.preventDefault?.();
      event.originalEvent?.preventDefault?.();
      showContextMenuAt(event.point, event.lngLat);
    };`,
  `    const handleContextMenu = (event: any) => {
      if (!onSetRouteEndpoint) {
        return;
      }

      event.preventDefault?.();
      event.originalEvent?.preventDefault?.();
      showContextMenuAt(event.point, event.lngLat);
    };

    const handleRouteEndpointPickClick = (event: any) => {
      if (!routeEndpointPickMode || !onSetRouteEndpoint) {
        return;
      }

      event.preventDefault?.();
      event.originalEvent?.preventDefault?.();
      hidePopup();
      setContextMenu(null);

      const latitude = event.lngLat?.lat;
      const longitude = event.lngLat?.lng;

      if (typeof latitude !== "number" || typeof longitude !== "number") {
        return;
      }

      onSetRouteEndpoint({
        status: routeEndpointPickMode,
        address: "Map point " + latitude.toFixed(5) + ", " + longitude.toFixed(5),
        latitude,
        longitude,
      });
      onRouteEndpointPickComplete?.();
    };`,
);

routeMap = replaceOnce(
  routeMap,
  "wire endpoint pick click handler",
  `    map.on("click", hideContextMenu);
    map.on("contextmenu", handleContextMenu);`,
  `    map.on("click", hideContextMenu);
    map.on("click", handleRouteEndpointPickClick);
    map.on("contextmenu", handleContextMenu);`,
);

routeMap = replaceOnce(
  routeMap,
  "cleanup endpoint pick click handler",
  `      map.off("click", hideContextMenu);
      map.off("contextmenu", handleContextMenu);`,
  `      map.off("click", hideContextMenu);
      map.off("click", handleRouteEndpointPickClick);
      map.off("contextmenu", handleContextMenu);`,
);

routeMap = replaceOnce(
  routeMap,
  "include endpoint pick dependencies",
  `  }, [mapReady, mappablePoints, onSelectPoint, onSetRouteEndpoint, roadRouteCoordinates, routeEndpoints, routePathPoints, selectedPoints.length, showRouteLine]);`,
  `  }, [mapReady, mappablePoints, onRouteEndpointPickComplete, onSelectPoint, onSetRouteEndpoint, roadRouteCoordinates, routeEndpointPickMode, routeEndpoints, routePathPoints, selectedPoints.length, showRouteLine]);`,
);

writeFileSync(routeMapPath, routeMap);

let routeDetails = readFileSync(routeDetailsPath, "utf8");

routeDetails = replaceOnce(
  routeDetails,
  "add endpoint pick mode state",
  `  const [finishLongitude, setFinishLongitude] = useState(route.finishLongitude === null || typeof route.finishLongitude === "undefined" ? "" : String(route.finishLongitude));`,
  `  const [finishLongitude, setFinishLongitude] = useState(route.finishLongitude === null || typeof route.finishLongitude === "undefined" ? "" : String(route.finishLongitude));
  const [routeEndpointPickMode, setRouteEndpointPickMode] = useState<"START" | "FINISH" | null>(null);`,
);

routeDetails = replaceOnce(
  routeDetails,
  "clear endpoint pick mode after setting point",
  `      setFinishAddress(endpoint.address);
      setFinishLatitude(String(endpoint.latitude));
      setFinishLongitude(String(endpoint.longitude));
    }
  };`,
  `      setFinishAddress(endpoint.address);
      setFinishLatitude(String(endpoint.latitude));
      setFinishLongitude(String(endpoint.longitude));
    }

    setRouteEndpointPickMode(null);
  };`,
);

routeDetails = replaceOnce(
  routeDetails,
  "replace draft right click map with button click mode",
  `              {route.status === "DRAFT" && tomtomApiKey ? (
                <RouteMap
                  title="Draft route map"
                  badge="Right click to set start or end"
                  height={360}
                  apiKey={tomtomApiKey}
                  points={draftRouteMapPoints}
                  showRouteLine={draftRouteMapPoints.length > 0}
                  routeStart={{ address: startAddress, label: "START", latitude: startLatitude ? Number(startLatitude) : null, longitude: startLongitude ? Number(startLongitude) : null, status: "START" }}
                  routeFinish={{ address: finishAddress || startAddress, label: "FINISH", latitude: finishLatitude ? Number(finishLatitude) : null, longitude: finishLongitude ? Number(finishLongitude) : null, status: "FINISH" }}
                  onSetRouteEndpoint={handleDraftRouteEndpoint}
                />
              ) : null}`, 
  `              {route.status === "DRAFT" && tomtomApiKey ? (
                <BlockStack gap="200">
                  <InlineStack gap="200" wrap>
                    <Button variant={routeEndpointPickMode === "START" ? "primary" : "secondary"} onClick={() => setRouteEndpointPickMode(routeEndpointPickMode === "START" ? null : "START")}>Set start from map</Button>
                    <Button variant={routeEndpointPickMode === "FINISH" ? "primary" : "secondary"} onClick={() => setRouteEndpointPickMode(routeEndpointPickMode === "FINISH" ? null : "FINISH")}>Set end from map</Button>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone={routeEndpointPickMode ? "success" : "subdued"}>
                    {routeEndpointPickMode ? "Now click anywhere on the map to set this point. Save route planning afterwards." : "Use the buttons above, then click the map. Right click is still available where the browser allows it."}
                  </Text>
                  <RouteMap
                    title="Draft route map"
                    badge={routeEndpointPickMode ? "Click map to set " + (routeEndpointPickMode === "START" ? "start" : "end") : "Set start or end from map"}
                    height={360}
                    apiKey={tomtomApiKey}
                    points={draftRouteMapPoints}
                    showRouteLine={draftRouteMapPoints.length > 0}
                    routeStart={{ address: startAddress, label: "START", latitude: startLatitude ? Number(startLatitude) : null, longitude: startLongitude ? Number(startLongitude) : null, status: "START" }}
                    routeFinish={{ address: finishAddress || startAddress, label: "FINISH", latitude: finishLatitude ? Number(finishLatitude) : null, longitude: finishLongitude ? Number(finishLongitude) : null, status: "FINISH" }}
                    routeEndpointPickMode={routeEndpointPickMode}
                    onRouteEndpointPickComplete={() => setRouteEndpointPickMode(null)}
                    onSetRouteEndpoint={handleDraftRouteEndpoint}
                  />
                </BlockStack>
              ) : null}`,
);

writeFileSync(routeDetailsPath, routeDetails);
console.log("Draft route click endpoint mode hotfix applied.");
