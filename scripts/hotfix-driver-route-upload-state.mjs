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
  "driver stop submitting state",
  `  const podLat = useState("")[0];`,
  `  const podLat = useState("")[0];`,
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
