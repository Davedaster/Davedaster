import { readFileSync, writeFileSync } from "node:fs";
const routePath = "app/routes/driver.routes.$token.tsx";
let source = readFileSync(routePath, "utf8");
writeFileSync(routePath, source);
