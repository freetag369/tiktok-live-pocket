import { describe, expect, it } from 'vitest';
import { LIKE_BURST_MS, LIKES_MAX, rankLikes, recentLikers, touchLike, type LikeEntry } from '../src/lib/likes';
import type { LikeEvent } from '../src/lib/events';

const T = 1_785_240_000_000;
const meta = { visits: 1, firstEver: true };

function like(userId: string, count: number, id = `${userId}:${count}`): LikeEvent {
  return { kind: 'like', msgId: id, tsMs: T, viewer: { userId, nickname: `n${userId}` }, count };
}

function entry(userId: string, taps: number, lastMs: number): LikeEntry {
  return { userId, viewer: { userId }, taps, burst: taps, lastMs, visits: 1, firstEver: false };
}

describe('touchLike', () => {
  it('同じ人のタップを合算し、3 秒以内なら連打として burst も伸びる', () => {
    const m = new Map<string, LikeEntry>();
    const a = touchLike(m, like('u1', 3), meta, T);
    expect(a).toMatchObject({ taps: 3, burst: 3, lastMs: T });
    const b = touchLike(m, like('u1', 4), meta, T + LIKE_BURST_MS - 1);
    expect(b).toMatchObject({ taps: 7, burst: 7 });
    expect(b).not.toBe(a);
    const c = touchLike(m, like('u1', 2), meta, T + LIKE_BURST_MS - 1 + LIKE_BURST_MS);
    expect(c).toMatchObject({ taps: 9, burst: 2 });
    expect(m.size).toBe(1);
  });

  it('名前と来店情報は最新で上書きする', () => {
    const m = new Map<string, LikeEntry>();
    touchLike(m, like('u1', 1), { visits: 1, firstEver: true }, T);
    touchLike(m, { ...like('u1', 1), viewer: { userId: 'u1', nickname: '新しい名前' } }, { visits: 7, firstEver: false }, T + 10);
    expect(m.get('u1')).toMatchObject({ viewer: { nickname: '新しい名前' }, visits: 7, firstEver: false });
  });

  it('人数が上限を超えたらタップの少ない方から捨て、多い人は残る', () => {
    const m = new Map<string, LikeEntry>();
    touchLike(m, like('big', 999), meta, T);
    for (let i = 0; i < LIKES_MAX; i++) touchLike(m, like(`u${i}`, 1), meta, T + i);
    expect(m.size).toBeLessThanOrEqual(LIKES_MAX);
    expect(m.get('big')?.taps).toBe(999);
  });
});

describe('rankLikes / recentLikers', () => {
  it('タップ数の多い順、同数なら新しい順、さらに同じなら userId 順', () => {
    const m = new Map<string, LikeEntry>([
      ['b', entry('b', 5, T)],
      ['a', entry('a', 5, T)],
      ['c', entry('c', 5, T + 1)],
      ['d', entry('d', 9, T - 100)],
    ]);
    expect(rankLikes(m, 10).map((e) => e.userId)).toEqual(['d', 'c', 'a', 'b']);
    expect(rankLikes(m, 2).map((e) => e.userId)).toEqual(['d', 'c']);
  });

  it('recentLikers: 窓の中の人だけ新しい順、limit を守る', () => {
    const m = new Map<string, LikeEntry>([
      ['a', entry('a', 1, T - 100)],
      ['b', entry('b', 1, T - 2999)],
      ['c', entry('c', 1, T - 3000)],
      ['d', entry('d', 1, T - 5000)],
    ]);
    expect(recentLikers(m, T, 3000, 3).map((e) => e.userId)).toEqual(['a', 'b']);
    expect(recentLikers(m, T, 3000, 1).map((e) => e.userId)).toEqual(['a']);
  });
});
