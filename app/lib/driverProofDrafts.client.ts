/**
 * Driver Proof of Delivery Draft Storage
 * 
 * Manages local IndexedDB storage for proof of delivery form state.
 * Allows drivers to recover partial submissions if the browser is refreshed
 * or connection is lost during the completion workflow.
 * 
 * Drafts are automatically cleared only after confirmed server success.
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
 * Opens or initializes the IndexedDB database for driver proof drafts.
 * Creates the object store on first use.
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
 * Reads a draft from IndexedDB by key.
 * Returns null if the draft does not exist or an error occurs.
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
 * Writes a draft to IndexedDB.
 * Best-effort operation that silently fails if storage is unavailable.
 */
export async function writeDriverPodDraft(key: string, draft: DriverPodDraft): Promise<void> {
  if (!key) return;

  try {
    const db = await openDriverPodDraftDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(DRIVER_POD_DRAFT_STORE, "readwrite");
      tx.objectStore(DRIVER_POD_DRAFT_STORE).put(draft, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch {
    // Local draft storage is best-effort and must never block the POD.
  }
}

/**
 * Clears a draft from IndexedDB by key.
 * Called after confirmed server success to prevent stale recovery.
 */
export async function clearDriverPodDraft(key: string): Promise<void> {
  if (!key) return;

  try {
    const db = await openDriverPodDraftDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(DRIVER_POD_DRAFT_STORE, "readwrite");
      tx.objectStore(DRIVER_POD_DRAFT_STORE).delete(key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch {
    // Ignore local cleanup errors. Server confirmation is still the source of truth.
  }
}

/**
 * Converts a Blob or File from draft storage into a File object.
 * Falls back to creating a new File if the value is a Blob.
 */
export function fileFromDriverPodDraft(value: File | Blob | null | undefined, fallbackName: string): File | null {
  if (!value) return null;
  if (value instanceof File) return value;
  return new File([value], fallbackName, { type: value.type || "image/jpeg" });
}

/**
 * Type guard to check if a FormDataEntryValue is a valid uploaded File.
 */
export function isDriverPodDraftUploadFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && "size" in value && Number(value.size) > 0;
}
