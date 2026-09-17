import type { Viewer } from './events';

/**
 * フォロー通知ポップアップの表示状態(純関数)。
 * 表示中に次のフォローが来たら 1 枚に合算して表示時間を延ばす。
 */

/** 1 枚の表示時間(ms)。合算されるたびにここから数え直す。 */
export const FOLLOW_TOAST_MS = 4000;
/** 名前を並べる上限。超えた分は「他 N 人」。 */
export const FOLLOW_TOAST_MAX_NAMES = 2;

export interface FollowToast {
  /** 新規表示のたびに増える連番(React の key / effect の張り直し用)。 */
  id: number;
  /** 到着順の表示名(重複なし)。 */
  names: string[];
  /** 最後にフォローした人のアイコン。 */
  avatarUrl?: string;
  /** 合算内に初見がいれば true。 */
  firstEver: boolean;
  /** この時刻(ms)まで表示する。 */
  untilMs: number;
}

export interface FollowHit {
  name: string;
  avatarUrl?: string;
  firstEver: boolean;
}

let seq = 0;

/** 表示中(untilMs > now)なら合算して延長、そうでなければ新しい 1 枚を作る。 */
export function pushFollow(cur: FollowToast | null, hit: FollowHit, now: number): FollowToast {
  if (cur && cur.untilMs > now) {
    const names = cur.names.includes(hit.name) ? cur.names : [...cur.names, hit.name];
    return {
      ...cur,
      names,
      avatarUrl: hit.avatarUrl || cur.avatarUrl,
      firstEver: cur.firstEver || hit.firstEver,
      untilMs: now + FOLLOW_TOAST_MS,
    };
  }
  seq += 1;
  return { id: seq, names: [hit.name], avatarUrl: hit.avatarUrl, firstEver: hit.firstEver, untilMs: now + FOLLOW_TOAST_MS };
}

/** 「A さん」「A さん・B さん」「A さん・B さん 他 3 人」 */
export function followToastLabel(names: string[]): string {
  const shown = names.slice(0, FOLLOW_TOAST_MAX_NAMES).map((n) => `${n} さん`);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join('・')} 他 ${rest} 人` : shown.join('・');
}

/** 表示名: nickname → uniqueId → userId。 */
export function followerName(v: Viewer): string {
  return v.nickname?.trim() || v.uniqueId?.trim() || v.userId;
}
