import type { GiftEvent, NormalizedEvent, Viewer } from './events';
import { touchLike, type LikeEntry } from './likes';

/** 画面に並ぶ 1 行。UI はこれだけを描く。 */
export type FeedRow =
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
      /** 連打のまとまり(TikTok の groupId)。再起動後に同じ連打だと分かるように持つ。 */
      groupId?: string;
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

/** 配信の境目(「── 新しい配信 ──」)。行ではないので書き出し・アーカイブには入らない。 */
export interface RoomMark {
  k: 'room';
  /** 発生ごとに一意(同じ配信に戻ってきても重ならない)。 */
  id: string;
  tsMs: number;
  roomId: string;
  hostNickname?: string;
}

/** 画面に並ぶもの(行 + 配信の境目)。 */
export type FeedItem = FeedRow | RoomMark;

export interface FeedState {
  rows: FeedItem[];
  /** 見た msgId(バックログ再送の重複排除)。上限を超えたら古い方から捨てる。 */
  seen: Set<string>;
  seenOrder: string[];
  /** 連打の進行中行: streakKey → { rowId, counted } */
  streaks: Map<string, { rowId: string; counted: number }>;
  /** 直近の入室時刻: userId → tsMs(MemberMessage と Barrage の両方が届いたときの二重表示防止)。 */
  lastJoin: Map<string, number>;
  /** この配信の累計💎(tick ごとの差分で積むので、最後の repeatEnd が欠けても正しい)。 */
  diamonds: number;
  giftCount: number;
  commentCount: number;
  joinCount: number;
  /** rows に入っている入室・フォロー・シェアの数(上限判定用)。 */
  joinRows: number;
  /** いま行を積んでいる配信。空なら未確定。 */
  roomId: string;
  /** この配信のいいね集計: userId → エントリ(行にはしない)。Map はその場で更新する。 */
  likes: Map<string, LikeEntry>;
  /** この配信の合計タップ数。いいねが入るたび必ず増えるので、UI はこれを更新の印にする。 */
  likeCount: number;
  /** TikTok が送ってくる部屋全体の累計いいね(接続前の分も含む)。見た中の最大値。 */
  likeRoomTotal?: number;
  /** 直近の applyEvent で作成または更新した行(アーカイブ・画面の履歴の保存用)。state が変わらなければ触らない。 */
  lastTouched: FeedRow | null;
}

/** 入室・フォロー・シェアの行だけこの数で頭打ちにする。コメントとギフトは 🧹 まで残す。 */
export const FEED_KEEP_JOINS = 500;
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
    joinRows: 0,
    roomId: '',
    likes: new Map(),
    likeCount: 0,
    lastTouched: null,
  };
}

export interface ViewerMeta {
  visits: number;
  firstEver: boolean;
}

export function isRow(i: FeedItem): i is FeedRow {
  return i.k !== 'room';
}

/** 区切りを除いた行だけ(書き出し用)。 */
export function dataRows(items: FeedItem[]): FeedRow[] {
  return items.filter(isRow);
}

export function countDataRows(items: FeedItem[]): number {
  let n = 0;
  for (const i of items) if (i.k !== 'room') n++;
  return n;
}

/** 上限で落としてよい行(入室・フォロー・シェア)。 */
function capped(i: FeedItem): boolean {
  return i.k === 'join' || i.k === 'social';
}

function countCapped(items: FeedItem[]): number {
  let n = 0;
  for (const i of items) if (capped(i)) n++;
  return n;
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

/** 行を積む。コメント・ギフトは捨てず、入室・フォローだけ古い方から頭打ちにする。 */
function push(s: FeedState, row: FeedRow): { rows: FeedItem[]; joinRows: number } {
  const rows = s.rows.slice();
  rows.push(row);
  let joinRows = s.joinRows + (capped(row) ? 1 : 0);
  if (joinRows > FEED_KEEP_JOINS) {
    const idx = rows.findIndex(capped);
    // いま積んだ行は落とさない。見つからなければ数え直す(取りこぼし防止)。
    if (idx >= 0 && rows[idx] !== row) {
      rows.splice(idx, 1);
      joinRows--;
    } else {
      joinRows = countCapped(rows);
    }
  }
  return { rows, joinRows };
}

function streakKey(e: GiftEvent): string {
  return e.groupId ? `g:${e.groupId}` : `u:${e.viewer.userId}:${e.giftId}`;
}

/** 連打中の行は末尾側にいるので後ろから探す。 */
function indexOfItem(rows: FeedItem[], id: string): number {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.id === id) return i;
  return -1;
}

