/**
 * IndexedDB-backed draft storage for driver proof of delivery.
 * Stores photos, notes, delivery mode, and other proof data locally
 * to survive page refreshes and network interruptions.
 */

const DRIVER_POD_DRAFT_DB = "bpd-driver-pod-drafts";
const DRIVER_POD_DRAFT_STORE = "drafts";
const DRIVER_POD_AUTO_RETRY_ATTEMPTS = 3;
const DRIVER_POD_AUTO_RETRY_DELAY_MS = 3500;
const DRIVER_POD_RETRY_STATUS_ATTRIBUTE = "data-bpd-pod-upload-status";

export type DriverPodDraft = {
  stopId: string;
  deliveryMode: "customer" | "safe" | null;
  deliveryNote: string;
  safePlaceNote: string;
  proofPhotoUrl: string;
  podImage: string;
  proofPhotoOne?: File | Blob | null;
  proofPhotoTwo?: File | Blob | null;
  updatedAt: number;
};

/**
 * Opens or initializes the IndexedDB database for driver POD drafts.
 * Creates the object store if it does not exist.
 */
function openDriverPodDraftDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("Local proof storage is unavailable."));
      return;
    }

    const request = window.indexedDB.open(DRIVER_POD_DRAFT_DB, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRIVER_POD_DRAFT_STORE)) {
        db.createObjectStore(DRIVER_POD_DRAFT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Local proof storage failed."));
  });
}

/**
 * Reads a draft from local storage by its key.
 * Returns null if the draft does not exist or if storage is unavailable.
 * Errors are swallowed gracefully since storage is best-effort.
 */
export async function readDriverPodDraft(key: string): Promise<DriverPodDraft | null> {
  if (!key) return null;

  try {
    const db = await openDriverPodDraftDb();
    return await new Promise<DriverPodDraft | null>((resolve) => {
      const tx = db.transaction(DRIVER_POD_DRAFT_STORE, "readonly");
      const request = tx.objectStore(DRIVER_POD_DRAFT_STORE).get(key);
      request.onsuccess = () => resolve((request.result as DriverPodDraft | undefined) || null);
      request.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    });
  } catch {
    return null;
  }
}

/**
 * Writes a draft to local storage by its key.
 * If storage is unavailable, the error is silently suppressed.
 * This ensures the POD workflow never blocks on local storage failure.
 */
export async function writeDriverPodDraft(key: string, draft: DriverPodDraft): Promise<void> {
  if (!key) return;

  try {
    const db = await openDriverPodDraftDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(DRIVER_POD_DRAFT_STORE, "readwrite");
      tx.objectStore(DRIVER_POD_DRAFT_STORE).put(draft, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Local draft storage is best-effort and must never block the POD.
  }
}

/**
 * Deletes a draft from local storage by its key.
 * Called after successful server confirmation to free local storage.
 * Errors are silently suppressed since this is cleanup.
 */
export async function clearDriverPodDraft(key: string): Promise<void> {
  if (!key) return;

  try {
    const db = await openDriverPodDraftDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(DRIVER_POD_DRAFT_STORE, "readwrite");
      tx.objectStore(DRIVER_POD_DRAFT_STORE).delete(key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Ignore local cleanup errors. Server confirmation is still the source of truth.
  }
}

/**
 * Converts a stored Blob or File back into a File with the given name.
 * If the value is already a File, returns it as-is.
 * Returns null if the value is falsy.
 */
export function fileFromDriverPodDraft(value: File | Blob | null | undefined, fallbackName: string): File | null {
  if (!value) return null;
  if (value instanceof File) return value;
  return new File([value], fallbackName, { type: value.type || "image/jpeg" });
}

/**
 * Type guard for FormDataEntryValue to safely identify File objects.
 * Used when filtering uploaded proof photos from FormData.
 */
export function isDriverPodDraftUploadFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && "size" in value && Number(value.size) > 0;
}

function waitForDriverPodRetry(attempt: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, DRIVER_POD_AUTO_RETRY_DELAY_MS * attempt);
  });
}

function shouldRetryDriverPodResponse(status: number, message: string) {
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return true;
  }

  return /failed to fetch|network error|network request failed|connection (?:lost|failed|reset)|timed? out|offline|signal weak/i.test(message);
}

function isDriverPodCompletionForm(form: HTMLFormElement) {
  if (!window.location.pathname.startsWith("/driver/routes/")) {
    return false;
  }

  const intent = form.elements.namedItem("intent");
  return intent instanceof HTMLInputElement && intent.value === "completeStop";
}

function driverPodDraftKeyFromFormData(formData: FormData) {
  const stopId = String(formData.get("stopId") || "").trim();
  return stopId ? `driver-pod:${window.location.pathname}:${stopId}` : "";
}

