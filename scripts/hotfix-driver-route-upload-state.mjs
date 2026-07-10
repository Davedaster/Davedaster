import { readFileSync, writeFileSync } from "node:fs";

const routePath = "app/routes/driver.routes.$token.tsx";
let source = readFileSync(routePath, "utf8");

function replaceOnce(label, from, to) {
  if (source.includes(to)) {
    return;
  }

  if (!source.includes(from)) {
    throw new Error(`Could not apply driver route hotfix: ${label}`);
  }

  source = source.replace(from, to);
}

replaceOnce(
  "add useNavigation import",
  'import { Form, useActionData, useLoaderData, useRevalidator, useSubmit } from "@remix-run/react";',
  'import { Form, useActionData, useLoaderData, useNavigation, useRevalidator, useSubmit } from "@remix-run/react";',
);

replaceOnce(
  "safer proof file detection",
  `async function proofPhotoUrlsFromForm(formData: FormData, stopId: string) {
  const proofPhotoFiles = formData.getAll("proofPhotoFiles").filter((file): file is File => file instanceof File && file.size > 0);
  const fallbackProofPhotoUrl = String(formData.get("proofPhotoUrl") || "").trim();
  const proofPhotoUrls = fallbackProofPhotoUrl ? [fallbackProofPhotoUrl] : [];

  for (const proofPhotoFile of proofPhotoFiles) {
    proofPhotoUrls.push(await uploadProofPhoto(proofPhotoFile, stopId));
  }

  return proofPhotoUrls;
}`,
  `function isUploadedProofFile(file: FormDataEntryValue): file is File {
  return (
    typeof file === "object" &&
    file !== null &&
    "size" in file &&
    "arrayBuffer" in file &&
    typeof file.arrayBuffer === "function" &&
    Number(file.size) > 0
  );
}

async function proofPhotoUrlsFromForm(formData: FormData, stopId: string) {
  const proofPhotoFiles = formData.getAll("proofPhotoFiles").filter(isUploadedProofFile);
  const fallbackProofPhotoUrl = String(formData.get("proofPhotoUrl") || "").trim();
  const proofPhotoUrls = fallbackProofPhotoUrl ? [fallbackProofPhotoUrl] : [];

  for (const proofPhotoFile of proofPhotoFiles) {
    proofPhotoUrls.push(await uploadProofPhoto(proofPhotoFile, stopId, { index: proofPhotoUrls.length + 1 }));
  }

  return proofPhotoUrls;
}`,
);

replaceOnce(
  "client proof photo compression",
  `function ProofPhotoInput({ label, disabled, onChange }: { label: string; disabled: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void }) {
  return <label style={{ display: "grid", gap: 8, fontWeight: 900, maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>{label}<input type="file" name="proofPhotoFiles" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" disabled={disabled} onChange={onChange} style={{ width: "100%", maxWidth: "100%", minWidth: 0, fontSize: 14, padding: 10, border: "1px solid #d0d5dd", borderRadius: 14, background: "#ffffff", boxSizing: "border-box" }} /></label>;
}`,
  `const DRIVER_PROOF_IMAGE_MAX_SIZE = 1600;
const DRIVER_PROOF_IMAGE_QUALITY = 0.72;
const DRIVER_PROOF_IMAGE_MIN_COMPRESS_BYTES = 700 * 1024;

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Proof photo could not be prepared."));
    };
    image.src = url;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", DRIVER_PROOF_IMAGE_QUALITY);
  });
}

async function compressDriverProofPhoto(file: File) {
  if (!file.type.startsWith("image/") || file.size < DRIVER_PROOF_IMAGE_MIN_COMPRESS_BYTES) {
    return file;
  }

  try {
    const image = await loadImageFromFile(file);
    const largestSide = Math.max(image.width, image.height);
    const scale = largestSide > DRIVER_PROOF_IMAGE_MAX_SIZE ? DRIVER_PROOF_IMAGE_MAX_SIZE / largestSide : 1;
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      return file;
    }

    canvas.width = width;
    canvas.height = height;
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToJpegBlob(canvas);

    if (!blob || blob.size >= file.size) {
      return file;
    }

    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

async function prepareProofInputFile(input: HTMLInputElement) {
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  const preparedFile = await compressDriverProofPhoto(file);

  if (preparedFile === file || !("DataTransfer" in window)) {
    return;
  }

  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(preparedFile);
  input.files = dataTransfer.files;
}

function ProofPhotoInput({ label, disabled, onChange }: { label: string; disabled: boolean; onChange: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const [isPreparingPhoto, setIsPreparingPhoto] = useState(false);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;

    onChange(event);

    if (!input.files?.[0]) {
      return;
    }

    setIsPreparingPhoto(true);
    void prepareProofInputFile(input).finally(() => setIsPreparingPhoto(false));
  }

  return <label style={{ display: "grid", gap: 8, fontWeight: 900, maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>{label}{isPreparingPhoto ? <span style={{ color: "#667085", fontSize: 12, fontWeight: 800 }}>Preparing photo...</span> : null}<input type="file" name="proofPhotoFiles" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" disabled={disabled} onChange={handleChange} style={{ width: "100%", maxWidth: "100%", minWidth: 0, fontSize: 14, padding: 10, border: "1px solid #d0d5dd", borderRadius: 14, background: "#ffffff", boxSizing: "border-box" }} /></label>;
}`,
);

