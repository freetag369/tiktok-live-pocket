import type { GiftEvent, NormalizedEvent, Viewer } from './events';

/** 画面に並ぶ 1 行。UI はこれだけを描く。 */
export type FeedRow =
  | { k: 'like'; id: string; tsMs: number; viewer: Viewer; count: number; visits: number; firstEver: boolean }
  | {
      k: 'comment';
      id: string;
      tsMs: number;
      viewer: Viewer;
      text: string;
      visits: number;
      firstEver: boolean;
    }
  | {
      k: 'join';
      id: string;
      tsMs: number;
      viewer: Viewer;
      visits: number;
      firstEver: boolean;
    }
  | {
      k: 'gift';
      id: string;
      tsMs: number;
      viewer: Viewer;
      giftId: string;
      giftName: string;
      iconUrl?: string;
      count: number;
      diamondEach: number;
      diamonds: number;
      /** 連打がまだ続いている(×N が伸びる)。 */
      streaking: boolean;
      visits: number;
      firstEver: boolean;
    }
  | {
      k: 'social';
      id: string;
      tsMs: number;
      viewer: Viewer;
      sub: 'follow' | 'share' | 'other';
      visits: number;
      firstEver: boolean;
    };

export interface FeedState {
  rows: FeedRow[];
  /** 見た msgId(バックログ再送の重複排除)。上限を超えたら古い方から捨てる。 */
  seen: Set<string>;
  seenOrder: string[];
  /** 連打の進行中行: streakKey → { rowId, counted } */
  streaks: Map<string, { rowId: string; counted: number; row?: Extract<FeedRow, { k: 'gift' }> }>;
  /** 直近の入室時刻: userId → tsMs(MemberMessage と Barrage の両方が届いたときの二重表示防止)。 */
  lastJoin: Map<string, number>;
  /** この配信の累計💎(tick ごとの差分で積むので、最後の repeatEnd が欠けても正しい)。 */
  diamonds: number;
  giftCount: number;
  commentCount: number;
  joinCount: number;
  /** 直近の applyEvent で作成または更新した行(アーカイブ保存用)。state が変わらなければ触らない。 */
  lastTouched: FeedRow | null;
}

export const FEED_MAX_ROWS = 500;
export const SEEN_MAX = 5000;
/** 同じ人の入室がこの間隔以内に重なったら 1 行にまとめる。 */
export const JOIN_DEDUPE_MS = 10_000;
const LAST_JOIN_PRUNE_AT = 2000;

export function createFeedState(): FeedState {
  return {
    rows: [],
    seen: new Set(),
    seenOrder: [],
    streaks: new Map(),
    lastJoin: new Map(),
    diamonds: 0,
    giftCount: 0,
    commentCount: 0,
    joinCount: 0,
    lastTouched: null,
  };
}

export interface ViewerMeta {
  visits: number;
  firstEver: boolean;
}

function remember(s: FeedState, msgId: string): boolean {
  if (s.seen.has(msgId)) return false;
  s.seen.add(msgId);
  s.seenOrder.push(msgId);
  if (s.seenOrder.length > SEEN_MAX) {
    const drop = s.seenOrder.splice(0, s.seenOrder.length - SEEN_MAX);
    for (const id of drop) s.seen.delete(id);
  }
  return true;
}

function push(s: FeedState, row: FeedRow): FeedRow[] {
  const rows = s.rows.length >= FEED_MAX_ROWS ? s.rows.slice(s.rows.length - FEED_MAX_ROWS + 1) : s.rows.slice();
  rows.push(row);
  return rows;
}

function streakKey(e: GiftEvent): string {
  return e.groupId ? `g:${e.groupId}` : `u:${e.viewer.userId}:${e.giftId}`;
}

/**
 * イベントを 1 件取り込み、新しい state を返す(rows は変更時だけ差し替える)。
 * `meta` は来店カウンタが決めた「何回目/初見」。
 */