async function appendRestoredDriverPodFiles(formData: FormData, draftKey: string) {
  const draft = await readDriverPodDraft(draftKey);

  if (!draft) {
    return;
  }

  const selectedProofFiles = formData.getAll("proofPhotoFiles").filter(isDriverPodDraftUploadFile);
  const leftInSafePlace = String(formData.get("leftInSafePlace") || "") === "true";
  const restoredProofFiles = [
    fileFromDriverPodDraft(draft.proofPhotoOne, "proof-photo-1.jpg"),
    leftInSafePlace ? fileFromDriverPodDraft(draft.proofPhotoTwo, "proof-photo-2.jpg") : null,
  ].filter((file): file is File => Boolean(file));

  for (const restoredFile of restoredProofFiles.slice(selectedProofFiles.length)) {
    formData.append("proofPhotoFiles", restoredFile, restoredFile.name);
  }
}

function driverPodSubmitButton(form: HTMLFormElement) {
  return form.querySelector<HTMLButtonElement>('button[type="submit"]');
}

function setDriverPodSubmitting(form: HTMLFormElement, isSubmitting: boolean) {
  const button = driverPodSubmitButton(form);

  if (!button) {
    return;
  }

  if (!button.dataset.bpdOriginalLabel) {
    button.dataset.bpdOriginalLabel = button.textContent || "Complete delivery";
  }

  button.disabled = isSubmitting;
  button.textContent = isSubmitting ? "Saving delivery..." : button.dataset.bpdOriginalLabel;
}

function driverPodStatusElement(form: HTMLFormElement) {
  const existing = form.querySelector<HTMLElement>(`[${DRIVER_POD_RETRY_STATUS_ATTRIBUTE}]`);

  if (existing) {
    return existing;
  }

  const element = document.createElement("p");
  element.setAttribute(DRIVER_POD_RETRY_STATUS_ATTRIBUTE, "true");
  element.style.margin = "0";
  element.style.fontWeight = "800";
  element.style.fontSize = "13px";

  const button = driverPodSubmitButton(form);
  if (button) {
    form.insertBefore(element, button);
  } else {
    form.appendChild(element);
  }

  return element;
}

function setDriverPodStatus(form: HTMLFormElement, message: string, failed: boolean) {
  const element = driverPodStatusElement(form);
  element.textContent = message;
  element.style.color = failed ? "#b42318" : "#667085";
  element.hidden = !message;
}

async function driverPodErrorMessage(response: Response) {
  let message = "Delivery could not be saved yet.";

  try {
    const data = await response.clone().json() as { error?: string };
    if (data.error) {
      message = data.error;
    }
  } catch {
    // Keep the simple message if the response was not JSON.
  }

  return message;
}

async function submitDriverPodFormWithRetry(form: HTMLFormElement) {
  setDriverPodSubmitting(form, true);
  setDriverPodStatus(form, "", false);

  for (let attempt = 1; attempt <= DRIVER_POD_AUTO_RETRY_ATTEMPTS; attempt += 1) {
    let retryThisFailure = true;

    try {
      const formData = new FormData(form);
      const draftKey = driverPodDraftKeyFromFormData(formData);
      await appendRestoredDriverPodFiles(formData, draftKey);

      const response = await fetch(form.action || window.location.href, {
        method: "POST",
        body: formData,
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });

      if (response.redirected) {
        await clearDriverPodDraft(draftKey);
        window.location.assign(response.url);
        return;
      }

      if (response.ok) {
        await clearDriverPodDraft(draftKey);
        window.location.assign(`${window.location.pathname}#next-stop`);
        return;
      }

      const message = await driverPodErrorMessage(response);
      retryThisFailure = shouldRetryDriverPodResponse(response.status, message);
      throw new Error(message);
    } catch (error) {
      if (!retryThisFailure || attempt >= DRIVER_POD_AUTO_RETRY_ATTEMPTS) {
        setDriverPodSubmitting(form, false);
        setDriverPodStatus(
          form,
          error instanceof Error ? error.message : "Delivery could not be saved. Please try again when signal improves.",
          true,
        );
        return;
      }

      setDriverPodStatus(form, "Signal weak. Retrying quietly...", false);
      await waitForDriverPodRetry(attempt);
    }
  }
}

function installDriverPodAutoRetry() {
  if (typeof window === "undefined" || window.__bpdDriverPodAutoRetryInstalled) {
    return;
  }

  window.__bpdDriverPodAutoRetryInstalled = true;
  const activeForms = new WeakSet<HTMLFormElement>();

  document.addEventListener("submit", (event) => {
    const form = event.target;

    if (!(form instanceof HTMLFormElement) || !isDriverPodCompletionForm(form)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (activeForms.has(form)) {
      return;
    }

    activeForms.add(form);
    void submitDriverPodFormWithRetry(form).finally(() => activeForms.delete(form));
  }, true);
}

declare global {
  interface Window {
    __bpdDriverPodAutoRetryInstalled?: boolean;
  }
}

installDriverPodAutoRetry();
