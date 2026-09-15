import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSession } from '../src/lib/session';
import { createFeedState } from '../src/lib/feed';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

const demo = readFileSync(new URL('../src/fixtures/demo.ndjson', import.meta.url), 'utf8')
  .split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));

describe('demo session', () => {
  let session: LiveSession;

  beforeEach(async () => {
    vi.useFakeTimers();
    session = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    await session.whenReady();
  });

  afterEach(() => {
    session.disconnect();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('デモ開始時に前のチャットを消し、来店履歴は保持する', () => {
    session.ingest('WebcastChatMessage', {
      common: { msgId: 'live-chat' }, user: { id: 'real-viewer' }, content: '前のチャット',
    });
    expect(session.rows).toHaveLength(1);
    const knownViewers = session.snapshot().knownViewers;
    session.playDemo(demo);
    expect(session.snapshot().feed).toEqual(createFeedState());
    expect(session.snapshot().knownViewers).toBe(knownViewers);
  });

  it('完了後に再デモしても4行・1717ダイヤで、連打は同じ行を更新する', () => {
    for (let run = 0; run < 2; run++) {
      session.playDemo(demo);
      expect(session.snapshot().feed).toEqual(createFeedState());
      vi.advanceTimersByTime(4000);
      for (const [count, delay] of [[1, 350], [3, 350], [5, 350], [8, 0]]) {
        const gifts = session.rows.filter((row) => row.k === 'gift');
        expect(gifts).toHaveLength(1);
        expect(gifts[0]).toMatchObject({ giftName: 'Rose', count, diamonds: count });
        vi.advanceTimersByTime(delay!);
      }
      vi.advanceTimersByTime(10000);
      expect(session.snapshot().demo).toBe(false);
      expect(session.snapshot().feed).toMatchObject({ giftCount: 4, diamonds: 1717 });
      expect(session.rows.filter((row) => row.k === 'gift')).toHaveLength(4);
      expect(new Set(session.rows.map((row) => row.id)).size).toBe(session.rows.length);
    }
  });

  it('連打途中で再デモしても古いタイマーと連打状態を引き継がない', () => {
    session.playDemo(demo);
    vi.advanceTimersByTime(4700);
    expect(session.snapshot().feed.diamonds).toBe(5);
    session.playDemo(demo);
    expect(session.snapshot().feed).toEqual(createFeedState());
    vi.advanceTimersByTime(15000);
    expect(session.snapshot().feed).toMatchObject({ giftCount: 4, diamonds: 1717 });
    expect(session.rows.filter((row) => row.k === 'gift')).toHaveLength(4);
  });
});
