import { readFileSync, writeFileSync } from "node:fs";

const driverRoutePath = "app/routes/.driver.routes.$token.source.tsx";
const proofOfDeliveryPath = "app/lib/proofOfDelivery.server.ts";

function replaceOnce(source, label, from, to) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Could not apply safe place note optional hotfix: ${label}`);
  return source.replace(from, to);
}

let driverRoute = readFileSync(driverRoutePath, "utf8");

driverRoute = replaceOnce(
  driverRoute,
  "driver safe place completion rule",
  `const canCompleteSafePlace = !updatesDisabled && !isSubmittingThisStop && deliveryMode === "safe" && proofPhotoCount >= 2 && safePlaceNote.trim().length > 0;`,
  `const canCompleteSafePlace = !updatesDisabled && !isSubmittingThisStop && deliveryMode === "safe" && proofPhotoCount >= 2;`,
);

driverRoute = replaceOnce(
  driverRoute,
  "driver safe place helper text",
  `Needs 2 photos and a safe place note.`,
  `Needs 2 photos. Safe place note optional.`,
);

writeFileSync(driverRoutePath, driverRoute);

let proofOfDelivery = readFileSync(proofOfDeliveryPath, "utf8");

proofOfDelivery = replaceOnce(
  proofOfDelivery,
  "server safe place note validation",
  `
  if (leftInSafePlace && !input.safePlaceNote?.trim()) {
    throw new Error("Add a safe place note before marking delivered.");
  }
 `,
  `
 `,
);

writeFileSync(proofOfDeliveryPath, proofOfDelivery);
console.log("Safe place note optional hotfix applied.");
