import { readFileSync, rmSync, writeFileSync } from "node:fs";

const templatePath = "app/lib/notificationTemplates.server.ts";
const workflowPath = ".github/workflows/agent-clean-notification-template.yml";
const selfPath = "scripts/agent-clean-notification-template.mjs";
const unusedConstant = 'const GOOGLE_REVIEW_URL = "https://g.page/r/CZDHYoyjIf6CEAE/review";\n';

const source = readFileSync(templatePath, "utf8");

if (!source.includes(unusedConstant)) {
  throw new Error("Unused Google review URL constant was not found.");
}

writeFileSync(templatePath, source.replace(unusedConstant, ""));
rmSync(workflowPath);
rmSync(selfPath);

console.log("Unused notification template constant removed.");
