import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { VisitRecord } from './visits';
import type { MemoRecord } from './memos';
import type { FeedRow, ScreenItem, ScreenMeta } from './feed';
import { applyRowToStream, type ArchivedRow, type HostInfo, type StreamRecord } from './archive';

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
  /** アーカイブの行(全配信)。byRoomTs で配信ごとに時刻順に引ける。 */
  logRows: { key: string; value: ArchivedRow; indexes: { byRoomTs: [string, number] } };
  /** 配信ごとの集計(一覧用)。 */
  streams: { key: string; value: StreamRecord };
  /** 画面の履歴(🧹 でリセットするまで残る行と配信の区切り)。seq が並び順。 */
  screenRows: { key: string; value: ScreenItem };
  /** 画面の履歴の付帯情報(集計・重複表・連打)。'current' の 1 件だけ。 */
  screenMeta: { key: string; value: ScreenMetaRecord };
}

export type ScreenMetaRecord = ScreenMeta & { k: 'current' };

const DB_NAME = 'tiktok-live-pocket';
/** v2: memos(リスナーメモ)、v3: logRows / streams(アーカイブ)、v4: screenRows / screenMeta(画面の履歴)。 */
const DB_VERSION = 4;

let dbPromise: Promise<IDBPDatabase<PocketDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<PocketDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PocketDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('visits')) db.createObjectStore('visits', { keyPath: 'userId' });
        if (!db.objectStoreNames.contains('gifts')) db.createObjectStore('gifts', { keyPath: 'giftId' });
        if (!db.objectStoreNames.contains('memos')) db.createObjectStore('memos', { keyPath: 'userId' });
        if (!db.objectStoreNames.contains('logRows')) {
          const rows = db.createObjectStore('logRows', { keyPath: 'id' });
          rows.createIndex('byRoomTs', ['roomId', 'tsMs']);
        }
        if (!db.objectStoreNames.contains('streams')) db.createObjectStore('streams', { keyPath: 'roomId' });
        if (!db.objectStoreNames.contains('screenRows')) db.createObjectStore('screenRows', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('screenMeta')) db.createObjectStore('screenMeta', { keyPath: 'k' });
      },
      // 別のタブが古いバージョンを掴んだままだと次の版上げが止まるので、こちらを閉じる。
      blocking() {
        void dbPromise?.then((db) => db.close());
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
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

// ── アーカイブ ─────────────────────────────────────────────────────────

function roomRange(roomId: string): IDBKeyRange {
  return IDBKeyRange.bound([roomId, -Infinity], [roomId, Infinity]);
}

/**
 * 行を保存し、配信の集計を更新する。同じ id の行は上書き(連打の ×N 更新)で、
 * 集計は保存前の行との差分だけ足すので何度呼んでも二重計上しない。
 */
export async function saveArchiveRows(roomId: string, rows: FeedRow[], host: HostInfo): Promise<void> {
  if (rows.length === 0) return;
  try {
    const db = await getDb();
    const tx = db.transaction(['logRows', 'streams'], 'readwrite');
    const rowStore = tx.objectStore('logRows');
    const streamStore = tx.objectStore('streams');
    let stream = await streamStore.get(roomId);
    for (const row of rows) {
      const prev = await rowStore.get(row.id);
      const rec: ArchivedRow = { ...row, roomId };
      if (rec.k === 'gift') rec.streaking = false;
      void rowStore.put(rec);
      stream = applyRowToStream(stream, prev, row, host, roomId);
    }
    if (stream) void streamStore.put(stream);
    await tx.done;
  } catch {
    /* ignore */
  }
}

export async function listStreams(): Promise<StreamRecord[]> {
  try {
    const db = await getDb();
    const all = await db.getAll('streams');
    return all.sort((a, b) => b.startedMs - a.startedMs);
  } catch {
    return [];
  }
}

/** 配信の全行を時刻順で返す。 */
export async function loadStreamRows(roomId: string): Promise<FeedRow[]> {
  try {
    const db = await getDb();
    const rows = await db.getAllFromIndex('logRows', 'byRoomTs', roomRange(roomId));
    return rows.map(({ roomId: _r, ...row }) => row as FeedRow);
  } catch {
    return [];
  }
}

export async function deleteStream(roomId: string): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(['logRows', 'streams'], 'readwrite');
    const rowStore = tx.objectStore('logRows');
    const keys = await rowStore.index('byRoomTs').getAllKeys(roomRange(roomId));
    for (const k of keys) void rowStore.delete(k);
    void tx.objectStore('streams').delete(roomId);
    await tx.done;
  } catch {
    /* ignore */
  }
}

export async function clearArchive(): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(['logRows', 'streams'], 'readwrite');
    void tx.objectStore('logRows').clear();
    void tx.objectStore('streams').clear();
    await tx.done;
  } catch {
    /* ignore */
  }
}

/** バックアップ用に全件。 */
export async function loadAllArchive(): Promise<{ streams: StreamRecord[]; rows: ArchivedRow[] }> {
  try {
    const db = await getDb();
    const [streams, rows] = await Promise.all([db.getAll('streams'), db.getAllFromIndex('logRows', 'byRoomTs')]);
    return { streams: streams.sort((a, b) => b.startedMs - a.startedMs), rows };
  } catch {
    return { streams: [], rows: [] };
  }
}

// ── 画面の履歴(🧹 でリセットするまで残る分) ─────────────────────────

/** 画面に出ている行と区切りを、順番つきで全部返す。 */
export async function loadScreen(): Promise<{ items: ScreenItem[]; meta: ScreenMeta | null }> {
  try {
    const db = await getDb();
    const [items, meta] = await Promise.all([db.getAll('screenRows'), db.get('screenMeta', 'current')]);
    return { items, meta: meta ? metaOf(meta) : null };
  } catch {
    return { items: [], meta: null };
  }
}

/** 行と付帯情報を 1 トランザクションで書く。既にある行は seq(並び順)を引き継ぐ。 */
export async function saveScreen(items: ScreenItem[], meta: ScreenMeta | null): Promise<void> {
  if (items.length === 0 && !meta) return;
  try {
    const db = await getDb();
    const tx = db.transaction(['screenRows', 'screenMeta'], 'readwrite');
    const store = tx.objectStore('screenRows');
    for (const item of items) {
      const prev = await store.get(item.id);
      void store.put(prev ? { ...item, seq: prev.seq } : item);
    }
    if (meta) void tx.objectStore('screenMeta').put({ ...meta, k: 'current' });
    await tx.done;
  } catch {
    /* ignore */
  }
}

/** 🧹 いまの画面で置き換える(消してから書き直す)。 */
export async function replaceScreen(items: ScreenItem[], meta: ScreenMeta | null): Promise<void> {
  try {
    const db = await getDb();
    const tx = db.transaction(['screenRows', 'screenMeta'], 'readwrite');
    const store = tx.objectStore('screenRows');
    await store.clear();
    for (const item of items) void store.put(item);
    if (meta) void tx.objectStore('screenMeta').put({ ...meta, k: 'current' });
    await tx.done;
  } catch {
    /* ignore */
  }
}

/** 上限を超えて画面から落ちた行を捨てる(起動時の掃除)。 */
export async function deleteScreenRows(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const db = await getDb();
    const tx = db.transaction('screenRows', 'readwrite');
    for (const id of ids) void tx.store.delete(id);
    await tx.done;
  } catch {
    /* ignore */
  }
}

function metaOf(r: ScreenMetaRecord): ScreenMeta {
  const { k: _k, ...meta } = r;
  return meta;
}
