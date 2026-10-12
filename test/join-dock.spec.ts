import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JoinDock, dockLabel } from '../src/components/JoinDock';
import { FeedList } from '../src/components/FeedList';
import { dockJoins, JOIN_DOCK_KEEP } from '../src/lib/feed';
import { hasMemoContent } from '../src/lib/memos';
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
        const dock = renderToStaticMarkup(createElement(JoinDock, { rows, showAvatars: false, previousJoinedFor: session.previousJoinedFor }));
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

  it('メモ・前回・よみがなのどれかがある人の入室は枠に入れず、すべて・コメントタブの上のフィードに(よみがな付きで)流す', async () => {
    const session = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    await session.whenReady();
    try {
      const t = new Date(2026, 8, 28, 19).getTime();
      session.ingest('roomInfo', { id_str: 'room' }, t);
      const join = (id: string, user: Record<string, unknown>, time: number) => session.ingest('WebcastMemberMessage', { common: { msgId: id }, user, action: 1 }, time);
      join('j1', { id: 'kana', nickname: '太郎' }, t);
      join('j2', { id: 'note', nickname: 'はなこ' }, t + 1000);
      join('j3', { id: 'prev', nickname: 'じろう' }, t + 2000);
      join('j4', { id: 'plain', nickname: 'さぶろう' }, t + 3000);
      session.setMemo('kana', { note: '', kana: 'たろう', previousNote: '' }, t);
      session.setMemo('note', { note: '常連', kana: '', previousNote: '' }, t);
      session.setMemo('prev', { note: '', kana: '', previousNote: 'お礼済み' }, t);
      const snap = session.snapshot();
      const memoJoin = (r: { viewer: { userId: string } }) => hasMemoContent(snap.memos.get(r.viewer.userId));

      for (const tab of ['all', 'comment'] as const) {
        const rows = dockJoins(snap.feed.rows, tab, JOIN_DOCK_KEEP, memoJoin);
        expect(rows.map((r) => r.id)).toEqual(['j4']);
        const dock = renderToStaticMarkup(createElement(JoinDock, { rows, showAvatars: false, previousJoinedFor: session.previousJoinedFor }));
        expect(dock).toContain('さぶろう');
        expect(dock).not.toContain('太郎');
        expect(dock).not.toContain('はなこ');
        expect(dock).not.toContain('じろう');

        const feed = renderToStaticMarkup(createElement(FeedList, { rows: snap.feed.rows, tab, showAvatars: false, bigGiftDiamonds: 100, memos: snap.memos, empty: '', docked: true }));
        expect(feed).toContain('太郎');
        expect(feed).toContain('(たろう)');
        expect(feed).toContain('はなこ');
        expect(feed).toContain('常連');
        expect(feed).toContain('じろう');
        expect(feed).toContain('お礼済み');
        expect(feed).toContain('が入室');
        expect(feed).not.toContain('さぶろう');
      }
      // 入室タブは今まで通り全員上に流れる
      const joinTab = renderToStaticMarkup(createElement(FeedList, { rows: snap.feed.rows, tab: 'join', showAvatars: false, bigGiftDiamonds: 100, memos: snap.memos, empty: '' }));
      for (const n of ['太郎', 'はなこ', 'じろう', 'さぶろう']) expect(joinTab).toContain(n);
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
