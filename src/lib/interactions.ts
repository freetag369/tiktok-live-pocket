import type { Viewer } from './events';
import type { FeedItem, FeedRow } from './feed';
import type { LikeEntry } from './likes';
import type { MemoRecord } from './memos';

/**
 * 「やり取り」タブの純粋ロジック。受信中の配信でコメント・ギフト・いいねをくれた人を
 * userId ごとにまとめ、その人の行(入室・フォローも含む)を時刻順に持つ。
 *
 *  - 行は 画面の履歴(最後の「新しい配信」区切り以降)+ アーカイブ(🧹 で消えた分・入室上限で
 *    落ちた分の補い)を id で重複排除して使う。画面側が新しい(連打の ×N)ので画面側を優先。
 *  - いいねは行にならない(FeedState.likes の人ごと累計)ので、taps と lastMs だけを足す。
 *    アーカイブから来る 1 分ごとのいいね行(k: 'like')は rows に残るが、人物シートでは sheetItems が 1 本にまとめる。
 */

export interface Interaction {
  userId: string;
  /** 一番新しい行(またはいいね)の viewer。名前の変更を反映する。 */
  viewer: Viewer;
  comments: number;
  gifts: number;
  diamonds: number;
  joins: number;
  follows: number;
  /** この配信のいいねタップ数。 */
  likes: number;
  /** 最後のやり取り(行の tsMs と いいねの lastMs の大きい方)。 */
  lastMs: number;
  likeLastMs?: number;
  visits: number;
  firstEver: boolean;
  /** この人の行。時刻順。入室・フォローも含む。 */
  rows: FeedRow[];
}

export type InteractionSort = 'recent' | 'most';

/** 最後の「新しい配信」区切り以降の行(区切りが無ければ全行)。 */
export function currentRoomRows(items: FeedItem[]): FeedRow[] {
  let start = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]!.k === 'room') {
      start = i + 1;
      break;
    }
  }
  const out: FeedRow[] = [];
  for (let i = start; i < items.length; i++) {
    const it = items[i]!;
    if (it.k !== 'room') out.push(it);
  }
  return out;
}

/** アーカイブ + 画面の行を id で重複排除(画面側優先)し、tsMs 順に並べる。 */
export function mergeRows(archived: FeedRow[], live: FeedRow[]): FeedRow[] {
  if (archived.length === 0) return live.slice().sort(byTs);
  const byId = new Map<string, FeedRow>();
  for (const r of archived) byId.set(r.id, r);
  for (const r of live) byId.set(r.id, r);
  return [...byId.values()].sort(byTs);
}

