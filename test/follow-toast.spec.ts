import { describe, expect, it } from 'vitest';
import { FOLLOW_TOAST_MS, followToastLabel, followerName, pushFollow } from '../src/lib/follow-toast';

describe('pushFollow', () => {
  it('表示中なら合算して期限を延ばす', () => {
    const a = pushFollow(null, { name: 'A', firstEver: false }, 1000);
    expect(a.names).toEqual(['A']);
    expect(a.untilMs).toBe(1000 + FOLLOW_TOAST_MS);
    const b = pushFollow(a, { name: 'B', avatarUrl: 'b.png', firstEver: true }, 2000);
    expect(b.id).toBe(a.id);
    expect(b.names).toEqual(['A', 'B']);
    expect(b.avatarUrl).toBe('b.png');
    expect(b.firstEver).toBe(true);
    expect(b.untilMs).toBe(2000 + FOLLOW_TOAST_MS);
  });

  it('期限切れなら新しい 1 枚になる', () => {
    const a = pushFollow(null, { name: 'A', avatarUrl: 'a.png', firstEver: true }, 1000);
    const b = pushFollow(a, { name: 'B', firstEver: false }, 1000 + FOLLOW_TOAST_MS);
    expect(b.id).not.toBe(a.id);
    expect(b.names).toEqual(['B']);
    expect(b.avatarUrl).toBeUndefined();
    expect(b.firstEver).toBe(false);
  });

  it('同じ名前は重複させず、アイコンが無ければ前のを保つ', () => {
    const a = pushFollow(null, { name: 'A', avatarUrl: 'a.png', firstEver: false }, 1000);
    const b = pushFollow(a, { name: 'A', firstEver: false }, 1500);
    expect(b.names).toEqual(['A']);
    expect(b.avatarUrl).toBe('a.png');
  });
});

describe('followToastLabel', () => {
  it('人数で表記を変える', () => {
    expect(followToastLabel(['A'])).toBe('A さん');
    expect(followToastLabel(['A', 'B'])).toBe('A さん・B さん');
    expect(followToastLabel(['A', 'B', 'C', 'D', 'E'])).toBe('A さん・B さん 他 3 人');
  });
});

describe('followerName', () => {
  it('nickname → uniqueId → userId の順に使う', () => {
    expect(followerName({ userId: '1', uniqueId: 'u', nickname: 'N' })).toBe('N');
    expect(followerName({ userId: '1', uniqueId: 'u', nickname: '  ' })).toBe('u');
    expect(followerName({ userId: '1' })).toBe('1');
  });
});
