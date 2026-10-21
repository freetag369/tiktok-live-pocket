/**
 * リスナーメモ(メモ本文 + 前回 + よみがな + お気に入り)。
 *
 * 来店履歴(VisitRecord)とは別のストアに持つ。理由:
 *  - 「来店履歴をリセット」(全員を初見に戻す)でメモが消えないようにする
 *  - VisitCounter の初見ラッチ・merge の規則にメモを絡ませない
 * 形は GiftCatalog と同じ(Map + dirty + drainDirty + all + import)。
 */

export interface MemoRecord {
  userId: string;
  /** メモ本文。3 項目すべて空でお気に入りでもなければ削除する。 */
  note: string;
  /** 前回のお礼ややり取り。旧データの省略は空欄として扱う。 */
  previousNote?: string;
  /** よみがな(名前を呼ぶとき用)。無ければ ''。 */
  kana: string;
  /** お気に入り。行の背景を青にする。付いているときだけ true を持つ。 */
  favorite?: true;
  updatedMs: number;
  /** 一覧表示用の名前スナップショット(来店履歴が無い人でも名前を出せる)。 */
  nickname?: string;
  uniqueId?: string;
}

/** 省略した欄は現在の内容を保持。文字の欄は空文字を渡すと消去。 */
export interface MemoPatch {
  note?: string;
  previousNote?: string;
  kana?: string;
  favorite?: boolean;
  nickname?: string;
  uniqueId?: string;
}

/** メモ・前回・よみがなのどれかが書いてあるか。入室の表示先(上のフィード / 下の固定枠)を分けるのに使う。 */
export function hasMemoContent(m: MemoRecord | undefined): boolean {
  return !!m && !!(m.note || m.previousNote || m.kana);
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
   * メモを書く。各欄は trim して長さを丸める。3 項目すべて空でお気に入りでもなければ削除。
   * 変化があったときだけ dirty になり、view() の参照が変わる。
   */
  set(userId: string, patch: MemoPatch, now: number): MemoRecord | null {
    if (!userId) return null;
    const cur = this.map.get(userId);
    const note = clip(patch.note ?? cur?.note, MEMO_MAX_LEN);
    const kana = clip(patch.kana ?? cur?.kana, KANA_MAX_LEN);
    const previousNote = clip(patch.previousNote ?? cur?.previousNote, MEMO_MAX_LEN);
    const favorite = patch.favorite ?? cur?.favorite ?? false;
    if (!note && !kana && !previousNote && !favorite) {
      if (cur) {
        this.map.delete(userId);
        this.dirty.delete(userId);
        this.removed.add(userId);
        this.cachedView = null;
      }
      return null;
    }
    const next: MemoRecord = { userId, note, kana, updatedMs: now };
    if (previousNote) next.previousNote = previousNote;
    if (favorite) next.favorite = true;
    const nickname = patch.nickname ?? cur?.nickname;
    const uniqueId = patch.uniqueId ?? cur?.uniqueId;
    if (nickname) next.nickname = nickname;
    if (uniqueId) next.uniqueId = uniqueId;
    if (cur && cur.note === note && cur.kana === kana && (cur.previousNote ?? '') === previousNote && cur.favorite === next.favorite && cur.nickname === next.nickname && cur.uniqueId === next.uniqueId) return cur;
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
   * 読込が終わる前に仮の帳(early)へ書いたメモを、読み込んだ帳に移す(保存はこの後の保存で)。
   * 仮の帳は空から始まるので、そこでの削除は「仮の帳で書いて消した」だけ。保存済みのメモは消さない。
   */
  adopt(early: MemoBook): void {
    const { put } = early.drainDirty();
    for (const r of put) this.set(r.userId, r, r.updatedMs);
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
  const previousNote = clip(r.previousNote, MEMO_MAX_LEN);
  const favorite = r.favorite === true;
  if (!note && !kana && !previousNote && !favorite) return null;
  const out: MemoRecord = { userId, note, kana, updatedMs: Number(r.updatedMs) || 0 };
  if (previousNote) out.previousNote = previousNote;
  if (favorite) out.favorite = true;
  if (typeof r.nickname === 'string' && r.nickname) out.nickname = r.nickname;
  if (typeof r.uniqueId === 'string' && r.uniqueId) out.uniqueId = r.uniqueId;
  return out;
}
