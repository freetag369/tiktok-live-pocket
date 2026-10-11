import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JoinDock, dockLabel } from '../src/components/JoinDock';
import { FeedList } from '../src/components/FeedList';
import { dockJoins } from '../src/lib/feed';
import { LiveSession } from '../src/lib/session';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

describe('下の固定枠(入室)', () => {
  it('入室者全員を名前・回数(初見)・前回入室で出し、すべて・コメントタブの上のフィードには入室を流さない', async () => {
    const session = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    await session.whenReady();
    try {
      const t = new Date(2026, 8, 28, 19).getTime();
      session.ingest('roomInfo', { id_str: 'previous' }, t);
      const join = (id: string, user: Record<string, unknown>, time: number) => session.ingest('WebcastMemberMessage', { common: { msgId: id }, user, action: 1 }, time);
      join('p1', { id: 'a', nickname: 'たろう' }, t);
      const t2 = t + 86400000;
      session.ingest('roomInfo', { id_str: 'room' }, t2);
      join('j1', { id: 'a', nickname: 'たろう' }, t2);
      join('j2', { id: 'b', nickname: 'user28420669859', uniqueId: 'user28420669859' }, t2 + 1000);
      session.ingest('WebcastChatMessage', { common: { msgId: 'c1' }, user: { id: 'c', nickname: 'はなこ' }, content: 'hello' }, t2 + 2000);
      const snap = session.snapshot();

      for (const tab of ['all', 'comment'] as const) {
        const rows = dockJoins(snap.feed.rows, tab);
        // 前の配信の入室も行として残っている(フィードと同じ)
        expect(rows.map((r) => r.id)).toEqual(['p1', 'j1', 'j2']);
        const dock = renderToStaticMarkup(createElement(JoinDock, { rows, showAvatars: false, memos: snap.memos, previousJoinedFor: session.previousJoinedFor }));
        expect(dock).toContain('たろう');
        expect(dock).toContain('2回目');
        expect(dock).toContain('前回入室：9月28日19時');
        expect(dock).toContain('user28420669859');
        expect(dock).toContain('初見');
        expect(dock).toContain('前回入室：未記録');
        expect(dock).not.toContain('が入室');

        const feed = renderToStaticMarkup(createElement(FeedList, { rows: snap.feed.rows, tab, showAvatars: false, bigGiftDiamonds: 100, memos: snap.memos, empty: '', docked: true }));
        expect(feed).toContain('はなこ');
        expect(feed).not.toContain('たろう');
        expect(feed).not.toContain('user28420669859');
      }
      // 入室タブは枠を出さず、上のフィードに入室が流れる
      expect(dockJoins(snap.feed.rows, 'join')).toEqual([]);
      const joinTab = renderToStaticMarkup(createElement(FeedList, { rows: snap.feed.rows, tab: 'join', showAvatars: false, bigGiftDiamonds: 100, memos: snap.memos, empty: '' }));
      expect(joinTab).toContain('たろう');
      expect(joinTab).toContain('user28420669859');
    } finally {
      session.disconnect();
    }
  });

  it('表示名はニックネーム → @ハンドル → ID の順', () => {
    expect(dockLabel({ userId: '1', nickname: 'たろう', uniqueId: 'taro' })).toBe('たろう');
    expect(dockLabel({ userId: '1', nickname: 'user28420669859' })).toBe('user28420669859');
    expect(dockLabel({ userId: '1', nickname: ' ', uniqueId: 'taro' })).toBe('@taro');
    expect(dockLabel({ userId: '1' })).toBe('ID 1');
  });
});
