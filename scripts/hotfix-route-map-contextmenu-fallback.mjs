import { readFileSync, writeFileSync } from "node:fs";

const routeMapPath = "app/components/RouteMap.tsx";

function replaceOnce(source, label, from, to) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Could not apply route map context menu fallback hotfix: ${label}`);
  return source.replace(from, to);
}

let source = readFileSync(routeMapPath, "utf8");

source = replaceOnce(
  source,
  "add dom context menu fallback handler",
  `    const handleContextMenu = (event: any) => {
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
  `    const showContextMenuAt = (point: { x: number; y: number } | null | undefined, lngLat: any) => {
      if (!onSetRouteEndpoint) {
        return;
      }

      const latitude = lngLat?.lat;
      const longitude = lngLat?.lng;

      if (typeof latitude !== "number" || typeof longitude !== "number") {
        return;
      }

      hidePopup();
      setContextMenu({
        left: point?.x || 0,
        top: point?.y || 0,
        latitude,
        longitude,
      });
    };

    const handleContextMenu = (event: any) => {
      if (!onSetRouteEndpoint) {
        return;
      }

      event.preventDefault?.();
      event.originalEvent?.preventDefault?.();
      showContextMenuAt(event.point, event.lngLat);
    };

    const handleDomContextMenu = (event: MouseEvent) => {
      if (!onSetRouteEndpoint) {
        return;
      }

      const mapContainer = mapElementRef.current;
      const bounds = mapContainer?.getBoundingClientRect();

      if (!bounds) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const point = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      const lngLat = typeof map.unproject === "function" ? map.unproject([point.x, point.y]) : null;

      showContextMenuAt(point, lngLat);
    };`,
);

source = replaceOnce(
  source,
  "wire dom context menu fallback",
  `    map.on("click", hideContextMenu);
    map.on("contextmenu", handleContextMenu);`,
  `    map.on("click", hideContextMenu);
    map.on("contextmenu", handleContextMenu);
    mapElementRef.current?.addEventListener("contextmenu", handleDomContextMenu, true);`,
);

source = replaceOnce(
  source,
  "cleanup dom context menu fallback",
  `      map.off("click", hideContextMenu);
      map.off("contextmenu", handleContextMenu);`,
  `      map.off("click", hideContextMenu);
      map.off("contextmenu", handleContextMenu);
      mapElementRef.current?.removeEventListener("contextmenu", handleDomContextMenu, true);`,
);

writeFileSync(routeMapPath, source);
console.log("Route map context menu fallback hotfix applied.");