function byTs(a: FeedRow, b: FeedRow): number {
  return a.tsMs - b.tsMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** userId ごとに集計。コメント・ギフト・いいね のいずれかが 1 以上の人だけ返す(順不同)。 */
export function buildInteractions(rows: FeedRow[], likes: ReadonlyMap<string, LikeEntry>): Interaction[] {
  const map = new Map<string, Interaction>();
  const sorted = rows.slice().sort(byTs);
  for (const r of sorted) {
    const id = r.viewer.userId;
    let it = map.get(id);
    if (!it) {
      it = { userId: id, viewer: r.viewer, comments: 0, gifts: 0, diamonds: 0, joins: 0, follows: 0, likes: 0, lastMs: r.tsMs, visits: r.visits, firstEver: r.firstEver, rows: [] };
      map.set(id, it);
    }
    it.rows.push(r);
    // 行は時刻順に来るので、最後に見た行の名前・来店情報が最新。
    it.viewer = r.viewer;
    it.visits = r.visits;
    it.firstEver = r.firstEver;
    it.lastMs = Math.max(it.lastMs, r.tsMs);
    switch (r.k) {
      case 'comment':
        it.comments++;
        break;
      case 'gift':
        it.gifts++;
        it.diamonds += r.diamonds;
        break;
      case 'join':
        it.joins++;
        break;
      case 'social':
        if (r.sub === 'follow') it.follows++;
        break;
    }
  }
  for (const e of likes.values()) {
    if (e.taps <= 0) continue;
    let it = map.get(e.userId);
    if (!it) {
      it = { userId: e.userId, viewer: e.viewer, comments: 0, gifts: 0, diamonds: 0, joins: 0, follows: 0, likes: 0, lastMs: e.lastMs, visits: e.visits, firstEver: e.firstEver, rows: [] };
      map.set(e.userId, it);
    }
    it.likes = e.taps;
    it.likeLastMs = e.lastMs;
    if (e.lastMs >= it.lastMs) {
      it.lastMs = e.lastMs;
      it.viewer = e.viewer;
      it.visits = e.visits;
      it.firstEver = e.firstEver;
    }
  }
  const out: Interaction[] = [];
  for (const it of map.values()) if (it.comments > 0 || it.gifts > 0 || it.likes > 0) out.push(it);
  return out;
}

/** 人物シートに出す「いいね」の 1 行。1 分ごとの行を足し合わせたもの。 */
export interface LikeSummary {
  k: 'like-summary';
  /** タップ数。受信中の累計(likes)と保存済みの行の合計の大きい方。 */
  count: number;
  /** 最初のいいね行の時刻。 */
  firstMs: number;
  /** 最後のいいね(行か likeLastMs の新しい方)。 */
  lastMs: number;
}

export type SheetItem = FeedRow | LikeSummary;

/**
 * 人物シートに並べる行。1 分ごとのいいね行(アーカイブ由来)は 1 本の LikeSummary にまとめ、
 * 最後のいいねの時刻の位置に置く。いいね行が無ければ rows をそのまま返す(ヘッダに ❤️ の数は別に出る)。
 */
export function sheetItems(it: Interaction): SheetItem[] {
  const out: FeedRow[] = [];
  let count = 0;
  let firstMs = Infinity;
  let lastMs = -Infinity;
  for (const r of it.rows) {
    if (r.k !== 'like') {
      out.push(r);
      continue;
    }
    count += r.count;
    firstMs = Math.min(firstMs, r.tsMs);
    lastMs = Math.max(lastMs, r.tsMs);
  }
  if (!Number.isFinite(firstMs)) return out;
  const sum: LikeSummary = { k: 'like-summary', count: Math.max(count, it.likes), firstMs, lastMs: Math.max(lastMs, it.likeLastMs ?? 0) };
  // rows は時刻順なので、最後のいいねより後の行の手前に差し込む
  let at = out.length;
  while (at > 0 && out[at - 1]!.tsMs > sum.lastMs) at--;
  return [...out.slice(0, at), sum, ...out.slice(at)];
}

function byUserId(a: Interaction, b: Interaction): number {
  return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
}

/** recent: 最後のやり取りが新しい順 / most: 💎 → コメント数 → いいね数 → 新しい順。同順は userId。 */
export function sortInteractions(list: Interaction[], sort: InteractionSort): Interaction[] {
  const out = list.slice();
  if (sort === 'most') out.sort((a, b) => b.diamonds - a.diamonds || b.comments - a.comments || b.likes - a.likes || b.lastMs - a.lastMs || byUserId(a, b));
  else out.sort((a, b) => b.lastMs - a.lastMs || byUserId(a, b));
  return out;
}

/** 名前・@ハンドル・メモ本文・よみがな で部分一致(小文字化・trim)。空なら全件。 */
export function filterInteractions(list: Interaction[], query: string, memos: ReadonlyMap<string, MemoRecord>): Interaction[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((it) => {
    const m = memos.get(it.userId);
    return [it.viewer.nickname, it.viewer.uniqueId, m?.nickname, m?.uniqueId, m?.note, m?.previousNote, m?.kana].some((s) => s && s.toLowerCase().includes(q));
  });
}
