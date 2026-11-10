import type { Viewer } from './events';
import { hasMemoContent, type MemoRecord } from './memos';
import { displayName } from './names';

/**
 * 常連さんの入室ポップアップ(画面上部)の表示状態(純関数)。
 * 1 人ずつ出し、表示中に来た人は順番待ちに積む(タップで次へ)。
 */

/** 来店がこの回数以上なら常連(バッジを紫にする回数と同じ)。 */
export const REGULAR_VISITS = 5;
/** 1 人の表示時間(ms)。フォロー通知(4 秒)より長く、前回のメモを読み切れるように。 */
export const REGULAR_POPUP_MS = 9000;
/** 順番待ちの上限。超えたら古い順番待ちから捨てる(一斉に来ても延々と出し続けない)。 */
export const REGULAR_QUEUE_MAX = 4;

export interface RegularJoin {
  visits: number;
  firstEver: boolean;
  /** その配信で何回目の入室か。 */
  nth?: number;
}

/**
 * ポップアップを出す入室か: 初見でなく、その配信で最初の入室(再入室では出さない)で、
 * 来店 REGULAR_VISITS 回以上か、メモ・前回・よみがな・お気に入りのどれかがある人。
 */
export function isRegularJoin(j: RegularJoin, memo: MemoRecord | undefined): boolean {
  if (j.firstEver) return false;
  if ((j.nth ?? 1) !== 1) return false;
  return j.visits >= REGULAR_VISITS || hasMemoContent(memo) || !!memo?.favorite;
}

export interface RegularPop {
  /** 表示ごとの連番(React の key / effect の張り直し用)。 */
  id: number;
  userId: string;
  name: string;
  kana?: string;
  avatarUrl?: string;
  gifterLevel?: number;
  visits: number;
  note?: string;
  previousNote?: string;
  previousJoinedMs?: number;
  favorite: boolean;
}

export interface RegularQueue {
  current: RegularPop;
  /** current をこの時刻(ms)まで出す。 */
  untilMs: number;
  waiting: RegularPop[];
}

let seq = 0;

export function makeRegularPop(v: Viewer, visits: number, memo: MemoRecord | undefined, previousJoinedMs: number | undefined): RegularPop {
  seq += 1;
  return {
    id: seq,
    userId: v.userId,
    name: displayName(v, memo),
    kana: memo?.kana || undefined,
    avatarUrl: v.avatarUrl,
    gifterLevel: v.gifterLevel,
    visits,
    note: memo?.note || undefined,
    previousNote: memo?.previousNote || undefined,
    previousJoinedMs,
    favorite: !!memo?.favorite,
  };
}

/** 表示中でなければすぐ出す。表示中なら順番待ちへ(同じ人は重ねない)。 */
export function pushRegular(q: RegularQueue | null, pop: RegularPop, now: number): RegularQueue {
  if (!q) return { current: pop, untilMs: now + REGULAR_POPUP_MS, waiting: [] };
  if (q.current.userId === pop.userId || q.waiting.some((w) => w.userId === pop.userId)) return q;
  const waiting = [...q.waiting, pop];
  return { ...q, waiting: waiting.length > REGULAR_QUEUE_MAX ? waiting.slice(waiting.length - REGULAR_QUEUE_MAX) : waiting };
}

/** 今の 1 人を閉じた。順番待ちがいれば次を出し、いなければ null。 */
export function nextRegular(q: RegularQueue | null, now: number): RegularQueue | null {
  if (!q || q.waiting.length === 0) return null;
  const [current, ...waiting] = q.waiting;
  return { current: current!, untilMs: now + REGULAR_POPUP_MS, waiting };
}