/**
 * イベントを 1 件取り込み、新しい state を返す(rows は変更時だけ差し替える)。
 * `meta` は来店カウンタが決めた「何回目/初見」。
 * `now` は受信時のローカル時刻(いいねの連打判定に使う。createTime はサーバ時刻でズレる)。
 */
export function applyEvent(s: FeedState, e: NormalizedEvent, meta: ViewerMeta, iconFallback?: string, now: number = e.tsMs): FeedState {
  switch (e.kind) {
    case 'like': {
      if (e.count <= 0) return s;
      if (!remember(s, e.msgId)) return s;
      touchLike(s.likes, e, meta, now);
      const likeRoomTotal = e.roomTotal != null ? Math.max(s.likeRoomTotal ?? 0, e.roomTotal) : s.likeRoomTotal;
      return { ...s, likeCount: s.likeCount + e.count, likeRoomTotal, lastTouched: null };
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
      return { ...s, ...push(s, row), commentCount: s.commentCount + 1, lastTouched: row };
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
      return { ...s, ...push(s, row), lastJoin, joinCount: s.joinCount + 1, lastTouched: row };
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
      return { ...s, ...push(s, row), lastTouched: row };
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
        const idx = indexOfItem(rows, cur.rowId);
        let touched: FeedRow | null = null;
        if (idx >= 0) {
          const old = rows[idx] as Extract<FeedRow, { k: 'gift' }>;
          const count = Math.max(old.count, e.repeatCount);
          rows[idx] = {
            ...old,
            count,
            diamonds: count * old.diamondEach,
            streaking: e.streaking,
            iconUrl: old.iconUrl || iconUrl,
            tsMs: e.tsMs,
          };
          touched = rows[idx] as FeedRow;
        }
        const streaks = new Map(s.streaks);
        if (e.streaking) streaks.set(key, { rowId: cur.rowId, counted: Math.max(cur.counted, e.repeatCount) });
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
        ...(e.groupId ? { groupId: e.groupId } : {}),
        count: e.repeatCount,
        diamondEach: e.diamondEach,
        diamonds: e.repeatCount * e.diamondEach,
        streaking: e.streaking,
        visits: meta.visits,
        firstEver: meta.firstEver,
      };
      const streaks = new Map(s.streaks);
      if (e.streaking) streaks.set(key, { rowId: row.id, counted: e.repeatCount });
      return {
        ...s,
        ...push(s, row),
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

function inTab(r: FeedRow, tab: Tab): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'comment':
      return r.k === 'comment';
    case 'join':
      return r.k === 'join' || r.k === 'social';
    case 'gift':
      return r.k === 'gift';
  }
}

/**
 * タブで絞る。配信の区切りは全タブに残すが、続けて並んだ区切りは後ろだけにし、
 * その種類の行が 1 つも無ければ空にする(「まだ何も届いていません」を出すため)。
 */
export function filterRows<T extends FeedItem>(items: T[], tab: Tab): T[] {
  const out: T[] = [];
  let rows = 0;
  for (const i of items) {
    if (i.k === 'room') {
      const last = out[out.length - 1];
      if (last && last.k === 'room') out[out.length - 1] = i;
      else out.push(i);
      continue;
    }
    if (!inTab(i, tab)) continue;
    out.push(i);
    rows++;
  }
  if (rows === 0) return [];
  return out.length === items.length ? items : out;
}

/**
 * 配信が変わったときに呼ぶ。同じ配信・まだ未確定なら採用するだけ(再起動後の続き)。
 * 別の配信なら区切りを積み、集計・重複表をリセットする(行は残す)。
 */
export function enterRoom(s: FeedState, roomId: string, o: { hostNickname?: string; now: number }): FeedState {
  if (s.roomId === roomId) return s;
  if (!s.roomId) return { ...s, roomId };

  let rows = s.rows;
  if (rows.some(isRow)) {
    const mark: RoomMark = { k: 'room', id: `room:${roomId}:${o.now}`, tsMs: o.now, roomId };
    if (o.hostNickname) mark.hostNickname = o.hostNickname;
    const last = rows[rows.length - 1];
    rows = last && last.k === 'room' ? [...rows.slice(0, -1), mark] : [...rows, mark];
  }
  // 打ち切る連打の ×N が光ったまま残らないようにする。
  if (s.streaks.size) {
    const live = new Set([...s.streaks.values()].map((x) => x.rowId));
    rows = rows.map((r) => (r.k === 'gift' && r.streaking && live.has(r.id) ? { ...r, streaking: false } : r));
  }
  return {
    ...s,
    rows,
    roomId,
    seen: new Set(),
    seenOrder: [],
    streaks: new Map(),
    lastJoin: new Map(),
    diamonds: 0,
    giftCount: 0,
    commentCount: 0,
    joinCount: 0,
    likes: new Map(),
    likeCount: 0,
    likeRoomTotal: undefined,
    lastTouched: null,
  };
}

/**
 * 🧹 画面の行だけ消す。連打中のギフト行は残す(消すと続きの tick が迷子になり、
 * 💎 だけ増えてアーカイブの ×N も止まるため)。集計・💎・seen・配信は残す。
 */
export function clearRows(s: FeedState): FeedState {
  const live = new Set([...s.streaks.values()].map((x) => x.rowId));
  // 残すのは「いま伸びている」行だけ(復元した過去の連打は残さない)。
  const rows: FeedItem[] = live.size ? s.rows.filter((r) => r.k === 'gift' && r.streaking && live.has(r.id)) : [];
  return { ...s, rows, joinRows: 0, lastTouched: null };
}

// ── 画面の履歴(IndexedDB に残す分) ─────────────────────────────────

/** 保存する 1 件(行 or 区切り + どの配信か + 並び順)。 */
export type ScreenItem = FeedItem & { roomId: string; seq: number };

/** 画面の履歴の付帯情報(集計・重複表・連打)。1 レコードだけ。 */
export interface ScreenMeta {
  roomId: string;
  commentCount: number;
  joinCount: number;
  giftCount: number;
  diamonds: number;
  /** 直近の msgId(再接続のバックログ再送を弾く)。 */
  seen: string[];
  streaks: Array<[string, { rowId: string; counted: number }]>;
}

/** meta に残す seen の数。バックログ再送は直近だけなのでこれで足りる。 */
export const SCREEN_SEEN_KEEP = 300;

export function toScreenMeta(s: FeedState): ScreenMeta {
  return {
    roomId: s.roomId,
    commentCount: s.commentCount,
    joinCount: s.joinCount,
    giftCount: s.giftCount,
    diamonds: s.diamonds,
    seen: s.seenOrder.slice(-SCREEN_SEEN_KEEP),
    streaks: [...s.streaks.entries()],
  };
}

/** 保存してあった画面の履歴を FeedState に戻す。落とした入室の id は dropIds(掃除用)。 */
export function restoreFeed(items: ScreenItem[], meta: ScreenMeta | null): { state: FeedState; dropIds: string[] } {
  const sorted = [...items].sort((a, b) => a.seq - b.seq || a.tsMs - b.tsMs);
  let over = Math.max(0, countCapped(sorted) - FEED_KEEP_JOINS);
  const dropIds: string[] = [];
  const rows: FeedItem[] = [];
  for (const it of sorted) {
    if (over > 0 && capped(it)) {
      over--;
      dropIds.push(it.id);
      continue;
    }
    if (it.k === 'room') {
      const mark: RoomMark = { k: 'room', id: it.id, tsMs: it.tsMs, roomId: it.roomId };
      if (it.hostNickname) mark.hostNickname = it.hostNickname;
      rows.push(mark);
      continue;
    }
    const { roomId: _room, seq: _seq, ...rest } = it;
    const row = rest as FeedRow;
    // 連打中に閉じた行が光ったままにならないようにする。続きは streaks で伸びる。
    rows.push(row.k === 'gift' && row.streaking ? { ...row, streaking: false } : row);
  }

  const s = createFeedState();
  s.rows = rows;
  s.joinRows = countCapped(rows);
  const lastRoomId = sorted.length ? sorted[sorted.length - 1]!.roomId : '';
  // 終わった連打も「その行のもの」として覚えておく。再接続のバックログで
  // 途中の tick(行の id ではない)が再送されても、新しい行を作らず 💎 も増やさない。
  for (const r of rows) {
    if (r.k === 'gift' && r.groupId) s.streaks.set(`g:${r.groupId}`, { rowId: r.id, counted: r.count });
  }
  if (meta) {
    s.roomId = meta.roomId;
    s.commentCount = meta.commentCount;
    s.joinCount = meta.joinCount;
    s.giftCount = meta.giftCount;
    s.diamonds = meta.diamonds;
    // 進行中の連打は meta の数え(counted)が正しいので上書きする。
    for (const [key, v] of meta.streaks) s.streaks.set(key, v);
    for (const id of meta.seen) remember(s, id);
  } else {
    // meta が無いときは、最後の配信の行から数える。
    s.roomId = lastRoomId;
    for (const it of sorted) {
      if (it.k === 'room' || it.roomId !== lastRoomId) continue;
      if (it.k === 'comment') s.commentCount++;
      else if (it.k === 'join') s.joinCount++;
      else if (it.k === 'gift') {
        s.giftCount++;
        s.diamonds += it.diamonds;
      }
    }
  }
  // 上限で落とした入室も「見た」ことにしておく(再接続のバックログで戻ってこないように)。
  for (const it of sorted) if (it.k !== 'room') remember(s, it.id);
  return { state: s, dropIds };
}

// ── 画面に描く窓(FeedList 用の純粋計算) ───────────────────────────

/** 末尾 size 件(追従中に描く分)。 */
export function tailWindow<T>(items: T[], size: number): T[] {
  return items.length > size ? items.slice(items.length - size) : items;
}

export interface WindowResult {
  items: FeedItem[];
  /** 今回下に足した件数。 */
  appended: number;
  /** 窓より前に隠れている件数(「さらに前」の残り)。 */
  hiddenBefore: number;
  /** 固定していた行が全部消えた(窓を作り直す)。 */
  stale: boolean;
}

/**
 * 追従を止めている間の窓。表示中の行は消さず(上限で落ちた入室も残す)、
 * 新着は下に appendLeft 件まで足す。
 */
export function reconcileWindow(frozen: FeedItem[], items: FeedItem[], appendLeft: number): WindowResult {
  const idx = new Map<string, number>();
  for (let i = 0; i < items.length; i++) idx.set(items[i]!.id, i);
  const kept: FeedItem[] = [];
  let first = -1;
  let last = -1;
  for (const f of frozen) {
    const i = idx.get(f.id);
    if (i == null) {
      kept.push(f);
      continue;
    }
    kept.push(items[i]!);
    if (first < 0) first = i;
    last = i;
  }
  if (last < 0) return { items: kept, appended: 0, hiddenBefore: 0, stale: true };
  const extra = appendLeft > 0 ? items.slice(last + 1, last + 1 + appendLeft) : [];
  return { items: extra.length ? kept.concat(extra) : kept, appended: extra.length, hiddenBefore: first, stale: false };
}

/** 追従を止めてから増えた行数(「↓ 新着 N 件」)。基準の行が落ちていたら時刻で数える。 */
export function countAfter(items: FeedItem[], tail: { id: string; tsMs: number } | null): number {
  if (!tail) return 0;
  let n = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.id === tail.id) return n;
    if (it.k !== 'room') n++;
  }
  n = 0;
  for (const it of items) if (it.k !== 'room' && it.tsMs > tail.tsMs) n++;
  return n;
}
