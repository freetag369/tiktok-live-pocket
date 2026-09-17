import { describe, expect, it } from 'vitest';
import { applyRowToStream, filterArchiveRows, sanitizeArchivedRow, sanitizeStream, streamFileStem, streamsToPrune, type StreamRecord } from '../src/lib/archive';
import type { FeedRow } from '../src/lib/feed';
import { dateRange } from '../src/lib/format';

const T = 1_785_240_000_000;
const host = { hostUniqueId: 'metafact8', hostNickname: 'めた' };

const comment: FeedRow = { k: 'comment', id: 'c1', tsMs: T + 5000, viewer: { userId: 'u1', nickname: 'ゆな', uniqueId: 'yuna' }, text: 'こんばんは', visits: 2, firstEver: false };
const join: FeedRow = { k: 'join', id: 'j1', tsMs: T, viewer: { userId: 'u2', nickname: 'たろう' }, visits: 1, firstEver: true };
const follow: FeedRow = { k: 'social', id: 's1', tsMs: T + 1000, viewer: { userId: 'u2', nickname: 'たろう' }, sub: 'follow', visits: 1, firstEver: true };
const gift: FeedRow = { k: 'gift', id: 'g1', tsMs: T + 2000, viewer: { userId: 'u3', nickname: 'ハナ' }, giftId: '5655', giftName: 'Rose', count: 3, diamondEach: 1, diamonds: 3, streaking: true, visits: 5, firstEver: false };

describe('applyRowToStream', () => {
  it('新規行で件数と期間が伸びる。フォローは rows だけ', () => {
    let s = applyRowToStream(undefined, undefined, comment, host, 'r1');
    expect(s).toMatchObject({ roomId: 'r1', hostUniqueId: 'metafact8', hostNickname: 'めた', startedMs: T + 5000, endedMs: T + 5000, rows: 1, comments: 1, joins: 0, gifts: 0, diamonds: 0 });
    s = applyRowToStream(s, undefined, join, {}, 'r1');
    s = applyRowToStream(s, undefined, follow, {}, 'r1');
    s = applyRowToStream(s, undefined, gift, {}, 'r1');
    expect(s).toMatchObject({ startedMs: T, endedMs: T + 5000, rows: 4, comments: 1, joins: 1, gifts: 1, diamonds: 3, hostUniqueId: 'metafact8' });
  });

  it('連打の更新(prev あり)は💎の差分だけ足し、件数は増えない', () => {
    let s = applyRowToStream(undefined, undefined, gift, host, 'r1');
    const more: FeedRow = { ...gift, count: 10, diamonds: 10, streaking: false, tsMs: T + 9000 };
    s = applyRowToStream(s, gift, more, host, 'r1');
    expect(s).toMatchObject({ rows: 1, gifts: 1, diamonds: 10, endedMs: T + 9000 });
    // 同じ行をもう一度(再送・再取り込み)保存しても変わらない
    expect(applyRowToStream(s, more, more, host, 'r1')).toEqual(s);
  });
});

describe('filterArchiveRows', () => {
  const rows = [join, follow, gift, comment];
  it('タブで絞る', () => {
    expect(filterArchiveRows(rows, 'all', '').map((r) => r.id)).toEqual(['j1', 's1', 'g1', 'c1']);
    expect(filterArchiveRows(rows, 'join', '').map((r) => r.id)).toEqual(['j1', 's1']);
    expect(filterArchiveRows(rows, 'gift', '').map((r) => r.id)).toEqual(['g1']);
  });
  it('名前・@ハンドル・本文・ギフト名で大文字小文字を無視して部分一致', () => {
    expect(filterArchiveRows(rows, 'all', 'たろう').map((r) => r.id)).toEqual(['j1', 's1']);
    expect(filterArchiveRows(rows, 'all', 'YUNA').map((r) => r.id)).toEqual(['c1']);
    expect(filterArchiveRows(rows, 'all', 'ばんは').map((r) => r.id)).toEqual(['c1']);
    expect(filterArchiveRows(rows, 'all', 'rose').map((r) => r.id)).toEqual(['g1']);
    expect(filterArchiveRows(rows, 'comment', 'rose')).toEqual([]);
    expect(filterArchiveRows(rows, 'all', '  ')).toHaveLength(4);
  });
});

