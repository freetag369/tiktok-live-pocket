import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JoinDock, dockLabel } from '../src/components/JoinDock';
import { FeedList } from '../src/components/FeedList';
import { dockJoins, featuredJoin, JOIN_DOCK_KEEP, type JoinRow } from '../src/lib/feed';
import { hasMemoContent } from '../src/lib/memos';
import { LiveSession } from '../src/lib/session';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

describe('下の固定枠(入室)', () => {
  it('メモの無い入室は名前の有無に関わらず名前・回数(初見)・前回入室で枠に出し、すべて・コメントタブの上のフィードには流さない', async () => {
    const session = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    await session.whenReady();
    try {
      const t = new Date(2026, 8, 28, 19).getTime();
      session.ingest('roomInfo', { id_str: 'previous' }, t);
      const join = (id: string, user: Record<string, unknown>, time: number) => session.ingest('WebcastMemberMessage', { common: { msgId: id }, user, action: 1 }, time);
      join('p1', { id: 'a', nickname: 'たろう' }, t);
      join('p2', { id: 'b', nickname: 'user28420669859', uniqueId: 'user28420669859' }, t);
      const t2 = t + 86400000;
      session.ingest('roomInfo', { id_str: 'room' }, t2);
      join('j1', { id: 'a', nickname: 'たろう' }, t2);
      join('j2', { id: 'b', nickname: 'user28420669859', uniqueId: 'user28420669859' }, t2 + 1000);
      join('j3', { id: 'd', nickname: 'user31000000001' }, t2 + 1500);
      session.ingest('WebcastChatMessage', { common: { msgId: 'c1' }, user: { id: 'c', nickname: 'はなこ' }, content: 'hello' }, t2 + 2000);
      const snap = session.snapshot();
      const featured = (r: JoinRow) => featuredJoin(r.viewer, snap.memos.get(r.viewer.userId));

      for (const tab of ['all', 'comment'] as const) {
        const rows = dockJoins(snap.feed.rows, tab, JOIN_DOCK_KEEP, featured);
        // 前の配信の入室も行として残っている(フィードと同じ)
        expect(rows.map((r) => r.id)).toEqual(['p1', 'p2', 'j1', 'j2', 'j3']);
        const dock = renderToStaticMarkup(createElement(JoinDock, { rows, showAvatars: false, previousJoinedFor: session.previousJoinedFor }));
        expect(dock).toContain('たろう');
        expect(dock).toContain('user28420669859');
        expect(dock).toContain('2回目');
        expect(dock).toContain('前回入室：9月28日19時');
        expect(dock).toContain('user31000000001');
        expect(dock).toContain('初見');
        expect(dock).toContain('前回入室：未記録');
        expect(dock).not.toContain('が入室');
        expect(dock).not.toContain('badge join');

        const feed = renderToStaticMarkup(createElement(FeedList, { rows: snap.feed.rows, tab, showAvatars: false, bigGiftDiamonds: 100, memos: snap.memos, empty: '', docked: true }));
        expect(feed).toContain('はなこ');
        expect(feed).not.toContain('たろう');
        expect(feed).not.toContain('badge join');
        expect(feed).not.toContain('user28420669859');
        expect(feed).not.toContain('user31000000001');
      }
      // 入室タブは枠を出さず、上のフィードに全員の入室が流れる
      expect(dockJoins(snap.feed.rows, 'join')).toEqual([]);
      const joinTab = renderToStaticMarkup(createElement(FeedList, { rows: snap.feed.rows, tab: 'join', showAvatars: false, bigGiftDiamonds: 100, memos: snap.memos, empty: '' }));
      expect(joinTab).toContain('たろう');
      expect(joinTab).toContain('user28420669859');
    } finally {
      session.disconnect();
    }
  });

  it('メモ・前回・よみがなのどれかがある人の入室は枠に入れず、すべて・コメントタブの上のフィードに緑タグで(すべてではよみがな・メモ付きで)流す', async () => {
    const session = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    await session.whenReady();
    try {
      const t = new Date(2026, 8, 28, 19).getTime();
      session.ingest('roomInfo', { id_str: 'room' }, t);
      const join = (id: string, user: Record<string, unknown>, time: number) => session.ingest('WebcastMemberMessage', { common: { msgId: id }, user, action: 1 }, time);
      join('j1', { id: 'kana', nickname: 'user10000000001' }, t);
      join('j2', { id: 'note', nickname: 'user10000000002' }, t + 1000);
      join('j3', { id: 'prev', nickname: 'user10000000003' }, t + 2000);
      join('j4', { id: 'plain', nickname: 'user10000000004' }, t + 3000);
      session.setMemo('kana', { note: '', kana: 'たろう', previousNote: '' }, t);
      session.setMemo('note', { note: '常連', kana: '', previousNote: '' }, t);
      session.setMemo('prev', { note: '', kana: '', previousNote: 'お礼済み' }, t);
      const snap = session.snapshot();
      const featured = (r: JoinRow) => featuredJoin(r.viewer, snap.memos.get(r.viewer.userId));
      for (const id of ['kana', 'note', 'prev']) expect(hasMemoContent(snap.memos.get(id))).toBe(true);

      for (const tab of ['all', 'comment'] as const) {
        const rows = dockJoins(snap.feed.rows, tab, JOIN_DOCK_KEEP, featured);
        expect(rows.map((r) => r.id)).toEqual(['j4']);
        const dock = renderToStaticMarkup(createElement(JoinDock, { rows, showAvatars: false, previousJoinedFor: session.previousJoinedFor }));
        expect(dock).toContain('user10000000004');
        for (const n of ['user10000000001', 'user10000000002', 'user10000000003']) expect(dock).not.toContain(n);

        const feed = renderToStaticMarkup(createElement(FeedList, { rows: snap.feed.rows, tab, showAvatars: false, bigGiftDiamonds: 100, memos: snap.memos, empty: '', docked: true }));
        for (const n of ['user10000000001', 'user10000000002', 'user10000000003']) expect(feed).toContain(n);
        expect(feed).toContain('(たろう)');
        expect(feed).toContain('class="badge join">入室<');
        expect(feed).not.toContain('user10000000004');
        if (tab === 'all') {
          expect(feed).toContain('常連');
          expect(feed).toContain('お礼済み');
        } else {
          // コメントタブでは入室の行にもメモ・前回を出さない
          expect(feed).not.toContain('常連');
          expect(feed).not.toContain('お礼済み');
        }
      }
      // 入室タブは今まで通り全員上に流れる
      const joinTab = renderToStaticMarkup(createElement(FeedList, { rows: snap.feed.rows, tab: 'join', showAvatars: false, bigGiftDiamonds: 100, memos: snap.memos, empty: '' }));
      for (const n of ['user10000000001', 'user10000000002', 'user10000000003', 'user10000000004']) expect(joinTab).toContain(n);
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
