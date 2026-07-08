import { readFileSync, writeFileSync } from "node:fs";
const p = "README.md";
const s = readFileSync(p, "utf8");
writeFileSync(p, s);
