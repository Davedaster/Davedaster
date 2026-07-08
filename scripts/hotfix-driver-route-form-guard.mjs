import { readFileSync, writeFileSync } from "node:fs";

const routePath = "app/routes/driver.routes.$token.tsx";
let source = readFileSync(routePath, "utf8");

function replaceOnce(label, from, to) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Could not apply driver route form guard: ${label}`);
  source = source.replace(from, to);
}

replaceOnce(
  "move form parsing inside action guard",
  `  const formData = await request.formData();
  const intent = String(formData.get("intent") || "startRoute");

  try {`,
  `  let intent = "unknown";
  let stopId = "";

  try {
    const formData = await request.formData();
    intent = String(formData.get("intent") || "startRoute");`,
);

replaceOnce(
  "track action stop id",
  `    const stopId = String(formData.get("stopId") || "").trim();`,
  `    stopId = String(formData.get("stopId") || "").trim();`,
);

replaceOnce(
  "friendly form failure response",
  `  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Driver route action failed." }, { status: 400 });
  }`,
  `  } catch (error) {
    const message = error instanceof Error ? error.message : "Driver route action failed.";
    const isDeliverySubmit = intent === "unknown" || intent === "completeStop" || intent === "completeCollectionStop";

    return json({
      ok: false,
      intent,
      stopId,
      error: isDeliverySubmit
        ? message + " Please check signal and press Complete delivery again. Proof is only saved after the app confirms the delivery."
        : message,
    }, { status: 400 });
  }`,
);

writeFileSync(routePath, source);
console.log("Driver route form guard hotfix applied.");
