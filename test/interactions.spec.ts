import { describe, expect, it } from 'vitest';
import { buildInteractions, currentRoomRows, filterInteractions, mergeRows, sheetItems, sortInteractions, type Interaction } from '../src/lib/interactions';
import type { FeedItem, FeedRow, RoomMark } from '../src/lib/feed';
import type { LikeEntry } from '../src/lib/likes';
import type { MemoRecord } from '../src/lib/memos';

const T = 1_785_240_000_000;

const comment = (id: string, userId: string, tsMs: number, nickname = `n${userId}`, text = 'こんばんは'): FeedRow => ({ k: 'comment', id, tsMs, viewer: { userId, nickname }, text, visits: 2, firstEver: false });
const join = (id: string, userId: string, tsMs: number): FeedRow => ({ k: 'join', id, tsMs, viewer: { userId, nickname: `n${userId}` }, visits: 1, firstEver: true });
const follow = (id: string, userId: string, tsMs: number): FeedRow => ({ k: 'social', id, tsMs, viewer: { userId, nickname: `n${userId}` }, sub: 'follow', visits: 1, firstEver: true });
const gift = (id: string, userId: string, tsMs: number, count: number, streaking = false): FeedRow => ({ k: 'gift', id, tsMs, viewer: { userId, nickname: `n${userId}` }, giftId: '5655', giftName: 'Rose', count, diamondEach: 1, diamonds: count, streaking, visits: 5, firstEver: false });
const mark = (id: string, tsMs: number): RoomMark => ({ k: 'room', id, tsMs, roomId: `r-${id}` });
const like = (userId: string, taps: number, lastMs: number, nickname = `n${userId}`): [string, LikeEntry] => [userId, { userId, viewer: { userId, nickname }, taps, burst: taps, lastMs, visits: 3, firstEver: false }];

describe('currentRoomRows', () => {
  it('区切りが無ければ全行', () => {
    const items: FeedItem[] = [join('j1', 'a', T), comment('c1', 'a', T + 1)];
    expect(currentRoomRows(items).map((r) => r.id)).toEqual(['j1', 'c1']);
  });
  it('最後の区切り以降だけ。区切りが末尾なら空', () => {
    const items: FeedItem[] = [comment('c0', 'a', T - 100), mark('m1', T - 50), comment('c1', 'a', T), mark('m2', T + 10), comment('c2', 'b', T + 20)];
    expect(currentRoomRows(items).map((r) => r.id)).toEqual(['c2']);
    expect(currentRoomRows([comment('c0', 'a', T), mark('m1', T + 1)])).toEqual([]);
  });
});

describe('mergeRows', () => {
  it('同じ id は画面側を採用し、アーカイブだけの行も残して tsMs 順', () => {
    const archived = [gift('g1', 'a', T, 3), join('j0', 'b', T - 500)];
    const live = [gift('g1', 'a', T + 5000, 10, true), comment('c1', 'a', T + 100)];
    const out = mergeRows(archived, live);
    expect(out.map((r) => r.id)).toEqual(['j0', 'c1', 'g1']);
    expect(out[2]).toMatchObject({ count: 10, streaking: true });
  });
  it('アーカイブが空でも並べ替える', () => {
    expect(mergeRows([], [comment('c2', 'a', T + 1), comment('c1', 'a', T)]).map((r) => r.id)).toEqual(['c1', 'c2']);
  });
});

describe('buildInteractions', () => {
  it('コメント・ギフト・いいねのある人だけ。入室・フォローだけの人は出ない', () => {
    const rows = [join('j1', 'a', T), comment('c1', 'a', T + 10), join('j2', 'b', T + 20), follow('s1', 'c', T + 30), gift('g1', 'd', T + 40, 2)];
    const likes = new Map<string, LikeEntry>([like('e', 7, T + 50)]);
    const out = buildInteractions(rows, likes);
    expect(out.map((i) => i.userId).sort()).toEqual(['a', 'd', 'e']);
    const a = out.find((i) => i.userId === 'a')!;
    expect(a).toMatchObject({ comments: 1, joins: 1, gifts: 0, likes: 0, lastMs: T + 10 });
    expect(a.rows.map((r) => r.id)).toEqual(['j1', 'c1']);
    const e = out.find((i) => i.userId === 'e')!;
    expect(e).toMatchObject({ likes: 7, likeLastMs: T + 50, lastMs: T + 50, rows: [], visits: 3 });
  });

  it('💎 は合算、フォローは follows、名前は一番新しい行のもの', () => {
    const rows = [gift('g1', 'a', T, 3), follow('s1', 'a', T + 1), comment('c1', 'a', T + 2, '新しい名前'), gift('g2', 'a', T + 3, 5)];
    const [a] = buildInteractions(rows, new Map());
    expect(a).toMatchObject({ gifts: 2, diamonds: 8, follows: 1, comments: 1, lastMs: T + 3 });
    // g2 が最後なので viewer は g2 のもの(nickname 'na')。順を入れ替えると名前が変わる。
    expect(a!.viewer.nickname).toBe('na');
    const [b] = buildInteractions([gift('g1', 'a', T, 1), comment('c1', 'a', T + 5, '新しい名前')], new Map());
    expect(b!.viewer.nickname).toBe('新しい名前');
  });

  it('いいねの方が新しければ lastMs と名前はいいねのもの。行の順は入力順に依らない', () => {
    const rows = [comment('c2', 'a', T + 20), comment('c1', 'a', T + 10)];
    const likes = new Map<string, LikeEntry>([like('a', 4, T + 30, 'いいね名')]);
    const [a] = buildInteractions(rows, likes);
    expect(a).toMatchObject({ comments: 2, likes: 4, lastMs: T + 30, viewer: { nickname: 'いいね名' } });
    expect(a!.rows.map((r) => r.id)).toEqual(['c1', 'c2']);
    // いいねが古ければ行の名前のまま
    const [b] = buildInteractions(rows, new Map([like('a', 4, T, 'いいね名')]));
    expect(b).toMatchObject({ lastMs: T + 20, viewer: { nickname: 'na' } });
  });

  it('taps 0 のいいねは数えない', () => {
    expect(buildInteractions([], new Map([like('a', 0, T)]))).toEqual([]);
  });
});

