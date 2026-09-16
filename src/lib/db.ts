import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { VisitRecord } from './visits';
import type { MemoRecord } from './memos';

export interface GiftCatalogRecord {
  giftId: string;
  name: string;
  diamonds: number;
  iconUrl: string;
  updatedMs: number;
}

interface PocketDB extends DBSchema {
  visits: { key: string; value: VisitRecord };
  gifts: { key: string; value: GiftCatalogRecord };
  memos: { key: string; value: MemoRecord };
}

const DB_NAME = 'tiktok-live-pocket';
/** v2: memos(リスナーメモ)ストアを追加。 */
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<PocketDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<PocketDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PocketDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('visits')) db.createObjectStore('visits', { keyPath: 'userId' });
        if (!db.objectStoreNames.contains('gifts')) db.createObjectStore('gifts', { keyPath: 'giftId' });
        if (!db.objectStoreNames.contains('memos')) db.createObjectStore('memos', { keyPath: 'userId' });
      },
    });
  }
  return dbPromise;
}

export async function loadVisits(): Promise<VisitRecord[]> {
  try {
    const db = await getDb();
    return await db.getAll('visits');
  } catch {
    return [];
  }
}

export async function saveVisits(records: VisitRecord[]): Promise<void> {
  if (records.length === 0) return;
  try {
    const db = await getDb();
    const tx = db.transaction('visits', 'readwrite');
    for (const r of records) void tx.store.put(r);
    await tx.done;
  } catch {
    /* プライベートブラウズ等で IndexedDB が使えない — その場合はメモリだけで動く */
  }
}

export async function clearVisits(): Promise<void> {
  try {
    const db = await getDb();
    await db.clear('visits');
  } catch {
    /* ignore */
  }
}

export async function replaceVisits(records: VisitRecord[]): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction('visits', 'readwrite');
    await tx.store.clear();
    for (const r of records) void tx.store.put(r);
    await tx.done;
  } catch {
    /* ignore */
  }
}

export async function loadGiftCatalog(): Promise<GiftCatalogRecord[]> {
  try {
    const db = await getDb();
    return await db.getAll('gifts');
  } catch {
    return [];
  }
}

export async function saveGiftCatalog(records: GiftCatalogRecord[]): Promise<void> {
  if (records.length === 0) return;
  try {
    const db = await getDb();
    const tx = db.transaction('gifts', 'readwrite');
    for (const r of records) void tx.store.put(r);
    await tx.done;
  } catch {
    /* ignore */
  }
}

// ── リスナーメモ ─────────────────────────────────────────────────────

export async function loadMemos(): Promise<MemoRecord[]> {
  try {
    const db = await getDb();
    return await db.getAll('memos');
  } catch {
    return [];
  }
}

/** 追加・更新(put)と削除(del)を 1 トランザクションで反映する。 */
export async function saveMemos(put: MemoRecord[], del: string[]): Promise<void> {
  if (put.length === 0 && del.length === 0) return;
  try {
    const db = await getDb();
    const tx = db.transaction('memos', 'readwrite');
    for (const id of del) void tx.store.delete(id);
    for (const r of put) void tx.store.put(r);
    await tx.done;
  } catch {
    /* ignore */
  }
}

export async function replaceMemos(records: MemoRecord[]): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction('memos', 'readwrite');
    await tx.store.clear();
    for (const r of records) void tx.store.put(r);
    await tx.done;
  } catch {
    /* ignore */
  }
}
