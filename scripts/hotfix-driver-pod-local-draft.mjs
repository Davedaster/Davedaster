import { readFileSync, writeFileSync } from "node:fs";

const routePath = "app/routes/driver.routes.$token.tsx";
let source = readFileSync(routePath, "utf8");

function replaceOnce(label, from, to) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`Could not apply driver POD local draft hotfix: ${label}`);
  source = source.replace(from, to);
}

replaceOnce(
  "import local draft helpers",
  `import { isProofPhotoStorageEnabled, uploadProofPhoto } from "../lib/proofPhotoStorage.server";`,
  `import {
  clearDriverPodDraft,
  fileFromDriverPodDraft,
  isDriverPodDraftUploadFile,
  readDriverPodDraft,
  writeDriverPodDraft,
} from "../lib/driverProofDrafts.client";
import { isProofPhotoStorageEnabled, uploadProofPhoto } from "../lib/proofPhotoStorage.server";`,
);

replaceOnce(
  "add driver draft state",
  `  const [podUploadStatus, setPodUploadStatus] = useState<"idle" | "retrying" | "failed">("idle");
  const [podUploadMessage, setPodUploadMessage] = useState("");
  const isAutoRetryingThisStop = podUploadStatus === "retrying";`,
  `  const [podUploadStatus, setPodUploadStatus] = useState<"idle" | "retrying" | "failed">("idle");
  const [podUploadMessage, setPodUploadMessage] = useState("");
  const [proofPhotoOneDraftFile, setProofPhotoOneDraftFile] = useState<File | null>(null);
  const [proofPhotoTwoDraftFile, setProofPhotoTwoDraftFile] = useState<File | null>(null);
  const [proofDraftRestored, setProofDraftRestored] = useState(false);
  const driverPodDraftKey = typeof window === "undefined" ? "" : "driver-pod:" + window.location.pathname + ":" + stopId;
  const isAutoRetryingThisStop = podUploadStatus === "retrying";`,
);

replaceOnce(
  "save first draft photo",
  `      setProofPhotoOneSelected(Boolean(file));
      setProofPreviewOne(nextPreview);`,
  `      setProofPhotoOneSelected(Boolean(file));
      setProofPhotoOneDraftFile(file || null);
      setProofPreviewOne(nextPreview);`,
);

replaceOnce(
  "save second draft photo",
  `    setProofPhotoTwoSelected(Boolean(file));
    setProofPreviewTwo(nextPreview);`,
  `    setProofPhotoTwoSelected(Boolean(file));
    setProofPhotoTwoDraftFile(file || null);
    setProofPreviewTwo(nextPreview);`,
);