export function applyEvent(s: FeedState, e: NormalizedEvent, meta: ViewerMeta, iconFallback?: string): FeedState {
  switch (e.kind) {
    case 'like': {
      if (e.count <= 0 || !remember(s, e.msgId)) return s;
      return { ...s, lastTouched: { k: 'like', id: e.msgId, tsMs: e.tsMs, viewer: e.viewer, count: e.count, ...meta } };
    }
    case 'comment': {
      if (!remember(s, e.msgId)) return s;
      const row: FeedRow = {
        k: 'comment',
        id: e.msgId,
        tsMs: e.tsMs,
        viewer: e.viewer,
        text: e.content,
        visits: meta.visits,
        firstEver: meta.firstEver,
      };
      return { ...s, rows: push(s, row), commentCount: s.commentCount + 1, lastTouched: row };
    }

    case 'join': {
      // 1 = JOINED。3 = SUBSCRIBED は入室ではない。
      if (e.action !== 1) return s;
      if (!remember(s, e.msgId)) return s;
      // 同じ人の入室が MemberMessage と Barrage(レベル持ち入室通知)の両方で届いても 1 行にする。
      const prev = s.lastJoin.get(e.viewer.userId);
      if (prev != null && Math.abs(e.tsMs - prev) < JOIN_DEDUPE_MS) return s;
      const lastJoin = new Map(s.lastJoin);
      if (lastJoin.size > LAST_JOIN_PRUNE_AT) {
        const cutoff = e.tsMs - JOIN_DEDUPE_MS;
        for (const [id, ts] of lastJoin) if (ts < cutoff) lastJoin.delete(id);
      }
      lastJoin.set(e.viewer.userId, e.tsMs);
      const row: FeedRow = {
        k: 'join',
        id: e.msgId,
        tsMs: e.tsMs,
        viewer: e.viewer,
        visits: meta.visits,
        firstEver: meta.firstEver,
      };
      return { ...s, rows: push(s, row), lastJoin, joinCount: s.joinCount + 1, lastTouched: row };
    }

    case 'social': {
      if (e.sub === 'other') return s;
      if (!remember(s, e.msgId)) return s;
      const row: FeedRow = {
        k: 'social',
        id: e.msgId,
        tsMs: e.tsMs,
        viewer: e.viewer,
        sub: e.sub,
        visits: meta.visits,
        firstEver: meta.firstEver,
      };
      return { ...s, rows: push(s, row), lastTouched: row };
    }

    case 'gift': {
      if (!remember(s, e.msgId)) return s;
      const iconUrl = e.iconUrl || iconFallback || undefined;
      const key = streakKey(e);
      const cur = e.giftType === 1 ? s.streaks.get(key) : undefined;

      if (cur) {
        // 連打の続き: 同じ行を更新し、増えた分だけ累計に足す。
        const delta = Math.max(0, e.repeatCount - cur.counted);
        const rows = s.rows.slice();
        const idx = rows.findIndex((r) => r.id === cur.rowId);
        let touched: FeedRow | null = null;
        const old = idx >= 0 ? rows[idx] as Extract<FeedRow, { k: 'gift' }> : cur.row;
        if (old) {
          const count = Math.max(old.count, e.repeatCount);
          touched = {
            ...old,
            count,
            diamonds: count * old.diamondEach,
            streaking: e.streaking,
            iconUrl: old.iconUrl || iconUrl,
            tsMs: e.tsMs,
          };
          if (idx >= 0) rows[idx] = touched;
        }
        const streaks = new Map(s.streaks);
        if (e.streaking) streaks.set(key, { rowId: cur.rowId, counted: Math.max(cur.counted, e.repeatCount), row: touched?.k === 'gift' ? touched : cur.row });
        else streaks.delete(key);
        return { ...s, rows, streaks, diamonds: s.diamonds + delta * e.diamondEach, lastTouched: touched };
      }

      const row: FeedRow = {
        k: 'gift',
        id: e.msgId,
        tsMs: e.tsMs,
        viewer: e.viewer,
        giftId: e.giftId,
        giftName: e.giftName,
        iconUrl,
        count: e.repeatCount,
        diamondEach: e.diamondEach,
        diamonds: e.repeatCount * e.diamondEach,
        streaking: e.streaking,
        visits: meta.visits,
        firstEver: meta.firstEver,
      };
      const streaks = new Map(s.streaks);
      if (e.streaking) streaks.set(key, { rowId: row.id, counted: e.repeatCount, row });
      return {
        ...s,
        rows: push(s, row),
        streaks,
        diamonds: s.diamonds + e.repeatCount * e.diamondEach,
        giftCount: s.giftCount + 1,
        lastTouched: row,
      };
    }

    default:
      return s;
  }
}

export type Tab = 'all' | 'comment' | 'join' | 'gift';

export function filterRows(rows: FeedRow[], tab: Tab): FeedRow[] {
  switch (tab) {
    case 'all':
      return rows;
    case 'comment':
      return rows.filter((r) => r.k === 'comment');
    case 'join':
      return rows.filter((r) => r.k === 'join' || r.k === 'social');
    case 'gift':
      return rows.filter((r) => r.k === 'gift');
  }
}

/** 配信が切り替わったとき(roomId が変わった)に呼ぶ。行は残し、集計と重複表だけ捨てる。 */
export function resetForNewRoom(s: FeedState): FeedState {
  return { ...s, seen: new Set(), seenOrder: [], streaks: new Map(), lastJoin: new Map(), diamonds: 0, giftCount: 0, commentCount: 0, joinCount: 0, lastTouched: null };
}
