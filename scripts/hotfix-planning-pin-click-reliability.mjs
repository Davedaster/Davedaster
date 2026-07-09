import { readFileSync, writeFileSync } from "node:fs";

const routeMapPath = "app/components/RouteMap.tsx";

function replaceOnce(source, label, from, to) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Could not apply planning pin click reliability hotfix: ${label}`);
  return source.replace(from, to);
}

let source = readFileSync(routeMapPath, "utf8");

source = replaceOnce(
  source,
  "add immediate pointer selection ref",
  `  const popupRef = useRef<TomTomPopupRef | null>(null);
  const hasInitialFitRef = useRef(false);`,
  `  const popupRef = useRef<TomTomPopupRef | null>(null);
  const immediatePinSelectRef = useRef<{ id: string; at: number } | null>(null);
  const hasInitialFitRef = useRef(false);`,
);

source = replaceOnce(
  source,
  "replace pin click handler with query-based selection",
  `    const handlePinClick = (event: any) => {
      const feature = event.features?.[0];
      const id = feature?.properties?.id;
      const point = mappablePoints.find((mapPoint) => mapPoint.id === id);

      if (point) {
        onSelectPoint?.(point);
      }
    };`,
  `    const findPinFeature = (event: any) => {
      const clickableLayers = [pinLabelLayerId, pinsLayerId].filter((layerId) => map.getLayer(layerId));
      const queriedFeatures = clickableLayers.length && event.point
        ? map.queryRenderedFeatures(event.point, { layers: clickableLayers })
        : [];
      const eventFeatures = Array.isArray(event.features) ? event.features : [];

      return [...queriedFeatures, ...eventFeatures].find((feature: any) => feature?.properties?.id && !feature.properties.point_count);
    };

    const selectPinFeature = (feature: any) => {
      const id = feature?.properties?.id;
      const point = mappablePoints.find((mapPoint) => mapPoint.id === id);

      if (!point) {
        return null;
      }

      onSelectPoint?.(point);
      setContextMenu(null);
      return point.id;
    };

    const handlePinPointerDown = (event: any) => {
      const mouseButton = event.originalEvent?.button;

      if (typeof mouseButton === "number" && mouseButton !== 0) {
        return;
      }

      const feature = findPinFeature(event);
      const selectedId = selectPinFeature(feature);

      if (selectedId) {
        event.preventDefault?.();
        event.originalEvent?.preventDefault?.();
        immediatePinSelectRef.current = { id: selectedId, at: Date.now() };
        map.getCanvas().style.cursor = "pointer";
      }
    };

    const handlePinClick = (event: any) => {
      const feature = findPinFeature(event);
      const id = feature?.properties?.id;
      const immediateSelection = immediatePinSelectRef.current;

      if (id && immediateSelection?.id === id && Date.now() - immediateSelection.at < 700) {
        return;
      }

      selectPinFeature(feature);
    };`,
);

source = replaceOnce(
  source,
  "add immediate pointer event",
  `    map.on("click", pinsLayerId, handlePinClick);
    map.on("click", pinLabelLayerId, handlePinClick);`,
  `    map.on("mousedown", handlePinPointerDown);
    map.on("click", pinsLayerId, handlePinClick);
    map.on("click", pinLabelLayerId, handlePinClick);`,
);

source = replaceOnce(
  source,
  "remove immediate pointer event",
  `      map.off("click", pinsLayerId, handlePinClick);
      map.off("click", pinLabelLayerId, handlePinClick);`,
  `      map.off("mousedown", handlePinPointerDown);
      map.off("click", pinsLayerId, handlePinClick);
      map.off("click", pinLabelLayerId, handlePinClick);`,
);

writeFileSync(routeMapPath, source);
console.log("Planning pin click reliability hotfix applied.");
