import { readFileSync, writeFileSync } from "node:fs";

const routeMapPath = "app/components/RouteMap.tsx";
let source = readFileSync(routeMapPath, "utf8");

if (source.includes("onMapContextAction") && source.includes("onPointContextAction")) {
  if (!source.includes("pinTouchTargetLayerIdRef")) {
    throw new Error("RouteMap context action API is present, but the pin touch-target layer is missing. Update RouteMap directly instead of applying the legacy hotfix.");
  }

  console.log("Route map pin touch-target hotfix already covered.");
  process.exit(0);
}

function replaceOnce(label, from, to) {
  if (source.includes(to)) {
    return;
  }

  if (!source.includes(from)) {
    throw new Error(`Could not apply route map pin touch-target hotfix: ${label}`);
  }

  source = source.replace(from, to);
}

replaceOnce(
  "add touch-target layer ref",
  `  const pinsLayerIdRef = useRef(\`pins-\${Math.random().toString(36).slice(2)}\`);\n  const pinLabelLayerIdRef = useRef(\`pin-labels-\${Math.random().toString(36).slice(2)}\`);`,
  `  const pinsLayerIdRef = useRef(\`pins-\${Math.random().toString(36).slice(2)}\`);\n  const pinTouchTargetLayerIdRef = useRef(\`pin-touch-targets-\${Math.random().toString(36).slice(2)}\`);\n  const pinLabelLayerIdRef = useRef(\`pin-labels-\${Math.random().toString(36).slice(2)}\`);`,
);

replaceOnce(
  "read touch-target layer id",
  `    const pinsLayerId = pinsLayerIdRef.current;\n    const pinLabelLayerId = pinLabelLayerIdRef.current;`,
  `    const pinsLayerId = pinsLayerIdRef.current;\n    const pinTouchTargetLayerId = pinTouchTargetLayerIdRef.current;\n    const pinLabelLayerId = pinLabelLayerIdRef.current;`,
);

replaceOnce(
  "remove touch-target layer",
  `    removeLayer(pinLabelLayerId);\n    removeLayer(pinsLayerId);`,
  `    removeLayer(pinLabelLayerId);\n    removeLayer(pinsLayerId);\n    removeLayer(pinTouchTargetLayerId);`,
);

replaceOnce(
  "add touch-target layer",
  `    map.addLayer({\n      id: pinsLayerId,\n      type: "circle",\n      source: sourceId,\n      filter: ["!", ["has", "point_count"]],`,
  `    map.addLayer({\n      id: pinTouchTargetLayerId,\n      type: "circle",\n      source: sourceId,\n      filter: ["!", ["has", "point_count"]],\n      paint: {\n        "circle-radius": 30,\n        "circle-color": "#000000",\n        "circle-opacity": 0.001,\n      },\n    });\n\n    map.addLayer({\n      id: pinsLayerId,\n      type: "circle",\n      source: sourceId,\n      filter: ["!", ["has", "point_count"]],`,
);

replaceOnce(
  "register touch-target click",
  `    map.on("click", pinsLayerId, handlePinClick);\n    map.on("click", pinLabelLayerId, handlePinClick);`,
  `    map.on("click", pinTouchTargetLayerId, handlePinClick);\n    map.on("click", pinsLayerId, handlePinClick);\n    map.on("click", pinLabelLayerId, handlePinClick);`,
);

replaceOnce(
  "register touch-target pointer feedback",
  `    map.on("mouseenter", pinsLayerId, showPopup);`,
  `    map.on("mouseenter", pinTouchTargetLayerId, handleClusterEnter);\n    map.on("mouseleave", pinTouchTargetLayerId, handleClusterLeave);\n    map.on("mouseenter", pinsLayerId, showPopup);`,
);

replaceOnce(
  "remove touch-target click",
  `      map.off("click", pinsLayerId, handlePinClick);\n      map.off("click", pinLabelLayerId, handlePinClick);`,
  `      map.off("click", pinTouchTargetLayerId, handlePinClick);\n      map.off("click", pinsLayerId, handlePinClick);\n      map.off("click", pinLabelLayerId, handlePinClick);`,
);

replaceOnce(
  "remove touch-target pointer feedback",
  `      map.off("mouseenter", pinsLayerId, showPopup);`,
  `      map.off("mouseenter", pinTouchTargetLayerId, handleClusterEnter);\n      map.off("mouseleave", pinTouchTargetLayerId, handleClusterLeave);\n      map.off("mouseenter", pinsLayerId, showPopup);`,
);

writeFileSync(routeMapPath, source);
console.log("Route map pin touch-target hotfix applied.");
