/**
 * IndexedDB-backed draft storage for driver proof of delivery.
 * Stores photos, notes, delivery mode, and other proof data locally
 * to survive page refreshes and network interruptions.
 */

const DRIVER_POD_DRAFT_DB = "bpd-driver-pod-drafts";
const DRIVER_POD_DRAFT_STORE = "drafts";

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
