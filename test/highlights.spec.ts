import { describe, expect, it } from 'vitest';
import { dayRange, highlightMembers, japanDay, mergeDayRows } from '../src/lib/highlights';
import { sanitizeArchivedRow, type ArchivedRow } from '../src/lib/archive';
import { feedToCsv, feedToJson, buildBackup, parseBackup } from '../src/lib/backup';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { applyEvent, createFeedState } from '../src/lib/feed';
import type { GiftEvent } from '../src/lib/events';

const day = '2026-09-23';
const [start, end] = dayRange(day);
const base = { id: '1', roomId: 'r1', tsMs: start, viewer: { userId: 'a' }, visits: 1, firstEver: true };
const comment: ArchivedRow = { ...base, k: 'comment', text: 'こんにちは' };
const like: ArchivedRow = { ...base, id: '2', k: 'like', count: 8 };
const gift: ArchivedRow = { ...base, id: '3', k: 'gift', giftId: '5655', giftName: 'Rose', count: 5, diamondEach: 1, diamonds: 5, streaking: false };
const follow: ArchivedRow = { ...base, id: '4', k: 'social', sub: 'follow' };

describe('highlights', () => {
  it('日本時間の日付境界は開始を含み翌日を含まない', () => {
    expect(japanDay(start - 1)).toBe('2026-09-22');
    expect(japanDay(start)).toBe(day);
    expect(japanDay(end)).toBe('2026-09-24');
    const rows = [start - 1, start, end - 1, end].map((tsMs, i) => ({ ...comment, id: String(i), tsMs }));
    expect(mergeDayRows(day, rows, []).map(r => r.tsMs)).toEqual([end - 1, start]);
  });

  it('4種類を集計し入室・シェアだけの人は含めない', () => {
    const rows: ArchivedRow[] = [comment, like, gift, follow,
      { ...base, id: 'join', viewer: { userId: 'join-only' }, k: 'join' },
      { ...follow, id: 'share', viewer: { userId: 'share-only' }, sub: 'share' }];
    expect(highlightMembers(rows)).toMatchObject([{ comments: 1, likes: 8, gifts: 5, follows: 1 }]);
    for (const row of [comment, like, gift, follow]) expect(highlightMembers([row])).toHaveLength(1);
  });

  it('同日の複数配信をまとめ最新順、保存とメモリの重複は上書き', () => {
    const updated = { ...gift, count: 9, diamonds: 9, tsMs: start + 50 };
    const rows = mergeDayRows(day, [comment, gift], [updated,
      { ...comment, roomId: 'r2' }, { ...like, viewer: { userId: 'b' }, tsMs: start + 100 }]);
    expect(highlightMembers(rows).map(m => m.row.viewer.userId)).toEqual(['b', 'a']);
    expect(highlightMembers(rows)[1]).toMatchObject({ comments: 2, gifts: 9 });
    expect(mergeDayRows(day, [gift], [{ ...updated, tsMs: end }])).toEqual([]);
  });

  it('いいねをバックアップ・CSV・JSONで往復でき、旧形式も読める', () => {
    expect(sanitizeArchivedRow(like)).toEqual(like);
    expect(sanitizeArchivedRow({ ...like, count: -1 })).toBeNull();
    const backup = buildBackup({ settings: DEFAULT_SETTINGS, visits: [], gifts: [], includeApiKey: false, appVersion: 'test', archive: { streams: [], rows: [like] } });
    expect(parseBackup(JSON.stringify(backup)).archive?.rows).toEqual([like]);
    delete backup.archive;
    expect(parseBackup(JSON.stringify(backup)).archive).toBeNull();
    expect(feedToCsv([like])).toContain('いいね');
    expect(JSON.parse(feedToJson([like], { roomId: 'r1' })).items[0]).toMatchObject({ kind: 'like', count: 8 });
  });

  it('通常フィードにいいねを追加せず記録し、再送は無視する', () => {
    const e = { kind: 'like' as const, msgId: 'like', tsMs: start, viewer: base.viewer, count: 5 };
    const state = applyEvent(createFeedState(), e, base);
    expect(state.rows).toEqual([]);
    expect(state.lastTouched).toMatchObject({ k: 'like', count: 5 });
    expect(applyEvent(state, e, base)).toBe(state);
  });

  it('500行を超えて表示から消えた連続ギフトも更新する', () => {
    const event: GiftEvent = { kind: 'gift', msgId: 'g1', tsMs: start, viewer: base.viewer, giftId: '5655', giftName: 'Rose', giftType: 1, repeatCount: 1, streaking: true, diamondEach: 1, groupId: 'combo' };
    let state = applyEvent(createFeedState(), event, base);
    for (let i = 0; i < 501; i++) state = applyEvent(state, { kind: 'comment', msgId: `c${i}`, tsMs: start, viewer: base.viewer, content: 'x' }, base);
    state = applyEvent(state, { ...event, msgId: 'g2', repeatCount: 10, streaking: false }, base);
    expect(state.lastTouched).toMatchObject({ id: 'g1', count: 10, diamonds: 10 });
    expect(state.diamonds).toBe(10);
  });
});