function it0(userId: string, o: Partial<Interaction>): Interaction {
  return { userId, viewer: { userId }, comments: 0, gifts: 0, diamonds: 0, joins: 0, follows: 0, likes: 0, lastMs: T, visits: 1, firstEver: false, rows: [], ...o };
}

describe('sortInteractions', () => {
  const list = [it0('a', { lastMs: T + 1, diamonds: 0, comments: 3 }), it0('b', { lastMs: T + 3, diamonds: 10 }), it0('c', { lastMs: T + 2, diamonds: 10, comments: 1 }), it0('d', { lastMs: T + 1, likes: 9 })];
  it('recent は新しい順、同時刻は userId 順', () => {
    expect(sortInteractions(list, 'recent').map((i) => i.userId)).toEqual(['b', 'c', 'a', 'd']);
  });
  it('most は 💎 → コメント → いいね → 新しい順', () => {
    expect(sortInteractions(list, 'most').map((i) => i.userId)).toEqual(['c', 'b', 'a', 'd']);
  });
  it('元の配列は変えない', () => {
    const before = list.map((i) => i.userId);
    sortInteractions(list, 'most');
    expect(list.map((i) => i.userId)).toEqual(before);
  });
});

describe('filterInteractions', () => {
  const list = [it0('a', { viewer: { userId: 'a', nickname: 'ゆな', uniqueId: 'Yuna.x' } }), it0('b', { viewer: { userId: 'b', nickname: 'たろう' } }), it0('c', { viewer: { userId: 'c' } })];
  const memos = new Map<string, MemoRecord>([
    ['b', { userId: 'b', note: 'ゲームの話が好き', kana: 'たろー', updatedMs: T }],
    ['c', { userId: 'c', note: '', kana: 'はな', updatedMs: T, nickname: 'ハナ' }],
  ]);
  it('名前・@・メモ本文・かな・メモの名前スナップショットで大文字小文字を無視して部分一致', () => {
    expect(filterInteractions(list, 'yuna', memos).map((i) => i.userId)).toEqual(['a']);
    expect(filterInteractions(list, 'ゲーム', memos).map((i) => i.userId)).toEqual(['b']);
    expect(filterInteractions(list, 'たろー', memos).map((i) => i.userId)).toEqual(['b']);
    expect(filterInteractions(list, 'ハナ', memos).map((i) => i.userId)).toEqual(['c']);
    expect(filterInteractions(list, 'いない', memos)).toEqual([]);
  });
  it('空白だけなら全件(同じ配列)', () => {
    expect(filterInteractions(list, '  ', memos)).toBe(list);
  });
});

describe('sheetItems', () => {
  const likeRow = (id: string, userId: string, tsMs: number, count: number): FeedRow => ({ k: 'like', id, tsMs, viewer: { userId, nickname: `n${userId}` }, count, visits: 3, firstEver: false });
  const base = (rows: FeedRow[], likes = 0, likeLastMs?: number): Interaction => ({ userId: 'a', viewer: { userId: 'a', nickname: 'na' }, comments: 1, gifts: 0, diamonds: 0, joins: 0, follows: 0, likes, lastMs: T, likeLastMs, visits: 3, firstEver: false, rows });

  it('1 分ごとのいいね行を 1 本にまとめ、最後のいいねの位置に置く', () => {
    const rows = [comment('c1', 'a', T), likeRow('l1', 'a', T + 60_000, 12), comment('c2', 'a', T + 90_000), likeRow('l2', 'a', T + 120_000, 30), comment('c3', 'a', T + 200_000)];
    const items = sheetItems(base(rows, 42, T + 125_000));
    expect(items.map((r) => (r.k === 'like-summary' ? 'LIKES' : r.id))).toEqual(['c1', 'c2', 'LIKES', 'c3']);
    const sum = items[2]!;
    expect(sum).toEqual({ k: 'like-summary', count: 42, firstMs: T + 60_000, lastMs: T + 125_000 });
  });
  it('受信中の累計が保存済みの合計より少なければ(読み直し後など)行の合計を使う', () => {
    const items = sheetItems(base([likeRow('l1', 'a', T, 5), likeRow('l2', 'a', T + 60_000, 7)], 0));
    expect(items).toEqual([{ k: 'like-summary', count: 12, firstMs: T, lastMs: T + 60_000 }]);
  });
  it('いいね行が無ければそのまま(ヘッダの ❤️ だけ)', () => {
    const rows = [comment('c1', 'a', T), gift('g1', 'a', T + 1, 2)];
    expect(sheetItems(base(rows, 9, T + 5))).toEqual(rows);
    expect(sheetItems(base([], 9, T + 5))).toEqual([]);
  });
});
