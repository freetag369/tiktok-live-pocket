import type { LikeEvent, Viewer } from './events';

/**
 * いいねの集計(配信ごと・保存しない)。
 *
 *  - TikTok の LikeMessage は数タップをまとめて 1 通で届く(`count`)。`total` は部屋全体の累計で、
 *    その人の累計ではない。人ごとのタップ数は `count` を userId で合算する。
 *  - `burst` は「連打」の途中経過。前のタップから LIKE_BURST_MS 以内なら足し込み、空いたら取り直す。
 *    通知の「+N」とランキングの「いま連打中」はこれを見る。
 *  - Map はその場で更新するが、エントリは毎回新しいオブジェクトに差し替える(行の memo が効く)。
 */

export interface LikeEntry {
  userId: string;
  viewer: Viewer;
  /** この配信での累計タップ数。 */
  taps: number;
  /** いまの連打で積んだタップ数。 */
  burst: number;
  /** 最後にタップを受け取ったローカル時刻。 */
  lastMs: number;
  visits: number;
  firstEver: boolean;
}

/** この間隔以内の連続タップを 1 つの連打とみなす。通知の表示時間も同じ。 */
export const LIKE_BURST_MS = 3000;
/** 大部屋対策。人数がこれを超えたらタップの少ない方から 1/3 を捨てる。 */
export const LIKES_MAX = 3000;

export function touchLike(likes: Map<string, LikeEntry>, e: LikeEvent, meta: { visits: number; firstEver: boolean }, now: number): LikeEntry {
  const prev = likes.get(e.viewer.userId);
  const continuing = prev != null && now - prev.lastMs < LIKE_BURST_MS;
  const entry: LikeEntry = {
    userId: e.viewer.userId,
    viewer: e.viewer,
    taps: (prev?.taps ?? 0) + e.count,
    burst: continuing ? prev.burst + e.count : e.count,
    lastMs: now,
    visits: meta.visits,
    firstEver: meta.firstEver,
  };
  likes.set(entry.userId, entry);
  if (likes.size > LIKES_MAX) prune(likes);
  return entry;
}

function prune(likes: Map<string, LikeEntry>): void {
  const sorted = [...likes.values()].sort((a, b) => a.taps - b.taps || a.lastMs - b.lastMs);
  const drop = Math.floor(likes.size / 3);
  for (let i = 0; i < drop; i++) likes.delete(sorted[i]!.userId);
}

/** タップ数の多い順(同数なら新しい順、さらに同じなら userId 順)。 */
export function rankLikes(likes: Map<string, LikeEntry>, limit: number): LikeEntry[] {
  return [...likes.values()]
    .sort((a, b) => b.taps - a.taps || b.lastMs - a.lastMs || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
    .slice(0, limit);
}

/** `windowMs` 以内にタップした人を新しい順に。 */
export function recentLikers(likes: Map<string, LikeEntry>, now: number, windowMs: number, limit: number): LikeEntry[] {
  const out: LikeEntry[] = [];
  for (const e of likes.values()) if (now - e.lastMs < windowMs) out.push(e);
  return out.sort((a, b) => b.lastMs - a.lastMs || (a.userId < b.userId ? -1 : 1)).slice(0, limit);
}
