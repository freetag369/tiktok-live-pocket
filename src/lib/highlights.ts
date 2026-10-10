import type { ArchivedRow } from './archive';
import type { FeedRow } from './feed';

/**
 * ハイライト(日別のメンバー一覧)の純粋ロジック。IndexedDB は db.ts、配線は session.ts。
 *
 *  - 日付と時刻は日本時間(UTC+9・夏時間なし)。
 *  - 数えるのはコメント・いいね・フォロー・ギフトだけ(入室・シェアは数えない)。
 *  - いいねは 1 分ごと・人ごとに 1 行へまとめる(行の id は決まった形なので、上書きしても増えない)。
 *  - 1 日分(HighlightDay)は保存済みの行を 1 回読み、あとは受信した行を直接重ねる。
 *    いいねは「まだ保存していない分」を足し、ほかの行は同じ id で置き換える。
 */

const JST_OFFSET_MS = 9 * 3600_000;
const DAY_MS = 86_400_000;

/** 日本時間の日付 `YYYY-MM-DD`。 */
export function japanDay(ms = Date.now()): string {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 日本時間の時刻 `HH:MM:SS`。 */
export function japanTime(ms: number): string {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(11, 19);
}

/** `2026-09-26` → `9/26(土)`。 */
export function japanDayLabel(day: string): string {
  const [start] = dayRange(day);
  if (!Number.isFinite(start)) return day;
  const d = new Date(start + JST_OFFSET_MS);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${'日月火水木金土'[d.getUTCDay()]})`;
}

/** その日(日本時間)の [0 時, 翌 0 時)。読めない日付なら NaN。 */
export function dayRange(day: string): [number, number] {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00+09:00`) : NaN;
  return [start, start + DAY_MS];
}

/**
 * 日付欄で選んだ値 → 表示する日。今日を選んだら null(= 日付が変わっても今日を追う)。
 * 空欄・読めない値は今の選択のまま。
 */
export function pickHighlightDay(value: string, today: string, current: string | null): string | null {
  if (!Number.isFinite(dayRange(value)[0])) return current;
  return value === today ? null : value;
}

/**
 * 日本時間の日付が変わったら知らせる(0 時をまたいで「今日」を追うため)。
 * iOS は背面でタイマーが止まるので、一定間隔の確認と前面復帰の両方で見る。戻り値で解除。
 */
