import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BoundedSet,
  HighlightDay,
  LIKE_BUCKET_MS,
  addLike,
  dayRange,
  highlightMembers,
  japanDay,
  japanDayLabel,
  japanTime,
  likeBucketStart,
  likeRowId,
  mergeDayRows,
  pickHighlightDay,
  watchJapanDay,
} from '../src/lib/highlights';
import { applyRowToStream, filterArchiveRows, sanitizeArchivedRow, type ArchivedRow } from '../src/lib/archive';
import { buildBackup, feedToCsv, feedToJson, parseBackup } from '../src/lib/backup';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { applyEvent, createFeedState } from '../src/lib/feed';
import type { GiftEvent } from '../src/lib/events';

const day = '2026-09-23';
const [start, end] = dayRange(day);
const base = { id: '1', roomId: 'r1', tsMs: start, viewer: { userId: 'a' }, visits: 1, firstEver: true };
const comment: ArchivedRow = { ...base, k: 'comment', text: 'こんにちは' };
const like: ArchivedRow = { ...base, id: likeRowId('r1', 'a', start), k: 'like', count: 8 };
const gift: ArchivedRow = { ...base, id: '3', k: 'gift', giftId: '5655', giftName: 'Rose', count: 5, diamondEach: 1, diamonds: 5, streaking: false };
const follow: ArchivedRow = { ...base, id: '4', k: 'social', sub: 'follow' };

describe('日付(日本時間)', () => {
  it('日本時間の日付境界は開始を含み翌日を含まない', () => {
    expect(start).toBe(Date.parse('2026-09-22T15:00:00Z'));
    expect(japanDay(start - 1)).toBe('2026-09-22');
    expect(japanDay(start)).toBe(day);
    expect(japanDay(end)).toBe('2026-09-24');
    expect(japanTime(start + 3723_000)).toBe('01:02:03');
    expect(japanDayLabel(day)).toBe('9/23(水)');
    const rows = [start - 1, start, end - 1, end].map((tsMs, i) => ({ ...comment, id: String(i), tsMs }));
    expect(mergeDayRows(day, rows, []).map((r) => r.tsMs)).toEqual([end - 1, start]);
  });

  it('読めない日付は範囲にならない', () => {
    expect(Number.isNaN(dayRange('')[0])).toBe(true);
    expect(Number.isNaN(dayRange('2026-9-1')[0])).toBe(true);
    expect(mergeDayRows('', [comment], [comment])).toEqual([]);
  });

  it('今日を選ぶと「今日を追う」に戻り、空欄は選択を変えない', () => {
    expect(pickHighlightDay('2026-09-20', day, null)).toBe('2026-09-20');
    expect(pickHighlightDay(day, day, '2026-09-20')).toBeNull();
    expect(pickHighlightDay('', day, '2026-09-20')).toBe('2026-09-20');
    expect(pickHighlightDay('', day, null)).toBeNull();
  });
});

