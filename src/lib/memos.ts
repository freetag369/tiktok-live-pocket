/**
 * リスナーメモ(メモ本文 + よみがな)。
 *
 * 来店履歴(VisitRecord)とは別のストアに持つ。理由:
 *  - 「来店履歴をリセット」(全員を初見に戻す)でメモが消えないようにする
 *  - VisitCounter の初見ラッチ・merge の規則にメモを絡ませない
 * 形は GiftCatalog と同じ(Map + dirty + drainDirty + all + import)。
 */

export interface MemoRecord {
  userId: string;
  /** メモ本文。空にはしない(両方空なら削除する)。 */
  note: string;
  /** よみがな(名前を呼ぶとき用)。無ければ ''。 */
  kana: string;
  updatedMs: number;
  /** 一覧表示用の名前スナップショット(来店履歴が無い人でも名前を出せる)。 */
  nickname?: string;
  uniqueId?: string;
}

export interface MemoPatch {
  note: string;
  kana: string;
  nickname?: string;
  uniqueId?: string;
}

export const MEMO_MAX_LEN = 500;
export const KANA_MAX_LEN = 50;

const EMPTY: ReadonlyMap<string, MemoRecord> = new Map();

export class MemoBook {
  private map = new Map<string, MemoRecord>();
  private dirty = new Set<string>();
  private removed = new Set<string>();
  private cachedView: ReadonlyMap<string, MemoRecord> | null = null;

  constructor(initial: Iterable<MemoRecord> = []) {
    for (const raw of initial) {
      const r = sanitizeMemo(raw);
      if (r) this.map.set(r.userId, r);
    }
  }

  get(userId: string): MemoRecord | undefined {
    return this.map.get(userId);
  }

  get size(): number {
    return this.map.size;
  }

  /**
   * メモを書く。note・kana は trim して長さを丸める。両方空なら削除。
   * 変化があったときだけ dirty になり、view() の参照が変わる。
   */
  set(userId: string, patch: MemoPatch, now: number): MemoRecord | null {
    if (!userId) return null;
    const note = clip(patch.note, MEMO_MAX_LEN);
    const kana = clip(patch.kana, KANA_MAX_LEN);
    const cur = this.map.get(userId);
    if (!note && !kana) {
      if (cur) {
        this.map.delete(userId);
        this.dirty.delete(userId);
        this.removed.add(userId);
        this.cachedView = null;
      }
      return null;
    }
    const next: MemoRecord = { userId, note, kana, updatedMs: now };
    const nickname = patch.nickname ?? cur?.nickname;
    const uniqueId = patch.uniqueId ?? cur?.uniqueId;
    if (nickname) next.nickname = nickname;
    if (uniqueId) next.uniqueId = uniqueId;
    if (cur && cur.note === note && cur.kana === kana && cur.nickname === next.nickname && cur.uniqueId === next.uniqueId) return cur;
    this.map.set(userId, next);
    this.dirty.add(userId);
    this.removed.delete(userId);
    this.cachedView = null;
    return next;
  }

  /** UI 用の読み取りビュー。中身が変わったときだけ新しい Map になる。 */
  view(): ReadonlyMap<string, MemoRecord> {
    if (this.map.size === 0) return EMPTY;
    if (!this.cachedView) this.cachedView = new Map(this.map);
    return this.cachedView;
  }

  /** 保存待ち(put)と削除待ち(del)を取り出す。呼ぶとクリアされる。 */
  drainDirty(): { put: MemoRecord[]; del: string[] } {
    const put: MemoRecord[] = [];
    for (const id of this.dirty) {
      const r = this.map.get(id);
      if (r) put.push({ ...r });
    }
    const del = [...this.removed];
    this.dirty.clear();
    this.removed.clear();
    return { put, del };
  }

  all(): MemoRecord[] {
    return [...this.map.values()].map((r) => ({ ...r }));
  }

  /**
   * バックアップの取り込み。
   *  - merge:   userId ごとに updatedMs の新しい方を採用
   *  - replace: いまのメモを捨てて置き換える
   * 取り込んだ(変化した)件数を返す。
   */
  import(records: unknown[], mode: 'merge' | 'replace'): number {
    if (mode === 'replace') {
      for (const id of this.map.keys()) this.removed.add(id);
      this.map.clear();
      this.dirty.clear();
      this.cachedView = null;
    }
    let n = 0;
    for (const raw of records) {
      const r = sanitizeMemo(raw);
      if (!r) continue;
      const cur = this.map.get(r.userId);
      if (cur && cur.updatedMs >= r.updatedMs) continue;
      this.map.set(r.userId, r);
      this.dirty.add(r.userId);
      this.removed.delete(r.userId);
      this.cachedView = null;
      n++;
    }
    return n;
  }

  clear(): void {
    for (const id of this.map.keys()) this.removed.add(id);
    this.map.clear();
    this.dirty.clear();
    this.cachedView = null;
  }
}

function clip(s: unknown, max: number): string {
  return typeof s === 'string' ? s.trim().slice(0, max) : '';
}

/** 外から来た行を検証して MemoRecord にする。壊れていれば null。 */
export function sanitizeMemo(raw: unknown): MemoRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const userId = typeof r.userId === 'string' ? r.userId : typeof r.userId === 'number' ? String(r.userId) : '';
  if (!userId) return null;
  const note = clip(r.note, MEMO_MAX_LEN);
  const kana = clip(r.kana, KANA_MAX_LEN);
  if (!note && !kana) return null;
  const out: MemoRecord = { userId, note, kana, updatedMs: Number(r.updatedMs) || 0 };
  if (typeof r.nickname === 'string' && r.nickname) out.nickname = r.nickname;
  if (typeof r.uniqueId === 'string' && r.uniqueId) out.uniqueId = r.uniqueId;
  return out;
}
