import type { GiftCatalogRecord } from './db';
import type { FeedRow } from './feed';
import { sanitize, type Settings } from './settings';
import { sanitizeRecord, type VisitRecord } from './visits';
import { sanitizeMemo, type MemoRecord } from './memos';

/**
 * バックアップ(来店履歴 + ギフトカタログ + リスナーメモ + 設定)と、配信ログ(画面の行)の書き出し。
 * 形式はどちらも人が読める JSON / CSV。API キーは明示したときだけ含める。
 * `memos` は後から足した項目(省略可)。version 1 のまま読み書きできる。
 */

export const BACKUP_FORMAT = 'tiktok-live-pocket-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  settings: Omit<Settings, 'eulerApiKey'> & { eulerApiKey?: string };
  visits: VisitRecord[];
  gifts: GiftCatalogRecord[];
  memos?: MemoRecord[];
}

export function buildBackup(o: { settings: Settings; visits: VisitRecord[]; gifts: GiftCatalogRecord[]; memos?: MemoRecord[]; includeApiKey: boolean; appVersion: string; now?: Date }): Backup {
  const { eulerApiKey, ...rest } = o.settings;
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: (o.now ?? new Date()).toISOString(),
    appVersion: o.appVersion,
    settings: o.includeApiKey && eulerApiKey ? { ...rest, eulerApiKey } : rest,
    visits: o.visits,
    gifts: o.gifts,
    memos: o.memos ?? [],
  };
}

export interface ParsedBackup {
  settings: Partial<Settings> | null;
  visits: VisitRecord[];
  gifts: GiftCatalogRecord[];
  memos: MemoRecord[];
  exportedAt: string;
}

/** バックアップ JSON を検証して読み込む。形式が違えば Error。 */
export function parseBackup(text: string): ParsedBackup {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('JSON として読めません');
  }
  if (!j || typeof j !== 'object') throw new Error('バックアップの形式ではありません');
  const b = j as Record<string, unknown>;
  if (b.format !== BACKUP_FORMAT) throw new Error('このアプリのバックアップではありません');
  if (Number(b.version) > BACKUP_VERSION) throw new Error('新しいバージョンのバックアップです。アプリを更新してください');
  const visits = Array.isArray(b.visits) ? (b.visits.map(sanitizeRecord).filter(Boolean) as VisitRecord[]) : [];
  const gifts = Array.isArray(b.gifts) ? (b.gifts.filter((g) => g && typeof g === 'object' && typeof (g as GiftCatalogRecord).giftId === 'string') as GiftCatalogRecord[]) : [];
  const memos = Array.isArray(b.memos) ? (b.memos.map(sanitizeMemo).filter(Boolean) as MemoRecord[]) : [];
  const settings = b.settings && typeof b.settings === 'object' ? (b.settings as Partial<Settings>) : null;
  return { settings, visits, gifts, memos, exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '' };
}

/** バックアップの設定を、いまの設定に重ねる(キーは入っていれば上書き、無ければ現状維持)。 */
export function applyBackupSettings(current: Settings, incoming: Partial<Settings> | null): Settings {
  if (!incoming) return current;
  const next: Record<string, unknown> = { ...current };
  for (const k of ['hostUniqueId', 'eulerApiKey', 'showAvatars', 'fontSize', 'bigGiftDiamonds', 'wakeLock', 'wsUrl'] as const) {
    const v = incoming[k];
    if (v === undefined || v === null) continue;
    next[k] = v;
  }
  return sanitize(next as unknown as Settings);
}

// ── 配信ログ ──────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function localIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  // 先頭が = + - @ のセルは表計算ソフトで数式扱いされるので守る。
  const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export const LOG_CSV_HEADER = ['時刻', '種別', '名前', 'ハンドル', '内容', 'ギフトID', '個数', 'ダイヤ', '来店回数', '初見'] as const;

export function rowToCsvFields(r: FeedRow): string[] {
  const base = [localIso(r.tsMs)];
  const who = [r.viewer.nickname ?? '', r.viewer.uniqueId ? `@${r.viewer.uniqueId}` : ''];
  const tail = [String(r.visits), r.firstEver ? '1' : '0'];
  switch (r.k) {
    case 'comment':
      return [...base, 'コメント', ...who, r.text, '', '', '', ...tail];
    case 'join':
      return [...base, '入室', ...who, '', '', '', '', ...tail];
    case 'social':
      return [...base, r.sub === 'follow' ? 'フォロー' : 'シェア', ...who, '', '', '', '', ...tail];
    case 'gift':
      return [...base, 'ギフト', ...who, r.giftName, r.giftId, String(r.count), String(r.diamonds), ...tail];
  }
}

/** Excel で文字化けしないよう BOM 付き UTF-8、改行は CRLF。 */
export function feedToCsv(rows: FeedRow[]): string {
  const lines = [LOG_CSV_HEADER.map(csvCell).join(',')];
  for (const r of rows) lines.push(rowToCsvFields(r).map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function feedToJson(rows: FeedRow[], meta: { roomId: string; host?: string; exportedAt?: Date }): string {
  const items = rows.map((r) => {
    const common = { at: localIso(r.tsMs), tsMs: r.tsMs, userId: r.viewer.userId, nickname: r.viewer.nickname ?? '', uniqueId: r.viewer.uniqueId ?? '', visits: r.visits, firstEver: r.firstEver };
    switch (r.k) {
      case 'comment':
        return { kind: 'comment', ...common, text: r.text };
      case 'join':
        return { kind: 'join', ...common };
      case 'social':
        return { kind: r.sub, ...common };
      case 'gift':
        return { kind: 'gift', ...common, giftId: r.giftId, giftName: r.giftName, count: r.count, diamondEach: r.diamondEach, diamonds: r.diamonds, iconUrl: r.iconUrl ?? '' };
    }
  });
  return JSON.stringify({ format: 'tiktok-live-pocket-log', version: 1, exportedAt: (meta.exportedAt ?? new Date()).toISOString(), roomId: meta.roomId, host: meta.host ?? '', count: items.length, items }, null, 1);
}

/** ファイル名用の日時 `20260915-0130`。 */
export function stamp(d = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
