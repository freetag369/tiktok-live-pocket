import type { Viewer } from './events';
import { filterRows, type FeedRow, type Tab } from './feed';
import { stamp } from './format';

/**
 * アーカイブ(配信ごとの全行)の純粋ロジック。IndexedDB への読み書きは db.ts。
 *
 *  - 行は FeedRow に roomId を付けてそのまま保存する(画面の 500 行上限とは無関係に全件)。
 *  - 配信(StreamRecord)は行を保存するたびに集計を更新する。同じ id の行を再保存しても
 *    二重に数えない(prev を見て差分だけ足す)ので、再接続・再起動・バックアップ取り込みに強い。
 */

export interface StreamRecord {
  roomId: string;
  hostUniqueId?: string;
  hostNickname?: string;
  /** 行の tsMs の最小 / 最大。 */
  startedMs: number;
  endedMs: number;
  rows: number;
  comments: number;
  joins: number;
  gifts: number;
  diamonds: number;
}

export type ArchivedRow = FeedRow & { roomId: string };

export interface HostInfo {
  hostUniqueId?: string;
  hostNickname?: string;
}

export function applyRowToStream(cur: StreamRecord | undefined, prev: FeedRow | undefined, row: FeedRow, host: HostInfo, roomId: string): StreamRecord {
  const s: StreamRecord = cur ? { ...cur } : { roomId, startedMs: row.tsMs, endedMs: row.tsMs, rows: 0, comments: 0, joins: 0, gifts: 0, diamonds: 0 };
  if (host.hostUniqueId) s.hostUniqueId = host.hostUniqueId;
  if (host.hostNickname) s.hostNickname = host.hostNickname;
  s.startedMs = Math.min(s.startedMs, row.tsMs);
  s.endedMs = Math.max(s.endedMs, row.tsMs);
  if (!prev) {
    s.rows += 1;
    if (row.k === 'comment') s.comments += 1;
    else if (row.k === 'join') s.joins += 1;
    else if (row.k === 'gift') {
      s.gifts += 1;
      s.diamonds += row.diamonds;
    }
  } else if (row.k === 'gift' && prev.k === 'gift') {
    // 連打の更新: 増えた分だけ
    s.diamonds += row.diamonds - prev.diamonds;
  }
  return s;
}

/** タブで絞り、検索語(名前・@ハンドル・本文・ギフト名)で部分一致。 */
export function filterArchiveRows(rows: FeedRow[], tab: Tab, query: string): FeedRow[] {
  const base = filterRows(rows, tab);
  const q = query.trim().toLowerCase();
  if (!q) return base;
  return base.filter((r) => {
    const v = r.viewer;
    if (v.nickname?.toLowerCase().includes(q) || v.uniqueId?.toLowerCase().includes(q)) return true;
    if (r.k === 'comment') return r.text.toLowerCase().includes(q);
    if (r.k === 'gift') return r.giftName.toLowerCase().includes(q);
    return false;
  });
}

/** 新しい配信が先。 */
export function sortStreams(streams: StreamRecord[]): StreamRecord[] {
  return [...streams].sort((a, b) => b.startedMs - a.startedMs);
}

/** 新しい順に keep 件を残し、それより古い配信の roomId を返す。受信中の部屋は残す。 */
export function streamsToPrune(streams: StreamRecord[], keep: number, protectRoomId?: string): string[] {
  const out: string[] = [];
  let kept = 0;
  for (const s of sortStreams(streams)) {
    if (s.roomId === protectRoomId) continue;
    if (kept < keep) kept++;
    else out.push(s.roomId);
  }
  return out;
}

export function streamHost(s: StreamRecord, fallback = ''): string {
  return s.hostNickname || (s.hostUniqueId ? `@${s.hostUniqueId}` : fallback);
}

/** 書き出しファイル名の幹 `live-log-<host>-<配信開始日時>`。 */
export function streamFileStem(s: StreamRecord, fallbackHost: string): string {
  const host = (s.hostUniqueId || fallbackHost || 'live').replace(/[^\w.-]+/g, '_');
  return `live-log-${host}-${stamp(new Date(s.startedMs))}`;
}

/** 外から来た行(バックアップ)を検証。壊れていれば null。 */
export function sanitizeArchivedRow(raw: unknown): ArchivedRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || typeof r.roomId !== 'string' || !r.roomId) return null;
  const tsMs = Number(r.tsMs);
  if (!Number.isFinite(tsMs)) return null;
  const viewer = sanitizeViewer(r.viewer);
  if (!viewer) return null;
  const visits = Math.max(0, Math.floor(Number(r.visits) || 0));
  const firstEver = Boolean(r.firstEver);
  const common = { id: r.id, roomId: r.roomId, tsMs, viewer, visits, firstEver };
  switch (r.k) {
    case 'comment':
      return { k: 'comment', ...common, text: typeof r.text === 'string' ? r.text : '' };
    case 'join':
      return { k: 'join', ...common };
    case 'social':
      return { k: 'social', ...common, sub: r.sub === 'share' ? 'share' : r.sub === 'other' ? 'other' : 'follow' };
    case 'gift': {
      const count = Math.max(1, Math.floor(Number(r.count) || 1));
      const diamondEach = Math.max(0, Number(r.diamondEach) || 0);
      const diamonds = Number.isFinite(Number(r.diamonds)) ? Math.max(0, Number(r.diamonds)) : count * diamondEach;
      const out: ArchivedRow = {
        k: 'gift',
        ...common,
        giftId: typeof r.giftId === 'string' ? r.giftId : String(r.giftId ?? ''),
        giftName: typeof r.giftName === 'string' ? r.giftName : '',
        count,
        diamondEach,
        diamonds,
        streaking: false,
      };
      if (typeof r.iconUrl === 'string' && /^https?:\/\//.test(r.iconUrl)) out.iconUrl = r.iconUrl;
      return out;
    }
    default:
      return null;
  }
}

function sanitizeViewer(raw: unknown): Viewer | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const userId = typeof v.userId === 'string' ? v.userId : typeof v.userId === 'number' ? String(v.userId) : '';
  if (!userId) return null;
  const out: Viewer = { userId };
  if (typeof v.uniqueId === 'string' && v.uniqueId) out.uniqueId = v.uniqueId;
  if (typeof v.nickname === 'string' && v.nickname) out.nickname = v.nickname;
  if (typeof v.avatarUrl === 'string' && /^https?:\/\//.test(v.avatarUrl)) out.avatarUrl = v.avatarUrl;
  if (v.isModerator === true) out.isModerator = true;
  if (v.isSubscriber === true) out.isSubscriber = true;
  if (v.isFollower === true) out.isFollower = true;
  return out;
}

export function sanitizeStream(raw: unknown): StreamRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.roomId !== 'string' || !r.roomId) return null;
  const startedMs = Number(r.startedMs);
  if (!Number.isFinite(startedMs)) return null;
  const n = (k: string) => Math.max(0, Math.floor(Number(r[k]) || 0));
  const s: StreamRecord = { roomId: r.roomId, startedMs, endedMs: Number(r.endedMs) || startedMs, rows: n('rows'), comments: n('comments'), joins: n('joins'), gifts: n('gifts'), diamonds: n('diamonds') };
  if (typeof r.hostUniqueId === 'string' && r.hostUniqueId) s.hostUniqueId = r.hostUniqueId;
  if (typeof r.hostNickname === 'string' && r.hostNickname) s.hostNickname = r.hostNickname;
  return s;
}
