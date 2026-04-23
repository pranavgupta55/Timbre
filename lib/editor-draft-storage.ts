export type PersistedTrackSegment = {
  id: string;
  start: number;
  end: number;
  fadeInInput: string;
  fadeOutInput: string;
};

export type PersistedEditorTrack = {
  id: string;
  file: File;
  sourceHash: string;
  displayName: string;
  relativePath: string;
  addedAt: string;
  activeSegmentId: string | null;
  segments: PersistedTrackSegment[];
  approvedAt?: string | null;
  segmentCount?: number | null;
  uploadState?: "pending" | "syncing" | "synced" | "error";
};

export type EditorDraftSnapshot = {
  queuedTracks: PersistedEditorTrack[];
  approvedTracks: PersistedEditorTrack[];
  selectedQueuedId: string | null;
  savedAt: string;
};

const DB_NAME = "timbre-editor-drafts";
const DB_VERSION = 1;
const STORE_NAME = "drafts";
const SNAPSHOT_KEY = "active-upload";

const openDraftDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("This browser does not support offline draft storage."));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open the editor draft database."));
  });

const runDraftTransaction = async <T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => IDBRequest<T>,
) => {
  const database = await openDraftDatabase();

  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = handler(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The draft transaction failed."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error ?? new Error("The draft transaction failed."));
  });
};

export const saveEditorDraftSnapshot = async (snapshot: EditorDraftSnapshot) => {
  await runDraftTransaction("readwrite", (store) => store.put({ key: SNAPSHOT_KEY, snapshot }));
};

export const loadEditorDraftSnapshot = async () => {
  const result = await runDraftTransaction<{ key: string; snapshot?: EditorDraftSnapshot } | undefined>("readonly", (store) =>
    store.get(SNAPSHOT_KEY),
  );

  return result?.snapshot ?? null;
};

export const clearEditorDraftSnapshot = async () => {
  await runDraftTransaction("readwrite", (store) => store.delete(SNAPSHOT_KEY));
};
