import type { Wod } from './types';

const DB_NAME = 'wodburner';
const DB_VERSION = 1;

let opened: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (opened) return opened;
  opened = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => {
      opened = null;
      reject(req.error);
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('wods')) {
        db.createObjectStore('wods', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
  });
  return opened;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listWods(): Promise<Wod[]> {
  const db = await openDb();
  const rows = await request(db.transaction('wods').objectStore('wods').index('createdAt').getAll());
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getWod(id: string): Promise<Wod | undefined> {
  const db = await openDb();
  return request(db.transaction('wods').objectStore('wods').get(id));
}

export async function putWod(wod: Wod): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('wods', 'readwrite');
  tx.objectStore('wods').put(wod);
  await transactionDone(tx);
  await persistStorage();
}

export async function deleteWod(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('wods', 'readwrite');
  tx.objectStore('wods').delete(id);
  await transactionDone(tx);
}

// Writes only what changed since `before` was read, in one transaction. A workout saved in another tab
// in the meantime is left alone, which a clear-then-rewrite would have wiped.
export async function applyWods(before: Wod[], after: Wod[]): Promise<void> {
  const prior = new Map(before.map((wod) => [wod.id, JSON.stringify(wod)]));
  const db = await openDb();
  const tx = db.transaction('wods', 'readwrite');
  const store = tx.objectStore('wods');
  const keep = new Set<string>();
  for (const wod of after) {
    keep.add(wod.id);
    if (prior.get(wod.id) !== JSON.stringify(wod)) store.put(wod);
  }
  for (const id of prior.keys()) if (!keep.has(id)) store.delete(id);
  await transactionDone(tx);
  await persistStorage();
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['wods', 'meta'], 'readwrite');
  tx.objectStore('wods').clear();
  tx.objectStore('meta').clear();
  await transactionDone(tx);
}

export async function getMeta(key: string): Promise<unknown> {
  const db = await openDb();
  const row = await request(db.transaction('meta').objectStore('meta').get(key));
  return row?.value;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key, value });
  await transactionDone(tx);
}

async function persistStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // The browser can refuse. The workouts stay until the browser evicts storage.
  }
}
