import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const packagePath = "package.json";
const customerHotfix = "scripts/hotfix-customer-notification-results.mjs";
const twilioHotfix = "scripts/hotfix-twilio-sms-filtering.mjs";
const workflowPath = ".github/workflows/agent-migrate-notification-hotfixes.yml";
const selfPath = "scripts/agent-migrate-notification-hotfixes.mjs";

execFileSync(process.execPath, [customerHotfix], { stdio: "inherit" });
execFileSync(process.execPath, [twilioHotfix], { stdio: "inherit" });

let packageSource = readFileSync(packagePath, "utf8");

for (const command of [
  " && node scripts/hotfix-customer-notification-results.mjs",
  " && node scripts/hotfix-twilio-sms-filtering.mjs",
]) {
  if (!packageSource.includes(command)) {
    throw new Error(`Expected package command was not found: ${command}`);
  }

  packageSource = packageSource.replaceAll(command, "");
}

writeFileSync(packagePath, packageSource);
rmSync(customerHotfix);
rmSync(twilioHotfix);
rmSync(workflowPath);
rmSync(selfPath);

console.log("Notification result and Twilio filtering hotfixes migrated into source.");
