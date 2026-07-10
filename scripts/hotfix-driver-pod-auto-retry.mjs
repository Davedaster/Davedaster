import { readFileSync, writeFileSync } from "node:fs";

const routePath = "app/routes/driver.routes.$token.tsx";
let source = readFileSync(routePath, "utf8");

function replaceOnce(label, from, to) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Could not apply driver POD auto retry hotfix: ${label}`);
  source = source.replace(from, to);
}

replaceOnce(
  "add draft retry imports",
  `import {
  fileFromDriverPodDraft,
  readDriverPodDraft,
  writeDriverPodDraft,
} from "../lib/driverProofDrafts.client";`,
  `import {
  clearDriverPodDraft,
  fileFromDriverPodDraft,
  isDriverPodDraftUploadFile,
  readDriverPodDraft,
  writeDriverPodDraft,
} from "../lib/driverProofDrafts.client";`,
);

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
  `  function waitForPodRetry(attempt: number) {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, DRIVER_POD_AUTO_RETRY_DELAY_MS * attempt);
    });
  }

  function shouldRetryPodResponse(status: number, message: string) {
    if (status === 408 || status === 425 || status === 429 || status >= 500) {
      return true;
    }

    return /failed to fetch|network error|network request failed|connection (?:lost|failed|reset)|timed? out|offline|signal weak/i.test(message);
  }

  async function submitDeliveryFormWithRetry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (podUploadStatus === "retrying") {
      return;
    }

    const form = event.currentTarget;
    setPodUploadStatus("retrying");
    setPodUploadMessage("");

    for (let attempt = 1; attempt <= DRIVER_POD_AUTO_RETRY_ATTEMPTS; attempt += 1) {
      let retryThisFailure = true;

      try {
        const formData = new FormData(form);
        const selectedProofFiles = formData.getAll("proofPhotoFiles").filter(isDriverPodDraftUploadFile);
        const restoredProofFiles = [proofPhotoOneDraftFile, deliveryMode === "safe" ? proofPhotoTwoDraftFile : null].filter((file): file is File => Boolean(file));

        for (const restoredFile of restoredProofFiles.slice(selectedProofFiles.length)) {
          formData.append("proofPhotoFiles", restoredFile, restoredFile.name);
        }

        const response = await fetch(form.action || window.location.href, {
          method: "POST",
          body: formData,
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });

        if (response.redirected) {
          await clearDriverPodDraft(driverPodDraftKey);
          window.location.assign(response.url);
          return;
        }

        if (response.ok) {
          await clearDriverPodDraft(driverPodDraftKey);
          window.location.assign(window.location.pathname + "#next-stop");
          return;
        }

        let message = "Delivery could not be saved yet.";

        try {
          const data = await response.clone().json() as { error?: string };
          if (data.error) message = data.error;
        } catch {
          // Keep the simple message if the response was not JSON.
        }

        retryThisFailure = shouldRetryPodResponse(response.status, message);
        throw new Error(message);
      } catch (error) {
        if (!retryThisFailure || attempt >= DRIVER_POD_AUTO_RETRY_ATTEMPTS) {
          setPodUploadStatus("failed");
          setPodUploadMessage(error instanceof Error ? error.message : "Delivery could not be saved. Please try again when signal improves.");
          return;
        }

        setPodUploadMessage("Signal weak. Retrying quietly...");
        await waitForPodRetry(attempt);
      }
    }
  }

  function handleProofPhotoChange(event: ChangeEvent<HTMLInputElement>, slot: 1 | 2) {`,
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
