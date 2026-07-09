import { readFileSync, writeFileSync } from "node:fs";

const routeMapPath = "app/components/RouteMap.tsx";
let source = readFileSync(routeMapPath, "utf8");

const from = `      return !window.matchMedia("(max-width: 1024px), (pointer: coarse)").matches;`;
const to = `      const canHover = window.matchMedia("(hover: hover), (any-hover: hover)").matches;
      const hasFinePointer = window.matchMedia("(pointer: fine), (any-pointer: fine)").matches;

      return canHover || hasFinePointer;`;

if (!source.includes(to)) {
  if (!source.includes(from)) {
    throw new Error("Could not apply route map hover tooltip hotfix.");
  }

  source = source.replace(from, to);
}

writeFileSync(routeMapPath, source);
console.log("Route map hover tooltip hotfix applied.");