replaceOnce(
  "driver stop submitting state",
  `  const [podLng, setPodLng] = useState("");
  const updatesDisabled = isDisabled || !routeStarted;
  const proofPhotoCount = (proofPhotoOneSelected ? 1 : 0) + (proofPhotoTwoSelected ? 1 : 0) + (proofPhotoUrl.trim() ? 1 : 0);
  const canCompleteCustomer = !updatesDisabled && deliveryMode === "customer" && proofPhotoCount >= 1 && podImage.length > 0;
  const canCompleteSafePlace = !updatesDisabled && deliveryMode === "safe" && proofPhotoCount >= 2 && safePlaceNote.trim().length > 0;`,
  `  const [podLng, setPodLng] = useState("");
  const navigation = useNavigation();
  const isSubmittingThisStop = navigation.state !== "idle" && String(navigation.formData?.get("stopId") || "") === stopId;
  const updatesDisabled = isDisabled || !routeStarted;
  const proofPhotoCount = (proofPhotoOneSelected ? 1 : 0) + (proofPhotoTwoSelected ? 1 : 0) + (proofPhotoUrl.trim() ? 1 : 0);
  const canCompleteCustomer = !updatesDisabled && !isSubmittingThisStop && deliveryMode === "customer" && proofPhotoCount >= 1 && podImage.length > 0;
  const canCompleteSafePlace = !updatesDisabled && !isSubmittingThisStop && deliveryMode === "safe" && proofPhotoCount >= 2 && safePlaceNote.trim().length > 0;`,
);

replaceOnce(
  "driver complete saving text",
  `>Complete delivery</button>`,
  `>{isSubmittingThisStop ? "Saving delivery..." : "Complete delivery"}</button>`,
);

replaceOnce(
  "collection stop submitting state",
  `  const [failedNote, setFailedNote] = useState("");
  const updatesDisabled = isDisabled || !routeStarted;
  const proofPhotoCount = (proofPhotoOneSelected ? 1 : 0) + (proofPhotoTwoSelected ? 1 : 0) + (proofPhotoUrl.trim() ? 1 : 0);
  const canCompleteCustomer = !updatesDisabled && collectionMode === "customer" && proofPhotoCount >= 1 && signatureImage.length > 0;
  const canCompleteSafePlace = !updatesDisabled && collectionMode === "safe" && proofPhotoCount >= 2 && safePlaceNote.trim().length > 0;`,
  `  const [failedNote, setFailedNote] = useState("");
  const navigation = useNavigation();
  const isSubmittingThisStop = navigation.state !== "idle" && String(navigation.formData?.get("stopId") || "") === stopId;
  const updatesDisabled = isDisabled || !routeStarted;
  const proofPhotoCount = (proofPhotoOneSelected ? 1 : 0) + (proofPhotoTwoSelected ? 1 : 0) + (proofPhotoUrl.trim() ? 1 : 0);
  const canCompleteCustomer = !updatesDisabled && !isSubmittingThisStop && collectionMode === "customer" && proofPhotoCount >= 1 && signatureImage.length > 0;
  const canCompleteSafePlace = !updatesDisabled && !isSubmittingThisStop && collectionMode === "safe" && proofPhotoCount >= 2 && safePlaceNote.trim().length > 0;`,
);

replaceOnce(
  "collection complete saving text",
  `>Complete collection</button>`,
  `>{isSubmittingThisStop ? "Saving collection..." : "Complete collection"}</button>`,
);

replaceOnce(
  "route submitting state",
  `  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();`,
  `  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isRouteSubmitting = navigation.state !== "idle";`,
);

replaceOnce(
  "pause refresh during submit",
  `  useEffect(() => {
    if (!routeStarted) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        revalidator.revalidate();
      }
    }, DRIVER_ROUTE_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [routeStarted, revalidator]);`,
  `  useEffect(() => {
    if (!routeStarted || isRouteSubmitting) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        revalidator.revalidate();
      }
    }, DRIVER_ROUTE_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [routeStarted, isRouteSubmitting, revalidator]);`,
);

writeFileSync(routePath, source);
console.log("Driver route upload state hotfix applied.");
