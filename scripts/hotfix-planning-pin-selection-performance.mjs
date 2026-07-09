import { readFileSync, writeFileSync } from "node:fs";

const routeMapPath = "app/components/RouteMap.tsx";
const planningPath = "app/routes/app._index.tsx";

function replaceOnce(source, label, from, to) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Could not apply planning pin performance hotfix: ${label}`);
  return source.replace(from, to);
}

let routeMap = readFileSync(routeMapPath, "utf8");

routeMap = replaceOnce(
  routeMap,
  "show straight route immediately before debounced TomTom route",
  `      const fallback = straightLineCoordinates(routePathPoints);

      try {`,
  `      const fallback = straightLineCoordinates(routePathPoints);

      if (!cancelled) {
        setRoadRouteCoordinates(fallback);
      }

      try {`,
);

routeMap = replaceOnce(
  routeMap,
  "debounce TomTom road route requests while selecting pins",
  `    loadRoadRoute();

    return () => {
      cancelled = true;
    };`,
  `    const roadRouteTimer = window.setTimeout(() => {
      void loadRoadRoute();
    }, 900);

    return () => {
      cancelled = true;
      window.clearTimeout(roadRouteTimer);
    };`,
);

writeFileSync(routeMapPath, routeMap);

let planning = readFileSync(planningPath, "utf8");

planning = replaceOnce(
  planning,
  "slow live ETA preview debounce while selecting pins",
  `    const timer = window.setTimeout(() => {
      submitEtaPreview();
    }, 350);`,
  `    const timer = window.setTimeout(() => {
      submitEtaPreview();
    }, 1200);`,
);

writeFileSync(planningPath, planning);
console.log("Planning pin selection performance hotfix applied.");
