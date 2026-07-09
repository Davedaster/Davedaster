import { readFileSync, writeFileSync } from "node:fs";

const routePath = "app/routes/driver.routes.$token.tsx";
let source = readFileSync(routePath, "utf8");

function replaceOnce(label, from, to) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Could not apply driver POD auto retry hotfix: ${label}`);
  source = source.replace(from, to);
}

replaceOnce(
  "add retry constants",
  `const DRIVER_ROUTE_REFRESH_MS = 15000;\nconst COLLECTION_COLOUR = "#b42318";`,
  `const DRIVER_ROUTE_REFRESH_MS = 15000;\nconst DRIVER_POD_AUTO_RETRY_ATTEMPTS = 3;\nconst DRIVER_POD_AUTO_RETRY_DELAY_MS = 3500;\nconst COLLECTION_COLOUR = "#b42318";`,
);

replaceOnce(
  "driver retry state",
  `  const navigation = useNavigation();\n  const isSubmittingThisStop = navigation.state !== "idle" && String(navigation.formData?.get("stopId") || "") === stopId;`,
  `  const navigation = useNavigation();\n  const [podUploadStatus, setPodUploadStatus] = useState<"idle" | "retrying" | "failed">("idle");\n  const [podUploadMessage, setPodUploadMessage] = useState("");\n  const isAutoRetryingThisStop = podUploadStatus === "retrying";\n  const isSubmittingThisStop = (navigation.state !== "idle" && String(navigation.formData?.get("stopId") || "") === stopId) || isAutoRetryingThisStop;`,
);

replaceOnce(
  "driver retry helpers",
  `  function handleProofPhotoChange(event: ChangeEvent<HTMLInputElement>, slot: 1 | 2) {`,
  `  function waitForPodRetry(attempt: number) {\n    return new Promise<void>((resolve) => {\n      window.setTimeout(resolve, DRIVER_POD_AUTO_RETRY_DELAY_MS * attempt);\n    });\n  }\n\n  async function submitDeliveryFormWithRetry(event: FormEvent<HTMLFormElement>) {\n    event.preventDefault();\n\n    if (podUploadStatus === "retrying") {\n      return;\n    }\n\n    const form = event.currentTarget;\n    setPodUploadStatus("retrying");\n    setPodUploadMessage("");\n\n    for (let attempt = 1; attempt <= DRIVER_POD_AUTO_RETRY_ATTEMPTS; attempt += 1) {\n      let retryThisFailure = true;\n\n      try {\n        const response = await fetch(form.action || window.location.href, {\n          method: "POST",\n          body: new FormData(form),\n          credentials: "same-origin",\n          headers: { Accept: "application/json" },\n        });\n\n        if (response.redirected) {\n          window.location.assign(response.url);\n          return;\n        }\n\n        if (response.ok) {\n          window.location.assign(window.location.pathname + "#next-stop");\n          return;\n        }\n\n        let message = "Delivery could not be saved yet.";\n\n        try {\n          const data = await response.clone().json() as { error?: string };\n          if (data.error) message = data.error;\n        } catch {\n          // Keep the simple message if the response was not JSON.\n        }\n\n        retryThisFailure = response.status >= 500 || /signal|upload|connection|network|fetch|form/i.test(message);\n        throw new Error(message);\n      } catch (error) {\n        if (!retryThisFailure || attempt >= DRIVER_POD_AUTO_RETRY_ATTEMPTS) {\n          setPodUploadStatus("failed");\n          setPodUploadMessage(error instanceof Error ? error.message : "Delivery could not be saved. Please try again when signal improves.");\n          return;\n        }\n\n        setPodUploadMessage("Signal weak. Retrying quietly...");\n        await waitForPodRetry(attempt);\n      }\n    }\n  }\n\n  function handleProofPhotoChange(event: ChangeEvent<HTMLInputElement>, slot: 1 | 2) {`,
);

replaceOnce(
  "driver form auto retry submit",
  `<Form method="post" encType="multipart/form-data" style={{ display: "grid", gap: 12, border: "1px solid #e5e7eb", borderRadius: 18, padding: 12, background: "#f8fafc", maxWidth: "100%", overflow: "hidden", boxSizing: "border-box" }}>`,
  `<Form method="post" encType="multipart/form-data" onSubmit={submitDeliveryFormWithRetry} style={{ display: "grid", gap: 12, border: "1px solid #e5e7eb", borderRadius: 18, padding: 12, background: "#f8fafc", maxWidth: "100%", overflow: "hidden", boxSizing: "border-box" }}>`,
);

replaceOnce(
  "driver quiet retry message",
  `<button type="submit" disabled={deliveryMode === "customer" ? !canCompleteCustomer : !canCompleteSafePlace}`,
  `{podUploadMessage ? <p style={{ margin: 0, color: podUploadStatus === "failed" ? "#b42318" : "#667085", fontWeight: 800, fontSize: 13 }}>{podUploadMessage}</p> : null}\n          <button type="submit" disabled={deliveryMode === "customer" ? !canCompleteCustomer : !canCompleteSafePlace}`,
);

writeFileSync(routePath, source);
console.log("Driver POD quiet auto retry hotfix applied.");