export function watchJapanDay(onChange: (day: string) => void, intervalMs = 15_000): () => void {
  let last = japanDay();
  const check = () => {
    const now = japanDay();
    if (now === last) return;
    last = now;
    onChange(now);
  };
  const timer = setInterval(check, intervalMs);
  const onVisible = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') check();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}

// ── いいねの行 ─────────────────────────────────────────────────────────

export type LikeRow = Extract<FeedRow, { k: 'like' }>;

/** いいねをまとめる幅。日本時間の 0 時は分の境目なので、1 つの枠が日をまたがない。 */
export const LIKE_BUCKET_MS = 60_000;

export function likeBucketStart(tsMs: number): number {
  return Math.floor(tsMs / LIKE_BUCKET_MS) * LIKE_BUCKET_MS;
}

/** (配信, 人, 1 分) ごとに決まる行 id。アーカイブの行は id だけが鍵なので配信も含める。 */
export function likeRowId(roomId: string, userId: string, bucketStartMs: number): string {
  return `like:${roomId}:${userId}:${bucketStartMs}`;
}

/** 同じ枠のいいねを足す(数は合計、時刻は新しい方、名前などは新しい行の値)。 */
export function addLike<T extends LikeRow>(prev: T | undefined, add: T): T {
  if (!prev) return add;
  return { ...prev, ...add, count: prev.count + add.count, tsMs: Math.max(prev.tsMs, add.tsMs), firstEver: prev.firstEver || add.firstEver };
}

// ── 行の扱い ───────────────────────────────────────────────────────────

/** 行の鍵(配信 + id)。 */
export function actionKey(row: { roomId: string; id: string }): string {
  return JSON.stringify([row.roomId, row.id]);
}

/** ハイライトに数える行か(コメント・いいね・ギフト・フォロー)。 */
export function isAction(row: FeedRow): boolean {
  return row.k === 'comment' || row.k === 'like' || row.k === 'gift' || (row.k === 'social' && row.sub === 'follow');
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 新しい順(同時刻は配信・id の順で固定)。 */
function byNewest(a: ArchivedRow, b: ArchivedRow): number {
  return b.tsMs - a.tsMs || cmp(a.roomId, b.roomId) || cmp(a.id, b.id);
}

/**
 * 1 日分の行。保存済み(putSaved)を置いたあと、受信した行を applyLive で重ねる。
 * いいねは足し込み(受信側は「まだ保存していない分」だけを持つ)、ほかは同じ鍵で置き換え。
 * 連打の更新で日付をまたいだギフトは、この日から外す。
 */
export class HighlightDay {
  readonly day: string;
  readonly start: number;
  readonly end: number;
  /** 保存済みの行を読み終えた。 */
  loaded = false;
  /** 保存済みの行を読めなかった(受信中の分だけを出している)。 */
  failed = false;
  private rows = new Map<string, ArchivedRow>();
  private sorted: ArchivedRow[] | null = null;

  constructor(day: string) {
    this.day = day;
    [this.start, this.end] = dayRange(day);
  }

  get size(): number {
    return this.rows.size;
  }

  private inDay(tsMs: number): boolean {
    return tsMs >= this.start && tsMs < this.end;
  }

  putSaved(rows: ArchivedRow[]): void {
    for (const row of rows) {
      if (!isAction(row) || !this.inDay(row.tsMs)) continue;
      this.rows.set(actionKey(row), row);
    }
    this.sorted = null;
  }

  applyLive(row: ArchivedRow): void {
    if (!isAction(row)) return;
    const key = actionKey(row);
    if (row.k === 'like') {
      if (!this.inDay(row.tsMs)) return;
      const prev = this.rows.get(key);
      this.rows.set(key, addLike(prev?.k === 'like' ? prev : undefined, row));
    } else if (this.inDay(row.tsMs)) {
      this.rows.set(key, row);
    } else {
      this.rows.delete(key);
    }
    this.sorted = null;
  }

  /** 新しい順。変わっていなければ同じ配列を返す。 */
  list(): ArchivedRow[] {
    if (!this.sorted) this.sorted = [...this.rows.values()].sort(byNewest);
    return this.sorted;
  }
}

/** 保存済みと受信中の行を 1 日分にまとめる(HighlightDay の 1 回きり版)。 */
export function mergeDayRows(day: string, saved: ArchivedRow[], live: Iterable<ArchivedRow>): ArchivedRow[] {
  const view = new HighlightDay(day);
  view.putSaved(saved);
  for (const row of live) view.applyLive(row);
  return view.list();
}

export interface HighlightMember {
  /** その人の最後のアクション。 */
  row: ArchivedRow;
  comments: number;
  likes: number;
  follows: number;
  gifts: number;
}

/** 人ごとに数え、最後にアクションした人から並べる。 */
export function highlightMembers(rows: ArchivedRow[]): HighlightMember[] {
  const members = new Map<string, HighlightMember>();
  for (const row of rows) {
    if (!isAction(row)) continue;
    let m = members.get(row.viewer.userId);
    if (!m) {
      m = { row, comments: 0, likes: 0, follows: 0, gifts: 0 };
      members.set(row.viewer.userId, m);
    }
    if (row.tsMs > m.row.tsMs) m.row = row;
    if (row.k === 'comment') m.comments++;
    else if (row.k === 'like') m.likes += row.count;
    else if (row.k === 'social') m.follows++;
    else if (row.k === 'gift') m.gifts += row.count;
  }
  return [...members.values()].sort((a, b) => b.row.tsMs - a.row.tsMs || cmp(a.row.viewer.userId, b.row.viewer.userId));
}

// ── 上限つきの重複表 ───────────────────────────────────────────────────

/** 入れた順に古い方から捨てる集合(長時間の配信でも大きくならない)。 */
export class BoundedSet {
  private set = new Set<string>();
  private readonly max: number;

  constructor(max: number) {
    this.max = Math.max(1, max);
  }

  get size(): number {
    return this.set.size;
  }

  has(key: string): boolean {
    return this.set.has(key);
  }

  /** 入れた(初めて見た)なら true。 */
  add(key: string): boolean {
    if (this.set.has(key)) return false;
    this.set.add(key);
    if (this.set.size > this.max) {
      // Set は入れた順に回るので、先頭が一番古い。
      const oldest = this.set.values().next().value;
      if (oldest !== undefined) this.set.delete(oldest);
    }
    return true;
  }

  clear(): void {
    this.set.clear();
  }
}
