import { describe, expect, it } from 'vitest';
import { VisitCounter } from '../src/lib/visits';

const T = 1_785_240_000_000;
const u1 = { userId: 'u1', nickname: 'A', uniqueId: 'a' };

describe('VisitCounter', () => {
  it('初めての人は 1回目・初見。同じ配信内で何度見ても変わらない', () => {
    const c = new VisitCounter();
    c.setRoom('room1');
    expect(c.touch(u1, T)).toEqual({ visits: 1, firstEver: true });
    expect(c.touch(u1, T + 1000)).toEqual({ visits: 1, firstEver: true });
    expect(c.drainDirty()).toHaveLength(1);
  });

  it('別の配信で見たら 2回目・初見ではない', () => {
    const c = new VisitCounter();
    c.setRoom('room1');
    c.touch(u1, T);
    c.setRoom('room2');
    expect(c.touch(u1, T + 1)).toEqual({ visits: 2, firstEver: false });
  });

  it('同じ配信で再接続・再起動しても二重に数えない', () => {
    const c = new VisitCounter();
    c.setRoom('room1');
    c.touch(u1, T);
    const saved = c.drainDirty();
    // 再起動: 保存済みレコードから復元
    const c2 = new VisitCounter(saved);
    c2.setRoom('room1');
    expect(c2.touch(u1, T + 5000)).toEqual({ visits: 1, firstEver: true });
    // 同じ roomId を setRoom し直しても影響なし
    c2.setRoom('room1');
    expect(c2.touch(u1, T + 6000)).toEqual({ visits: 1, firstEver: true });
  });

  it('過去に別配信で見た人が同じ配信を再び見ても初見にならない', () => {
    const c = new VisitCounter([{ userId: 'u1', visits: 3, lastRoomId: 'roomX', firstSeenMs: T - 1, lastSeenMs: T - 1 }]);
    c.setRoom('roomX');
    expect(c.touch(u1, T)).toEqual({ visits: 3, firstEver: false });
  });

  it('roomInfo 前は数えない(保存もしない)', () => {
    const c = new VisitCounter();
    expect(c.touch(u1, T)).toEqual({ visits: 1, firstEver: true });
    expect(c.drainDirty()).toHaveLength(0);
    c.setRoom('room1');
    expect(c.touch(u1, T)).toEqual({ visits: 1, firstEver: true });
    expect(c.size).toBe(1);
  });

  it('ハンドル・名前・アバターの変更は保存対象になる', () => {
    const c = new VisitCounter();
    c.setRoom('room1');
    c.touch(u1, T);
    c.drainDirty();
    c.touch({ ...u1, nickname: 'B' }, T + 1);
    const d = c.drainDirty();
    expect(d).toHaveLength(1);
    expect(d[0]!.nickname).toBe('B');
  });

  it('入室・コメント・ギフトどのイベントでも初回観測で数える(呼び出し側が viewer を渡す)', () => {
    const c = new VisitCounter();
    c.setRoom('room1');
    expect(c.touch({ userId: 'u9' }, T)).toEqual({ visits: 1, firstEver: true });
  });
});