replaceOnce(
  "load and save local draft",
  `  useEffect(() => {
    if (!routeStarted || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition((position) => {
      setPodLat(String(position.coords.latitude));
      setPodLng(String(position.coords.longitude));
    }, () => undefined, { enableHighAccuracy: true, timeout: 5000 });
  }, [routeStarted]);

  function waitForPodRetry(attempt: number) {`,
  `  useEffect(() => {
    if (!routeStarted || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition((position) => {
      setPodLat(String(position.coords.latitude));
      setPodLng(String(position.coords.longitude));
    }, () => undefined, { enableHighAccuracy: true, timeout: 5000 });
  }, [routeStarted]);

  useEffect(() => {
    let cancelled = false;

    async function restoreDraft() {
      const draft = await readDriverPodDraft(driverPodDraftKey);

      if (cancelled || !draft || draft.stopId !== stopId) {
        return;
      }

      const firstPhoto = fileFromDriverPodDraft(draft.proofPhotoOne, "proof-photo-1.jpg");
      const secondPhoto = fileFromDriverPodDraft(draft.proofPhotoTwo, "proof-photo-2.jpg");
      const hasRestoredProof = Boolean(firstPhoto || secondPhoto || draft.podImage || draft.deliveryNote || draft.safePlaceNote || draft.proofPhotoUrl);

      setDeliveryMode(draft.deliveryMode || null);
      setDeliveryNote(draft.deliveryNote || "");
      setSafePlaceNote(draft.safePlaceNote || customerSafePlaceNote || "");
      setProofPhotoUrl(draft.proofPhotoUrl || "");
      setPodImage(draft.podImage || "");

      if (firstPhoto) {
        setProofPhotoOneDraftFile(firstPhoto);
        setProofPhotoOneSelected(true);
        setProofPreviewOne(URL.createObjectURL(firstPhoto));
      }

      if (secondPhoto) {
        setProofPhotoTwoDraftFile(secondPhoto);
        setProofPhotoTwoSelected(true);
        setProofPreviewTwo(URL.createObjectURL(secondPhoto));
      }

      setProofDraftRestored(hasRestoredProof);
    }

    void restoreDraft();

    return () => {
      cancelled = true;
    };
  }, [customerSafePlaceNote, driverPodDraftKey, stopId]);

  useEffect(() => {
    if (!driverPodDraftKey || (deliveryMode !== "customer" && deliveryMode !== "safe")) return;

    const timeout = window.setTimeout(() => {
      void writeDriverPodDraft(driverPodDraftKey, {
        stopId,
        deliveryMode,
        deliveryNote,
        safePlaceNote,
        proofPhotoUrl,
        podImage,
        proofPhotoOne: proofPhotoOneDraftFile,
        proofPhotoTwo: proofPhotoTwoDraftFile,
        updatedAt: Date.now(),
      });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [deliveryMode, deliveryNote, driverPodDraftKey, podImage, proofPhotoOneDraftFile, proofPhotoTwoDraftFile, proofPhotoUrl, safePlaceNote, stopId]);

  function waitForPodRetry(attempt: number) {`,
);

replaceOnce(
  "append restored photos to retry form",
  `        const response = await fetch(form.action || window.location.href, {
          method: "POST",
          body: new FormData(form),`,
  `        const formData = new FormData(form);
        const selectedProofFiles = formData.getAll("proofPhotoFiles").filter(isDriverPodDraftUploadFile);
        const restoredProofFiles = [proofPhotoOneDraftFile, deliveryMode === "safe" ? proofPhotoTwoDraftFile : null].filter((file): file is File => Boolean(file));

        for (const restoredFile of restoredProofFiles.slice(selectedProofFiles.length)) {
          formData.append("proofPhotoFiles", restoredFile, restoredFile.name);
        }

        const response = await fetch(form.action || window.location.href, {
          method: "POST",
          body: formData,`,
);

replaceOnce(
  "clear draft after redirected save",
  `        if (response.redirected) {
          window.location.assign(response.url);
          return;
        }`,
  `        if (response.redirected) {
          await clearDriverPodDraft(driverPodDraftKey);
          window.location.assign(response.url);
          return;
        }`,
);

replaceOnce(
  "clear draft after ok save",
  `        if (response.ok) {
          window.location.assign(window.location.pathname + "#next-stop");
          return;
        }`,
  `        if (response.ok) {
          await clearDriverPodDraft(driverPodDraftKey);
          window.location.assign(window.location.pathname + "#next-stop");
          return;
        }`,
);

replaceOnce(
  "show restored draft message",
  `{podUploadMessage ? <p style={{ margin: 0, color: podUploadStatus === "failed" ? "#b42318" : "#667085", fontWeight: 800, fontSize: 13 }}>{podUploadMessage}</p> : null}
          <button type="submit" disabled={deliveryMode === "customer" ? !canCompleteCustomer : !canCompleteSafePlace}`,
  `{proofDraftRestored ? <p style={{ margin: 0, color: "#667085", fontWeight: 800, fontSize: 13 }}>Proof restored from this phone.</p> : null}
          {podUploadMessage ? <p style={{ margin: 0, color: podUploadStatus === "failed" ? "#b42318" : "#667085", fontWeight: 800, fontSize: 13 }}>{podUploadMessage}</p> : null}
          <button type="submit" disabled={deliveryMode === "customer" ? !canCompleteCustomer : !canCompleteSafePlace}`,
);

writeFileSync(routePath, source);
console.log("Driver POD local draft hotfix applied using shared client helpers.");
