import { readFileSync, writeFileSync } from "node:fs";

const routePath = "app/routes/driver.routes.$token.tsx";
let source = readFileSync(routePath, "utf8");

function replaceOnce(label, from, to) {
  if (source.includes(to)) {
    return;
  }

  if (!source.includes(from)) {
    throw new Error(`Could not apply driver POD retry hotfix: ${label}`);
  }

  source = source.replace(from, to);
}

replaceOnce(
  "add POD retry helpers",
  `function ProofPreview({ src, alt }: { src: string; alt: string }) {
  return src ? <img src={src} alt={alt} style={{ width: "min(150px, 100%)", height: 150, borderRadius: 14, objectFit: "cover", border: "1px solid #d0d5dd", maxWidth: "100%" }} /> : null;
}`,
  `function ProofPreview({ src, alt }: { src: string; alt: string }) {
  return src ? <img src={src} alt={alt} style={{ width: "min(150px, 100%)", height: 150, borderRadius: 14, objectFit: "cover", border: "1px solid #d0d5dd", maxWidth: "100%" }} /> : null;
}

const POD_RETRY_DELAYS_MS = [5000, 10000, 20000, 30000, 60000];

function waitForPodRetry(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function podRetryDelay(attempt: number) {
  return POD_RETRY_DELAYS_MS[Math.min(attempt, POD_RETRY_DELAYS_MS.length - 1)];
}

async function readPodResponseError(response: Response) {
  try {
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const payload = await response.json() as { error?: string; message?: string };
      return payload.error || payload.message || `Save failed with status ${response.status}.`;
    }

    const text = await response.text();
    return text.trim().slice(0, 260) || `Save failed with status ${response.status}.`;
  } catch {
    return `Save failed with status ${response.status}.`;
  }
}

function normalisePodSubmitError(error: unknown) {
  return error instanceof Error ? error.message : "The delivery proof could not upload yet.";
}

function shouldRetryPodSave(message: string, status?: number) {
  const lower = message.toLowerCase();

  if (!status || status >= 500) return true;

  return (
    lower.includes("proof image upload failed") ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("aborted") ||
    lower.includes("poor signal")
  );
}

async function submitPodFormWithRetry(form: HTMLFormElement, setStatus: (value: string) => void, setError: (value: string) => void) {
  let attempt = 0;
  setError("");

  while (true) {
    setStatus(attempt === 0 ? "Uploading proof, keep this page open." : "Still trying to upload proof, keep this page open.");

    try {
      const response = await fetch(window.location.href, {
        method: "POST",
        body: new FormData(form),
        credentials: "same-origin",
      });

      if (response.ok || response.redirected) {
        setStatus("Delivery proof saved. Loading next stop...");
        window.location.href = `${window.location.pathname}${window.location.search}#next-stop`;
        window.location.reload();
        return;
      }

      const responseError = await readPodResponseError(response);

      if (!shouldRetryPodSave(responseError, response.status)) {
        setStatus("");
        setError(responseError);
        return;
      }

      throw new Error(responseError);
    } catch (error) {
      const message = normalisePodSubmitError(error);

      if (!shouldRetryPodSave(message)) {
        setStatus("");
        setError(message);
        return;
      }

      const delay = podRetryDelay(attempt);
      setStatus(`Poor signal, still trying. Next retry in ${Math.round(delay / 1000)} seconds. Keep this page open.`);
      await waitForPodRetry(delay);
      attempt += 1;
    }
  }
}`,
);

replaceOnce(
  "driver POD retry state",
  `  const [podLng, setPodLng] = useState("");
  const navigation = useNavigation();
  const isSubmittingThisStop = navigation.state !== "idle" && String(navigation.formData?.get("stopId") || "") === stopId;
  const updatesDisabled = isDisabled || !routeStarted;
  const proofPhotoCount = (proofPhotoOneSelected ? 1 : 0) + (proofPhotoTwoSelected ? 1 : 0) + (proofPhotoUrl.trim() ? 1 : 0);
  const canCompleteCustomer = !updatesDisabled && !isSubmittingThisStop && deliveryMode === "customer" && proofPhotoCount >= 1 && podImage.length > 0;
  const canCompleteSafePlace = !updatesDisabled && !isSubmittingThisStop && deliveryMode === "safe" && proofPhotoCount >= 2 && safePlaceNote.trim().length > 0;`,
  `  const [podLng, setPodLng] = useState("");
  const [podSubmitStatus, setPodSubmitStatus] = useState("");
  const [podSubmitError, setPodSubmitError] = useState("");
  const navigation = useNavigation();
  const isSubmittingThisStop = navigation.state !== "idle" && String(navigation.formData?.get("stopId") || "") === stopId;
  const isPodRetrying = Boolean(podSubmitStatus);
  const updatesDisabled = isDisabled || !routeStarted;
  const proofPhotoCount = (proofPhotoOneSelected ? 1 : 0) + (proofPhotoTwoSelected ? 1 : 0) + (proofPhotoUrl.trim() ? 1 : 0);
  const canCompleteCustomer = !updatesDisabled && !isSubmittingThisStop && !isPodRetrying && deliveryMode === "customer" && proofPhotoCount >= 1 && podImage.length > 0;
  const canCompleteSafePlace = !updatesDisabled && !isSubmittingThisStop && !isPodRetrying && deliveryMode === "safe" && proofPhotoCount >= 2 && safePlaceNote.trim().length > 0;`,
);

replaceOnce(
  "driver POD retry submit handler",
  `  if (!routeStarted) return <p style={{ margin: "12px 0 0", color: "#667085", fontWeight: 800 }}>Start the route before completing stops.</p>;`,
  `  async function handlePodSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (deliveryMode === "customer" ? !canCompleteCustomer : !canCompleteSafePlace) {
      return;
    }

    await submitPodFormWithRetry(event.currentTarget, setPodSubmitStatus, setPodSubmitError);
  }

  if (!routeStarted) return <p style={{ margin: "12px 0 0", color: "#667085", fontWeight: 800 }}>Start the route before completing stops.</p>;`,
);

replaceOnce(
  "driver POD retry form",
  `<Form method="post" encType="multipart/form-data" style={{ display: "grid", gap: 12, border: "1px solid #e5e7eb", borderRadius: 18, padding: 12, background: "#f8fafc", maxWidth: "100%", overflow: "hidden", boxSizing: "border-box" }}>`,
  `<Form method="post" encType="multipart/form-data" onSubmit={handlePodSubmit} style={{ display: "grid", gap: 12, border: "1px solid #e5e7eb", borderRadius: 18, padding: 12, background: "#f8fafc", maxWidth: "100%", overflow: "hidden", boxSizing: "border-box" }}>`,
);

replaceOnce(
  "driver POD retry message",
  `<button type="submit" disabled={deliveryMode === "customer" ? !canCompleteCustomer : !canCompleteSafePlace} style={{ width: "100%", ...buttonStyle((deliveryMode === "customer" ? canCompleteCustomer : canCompleteSafePlace) ? "#16a34a" : "#d0d5dd", (deliveryMode === "customer" ? canCompleteCustomer : canCompleteSafePlace) ? "#ffffff" : "#667085") }}>{isSubmittingThisStop ? "Saving delivery..." : "Complete delivery"}</button>`,
  `<button type="submit" disabled={deliveryMode === "customer" ? !canCompleteCustomer : !canCompleteSafePlace} style={{ width: "100%", ...buttonStyle((deliveryMode === "customer" ? canCompleteCustomer : canCompleteSafePlace) ? "#16a34a" : "#d0d5dd", (deliveryMode === "customer" ? canCompleteCustomer : canCompleteSafePlace) ? "#ffffff" : "#667085") }}>{isSubmittingThisStop || podSubmitStatus ? "Saving delivery..." : "Complete delivery"}</button>{podSubmitStatus ? <p style={{ margin: 0, color: "#175cd3", fontWeight: 900, fontSize: 13 }}>{podSubmitStatus}</p> : null}{podSubmitError ? <p style={{ margin: 0, color: "#b42318", fontWeight: 900, fontSize: 13 }}>{podSubmitError}</p> : null}`,
);

replaceOnce(
  "collection POD retry state",
  `  const [failedNote, setFailedNote] = useState("");
  const navigation = useNavigation();
  const isSubmittingThisStop = navigation.state !== "idle" && String(navigation.formData?.get("stopId") || "") === stopId;
  const updatesDisabled = isDisabled || !routeStarted;
  const proofPhotoCount = (proofPhotoOneSelected ? 1 : 0) + (proofPhotoTwoSelected ? 1 : 0) + (proofPhotoUrl.trim() ? 1 : 0);
  const canCompleteCustomer = !updatesDisabled && !isSubmittingThisStop && collectionMode === "customer" && proofPhotoCount >= 1 && signatureImage.length > 0;
  const canCompleteSafePlace = !updatesDisabled && !isSubmittingThisStop && collectionMode === "safe" && proofPhotoCount >= 2 && safePlaceNote.trim().length > 0;`,
  `  const [failedNote, setFailedNote] = useState("");
  const [podSubmitStatus, setPodSubmitStatus] = useState("");
  const [podSubmitError, setPodSubmitError] = useState("");
  const navigation = useNavigation();
  const isSubmittingThisStop = navigation.state !== "idle" && String(navigation.formData?.get("stopId") || "") === stopId;
  const isPodRetrying = Boolean(podSubmitStatus);
  const updatesDisabled = isDisabled || !routeStarted;
  const proofPhotoCount = (proofPhotoOneSelected ? 1 : 0) + (proofPhotoTwoSelected ? 1 : 0) + (proofPhotoUrl.trim() ? 1 : 0);
  const canCompleteCustomer = !updatesDisabled && !isSubmittingThisStop && !isPodRetrying && collectionMode === "customer" && proofPhotoCount >= 1 && signatureImage.length > 0;
  const canCompleteSafePlace = !updatesDisabled && !isSubmittingThisStop && !isPodRetrying && collectionMode === "safe" && proofPhotoCount >= 2 && safePlaceNote.trim().length > 0;`,
);

replaceOnce(
  "collection POD retry submit handler",
  `  if (!routeStarted) return <p style={{ margin: "12px 0 0", color: "#667085", fontWeight: 800 }}>Start the route before completing collections.</p>;`,
  `  async function handleCollectionPodSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (collectionMode === "customer" ? !canCompleteCustomer : !canCompleteSafePlace) {
      return;
    }

    await submitPodFormWithRetry(event.currentTarget, setPodSubmitStatus, setPodSubmitError);
  }

  if (!routeStarted) return <p style={{ margin: "12px 0 0", color: "#667085", fontWeight: 800 }}>Start the route before completing collections.</p>;`,
);

replaceOnce(
  "collection POD retry form",
  `<Form method="post" encType="multipart/form-data" style={{ display: "grid", gap: 12, border: "1px solid #e5e7eb", borderRadius: 18, padding: 12, background: "#f8fafc", maxWidth: "100%", overflow: "hidden", boxSizing: "border-box" }}>`,
  `<Form method="post" encType="multipart/form-data" onSubmit={handleCollectionPodSubmit} style={{ display: "grid", gap: 12, border: "1px solid #e5e7eb", borderRadius: 18, padding: 12, background: "#f8fafc", maxWidth: "100%", overflow: "hidden", boxSizing: "border-box" }}>`,
);

replaceOnce(
  "collection POD retry message",
  `<button type="submit" disabled={collectionMode === "customer" ? !canCompleteCustomer : !canCompleteSafePlace} style={{ width: "100%", ...buttonStyle((collectionMode === "customer" ? canCompleteCustomer : canCompleteSafePlace) ? "#16a34a" : "#d0d5dd", (collectionMode === "customer" ? canCompleteCustomer : canCompleteSafePlace) ? "#ffffff" : "#667085") }}>{isSubmittingThisStop ? "Saving collection..." : "Complete collection"}</button>`,
  `<button type="submit" disabled={collectionMode === "customer" ? !canCompleteCustomer : !canCompleteSafePlace} style={{ width: "100%", ...buttonStyle((collectionMode === "customer" ? canCompleteCustomer : canCompleteSafePlace) ? "#16a34a" : "#d0d5dd", (collectionMode === "customer" ? canCompleteCustomer : canCompleteSafePlace) ? "#ffffff" : "#667085") }}>{isSubmittingThisStop || podSubmitStatus ? "Saving collection..." : "Complete collection"}</button>{podSubmitStatus ? <p style={{ margin: 0, color: "#175cd3", fontWeight: 900, fontSize: 13 }}>{podSubmitStatus}</p> : null}{podSubmitError ? <p style={{ margin: 0, color: "#b42318", fontWeight: 900, fontSize: 13 }}>{podSubmitError}</p> : null}`,
);

writeFileSync(routePath, source);
console.log("Driver POD retry hotfix applied.");