describe('0 時をまたいだら今日を追う', () => {
  afterEach(() => vi.useRealTimers());

  it('日本時間の 0 時を過ぎると次の日を知らせ、選んだ日はそのまま', () => {
    vi.useFakeTimers();
    vi.setSystemTime(end - 20_000); // 9/23 23:59:40(日本時間)
    const seen: string[] = [];
    const stop = watchJapanDay((d) => seen.push(d), 15_000);
    vi.advanceTimersByTime(15_000);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(15_000);
    expect(seen).toEqual(['2026-09-24']);
    vi.advanceTimersByTime(60_000);
    expect(seen).toEqual(['2026-09-24']);
    stop();

    // 画面側: 選んでいなければ今日(= 新しい日)、選んでいればその日のまま
    const shownDay = (picked: string | null, today: string) => picked ?? today;
    expect(shownDay(null, seen[0]!)).toBe('2026-09-24');
    expect(shownDay(pickHighlightDay('2026-09-20', day, null), seen[0]!)).toBe('2026-09-20');
    expect(shownDay(pickHighlightDay(day, day, null), seen[0]!)).toBe('2026-09-24');
  });

  it('解除したら知らせない', () => {
    vi.useFakeTimers();
    vi.setSystemTime(end - 1000);
    const fn = vi.fn();
    const stop = watchJapanDay(fn, 1000);
    stop();
    vi.advanceTimersByTime(10_000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('メンバー集計', () => {
  it('4 種類を集計し、入室・シェアだけの人は含めない', () => {
    const rows: ArchivedRow[] = [
      comment,
      like,
      gift,
      follow,
      { ...base, id: 'join', viewer: { userId: 'join-only' }, k: 'join' },
      { ...follow, id: 'share', viewer: { userId: 'share-only' }, sub: 'share' },
    ];
    expect(highlightMembers(mergeDayRows(day, rows, []))).toMatchObject([{ comments: 1, likes: 8, gifts: 5, follows: 1 }]);
    for (const row of [comment, like, gift, follow]) expect(highlightMembers([row])).toHaveLength(1);
  });

  it('同日の複数配信をまとめて最新順。ギフトは受信中の値で置き換え、いいねは足す', () => {
    const updated: ArchivedRow = { ...gift, count: 9, diamonds: 9, tsMs: start + 50 };
    const liveLike: ArchivedRow = { ...like, count: 3, tsMs: start + 30 };
    const rows = mergeDayRows(day, [comment, gift, like], [updated, liveLike, { ...comment, roomId: 'r2' }, { ...comment, id: 'b1', viewer: { userId: 'b' }, tsMs: start + 100 }]);
    const members = highlightMembers(rows);
    expect(members.map((m) => m.row.viewer.userId)).toEqual(['b', 'a']);
    expect(members[1]).toMatchObject({ comments: 2, gifts: 9, likes: 11 });
    // 連打の更新で翌日に動いたギフトはこの日から外れる
    expect(mergeDayRows(day, [gift], [{ ...updated, tsMs: end }])).toEqual([]);
  });

  it('HighlightDay は変わらなければ同じ配列を返す', () => {
    const view = new HighlightDay(day);
    view.putSaved([comment]);
    const a = view.list();
    expect(view.list()).toBe(a);
    view.applyLive({ ...comment, id: 'c2', tsMs: start + 1 });
    expect(view.list()).not.toBe(a);
    expect(view.list().map((r) => r.id)).toEqual(['c2', '1']);
  });
});

describe('いいねの行(1 分ごとにまとめる)', () => {
  it('行 id は配信・人・分の頭で決まり、日本時間の 0 時をまたがない', () => {
    expect(likeBucketStart(start + 59_999)).toBe(start);
    expect(likeBucketStart(start + 60_000)).toBe(start + LIKE_BUCKET_MS);
    expect(likeBucketStart(end - 1)).toBeGreaterThanOrEqual(end - LIKE_BUCKET_MS);
    expect(japanDay(likeBucketStart(end - 1))).toBe(day);
    expect(likeRowId('r1', 'u1', start)).toBe(`like:r1:u1:${start}`);
  });

  it('足すと数は合計・時刻は新しい方', () => {
    const a = { ...like, count: 2, tsMs: start + 10 } as Extract<ArchivedRow, { k: 'like' }>;
    const b = { ...like, count: 5, tsMs: start + 5, viewer: { userId: 'a', nickname: '新しい名前' } } as Extract<ArchivedRow, { k: 'like' }>;
    expect(addLike(a, b)).toMatchObject({ count: 7, tsMs: start + 10, viewer: { nickname: '新しい名前' } });
    expect(addLike(undefined, b)).toBe(b);
  });

  it('同じ行を上書きしても配信の集計は増えない(rows は最初の 1 回だけ)', () => {
    let s = applyRowToStream(undefined, undefined, like, {}, 'r1');
    expect(s).toMatchObject({ rows: 1, comments: 0, joins: 0, gifts: 0, diamonds: 0 });
    const more: ArchivedRow = { ...like, count: 20, tsMs: start + 40_000 };
    s = applyRowToStream(s, like, more, {}, 'r1');
    s = applyRowToStream(s, more, more, {}, 'r1');
    expect(s).toMatchObject({ rows: 1, comments: 0, gifts: 0, diamonds: 0, endedMs: start + 40_000 });
  });

  it('アーカイブの「すべて」には出て、ほかのタブには出ない', () => {
    expect(filterArchiveRows([comment, like], 'all', '').map((r) => r.k)).toEqual(['comment', 'like']);
    expect(filterArchiveRows([comment, like], 'comment', '').map((r) => r.k)).toEqual(['comment']);
    expect(filterArchiveRows([like], 'join', '')).toEqual([]);
  });

  it('いいねをバックアップ・CSV・JSON で往復でき、旧形式も読める', () => {
    expect(sanitizeArchivedRow(like)).toEqual(like);
    expect(sanitizeArchivedRow({ ...like, count: -1 })).toBeNull();
    expect(sanitizeArchivedRow({ ...like, count: 'x' })).toBeNull();
    const backup = buildBackup({ settings: DEFAULT_SETTINGS, visits: [], gifts: [], includeApiKey: false, appVersion: 'test', archive: { streams: [], rows: [like] } });
    expect(parseBackup(JSON.stringify(backup)).archive?.rows).toEqual([like]);
    delete backup.archive;
    expect(parseBackup(JSON.stringify(backup)).archive).toBeNull();
    expect(feedToCsv([like])).toContain('いいね');
    expect(JSON.parse(feedToJson([like], { roomId: 'r1' })).items[0]).toMatchObject({ kind: 'like', count: 8 });
  });
});

describe('フィード(いいねは行にしない)', () => {
  it('通常フィードにいいねを追加せず集計だけ。再送は無視する', () => {
    const e = { kind: 'like' as const, msgId: 'like', tsMs: start, viewer: base.viewer, count: 5 };
    const state = applyEvent(createFeedState(), e, base);
    expect(state.rows).toEqual([]);
    expect(state.lastTouched).toBeNull();
    expect(state.likeCount).toBe(5);
    expect(applyEvent(state, e, base)).toBe(state);
  });

  it('コメントが 500 行を超えても連続ギフトの行を更新する', () => {
    const event: GiftEvent = { kind: 'gift', msgId: 'g1', tsMs: start, viewer: base.viewer, giftId: '5655', giftName: 'Rose', giftType: 1, repeatCount: 1, streaking: true, diamondEach: 1, groupId: 'combo' };
    let state = applyEvent(createFeedState(), event, base);
    for (let i = 0; i < 501; i++) state = applyEvent(state, { kind: 'comment', msgId: `c${i}`, tsMs: start, viewer: base.viewer, content: 'x' }, base);
    state = applyEvent(state, { ...event, msgId: 'g2', repeatCount: 10, streaking: false }, base);
    expect(state.lastTouched).toMatchObject({ id: 'g1', count: 10, diamonds: 10 });
    expect(state.diamonds).toBe(10);
  });
});

describe('BoundedSet(上限つきの重複表)', () => {
  it('上限を超えたら古い方から捨て、大きくならない', () => {
    const s = new BoundedSet(3);
    expect(s.add('a')).toBe(true);
    expect(s.add('a')).toBe(false);
    s.add('b');
    s.add('c');
    s.add('d');
    expect(s.size).toBe(3);
    expect(s.has('a')).toBe(false);
    expect(s.has('d')).toBe(true);
    for (let i = 0; i < 10_000; i++) s.add(`k${i}`);
    expect(s.size).toBe(3);
    s.clear();
    expect(s.size).toBe(0);
  });
});