describe('streamsToPrune', () => {
  const st = (roomId: string, startedMs: number): StreamRecord => ({ roomId, startedMs, endedMs: startedMs, rows: 0, comments: 0, joins: 0, gifts: 0, diamonds: 0 });
  const streams = [st('a', T + 1), st('b', T + 3), st('c', T + 2), st('d', T)];
  it('新しい順に keep 件を残し、古い方の roomId を返す', () => {
    expect(streamsToPrune(streams, 2)).toEqual(['a', 'd']);
    expect(streamsToPrune(streams, 10)).toEqual([]);
  });
  it('受信中の部屋は数に入れず、消さない', () => {
    expect(streamsToPrune(streams, 2, 'b')).toEqual(['d']);
    expect(streamsToPrune(streams, 1, 'd')).toEqual(['c', 'a']);
  });
});

describe('streamFileStem / dateRange', () => {
  it('ファイル名は host と開始日時。使えない文字は _', () => {
    const s: StreamRecord = { roomId: 'r', startedMs: new Date(2026, 8, 15, 1, 30).getTime(), endedMs: 0, rows: 0, comments: 0, joins: 0, gifts: 0, diamonds: 0 };
    expect(streamFileStem(s, 'fallback')).toBe('live-log-fallback-20260915-0130');
    expect(streamFileStem({ ...s, hostUniqueId: 'a b/c' }, '')).toBe('live-log-a_b_c-20260915-0130');
  });
  it('同じ日は時刻だけ、日をまたげば日付も', () => {
    const a = new Date(2026, 8, 15, 21, 3).getTime();
    expect(dateRange(a, a + 2 * 3600_000 + 37 * 60_000)).toBe('2026/9/15 21:03〜23:40');
    expect(dateRange(a, a + 4 * 3600_000)).toBe('2026/9/15 21:03〜9/16 01:03');
    expect(dateRange(a, a)).toBe('2026/9/15 21:03');
  });
});

describe('sanitize (バックアップ取り込み)', () => {
  it('行: 種別ごとに必要な項目を検証し、壊れた行は null', () => {
    expect(sanitizeArchivedRow({ ...comment, roomId: 'r1' })).toEqual({ ...comment, roomId: 'r1' });
    expect(sanitizeArchivedRow({ ...gift, roomId: 'r1', iconUrl: 'javascript:x' })).toMatchObject({ k: 'gift', streaking: false, count: 3, diamonds: 3 });
    expect(sanitizeArchivedRow({ ...gift, roomId: 'r1', iconUrl: 'javascript:x' })).not.toHaveProperty('iconUrl');
    expect(sanitizeArchivedRow({ ...comment, roomId: '' })).toBeNull();
    expect(sanitizeArchivedRow({ ...comment, roomId: 'r1', viewer: {} })).toBeNull();
    expect(sanitizeArchivedRow({ ...comment, roomId: 'r1', k: 'like' })).toBeNull();
    expect(sanitizeArchivedRow({ ...comment, roomId: 'r1', tsMs: 'x' })).toBeNull();
    expect(sanitizeArchivedRow(null)).toBeNull();
  });
  it('配信: 数値は丸め、host は文字列のときだけ', () => {
    expect(sanitizeStream({ roomId: 'r1', startedMs: T, comments: '3', diamonds: -1, hostUniqueId: 5 })).toEqual({ roomId: 'r1', startedMs: T, endedMs: T, rows: 0, comments: 3, joins: 0, gifts: 0, diamonds: 0 });
    expect(sanitizeStream({ startedMs: T })).toBeNull();
  });
});
