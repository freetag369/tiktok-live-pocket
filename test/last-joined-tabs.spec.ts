import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FeedList } from '../src/components/FeedList';
import { Interactions } from '../src/components/Interactions';
import { LiveSession } from '../src/lib/session';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

describe('各タブの前回入室表示', () => {
  it('すべて・やり取りに同じ日時を表示し、同じ配信の再入室でも前回日時を保つ', async () => {
    const session = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    await session.whenReady();
    try {
      const t = new Date(2026, 8, 28, 19).getTime();
      session.ingest('roomInfo', { id_str: 'previous' }, t);
      const join = (id: string, time: number) => session.ingest('WebcastMemberMessage', { common: { msgId: id }, user: { id: 'a', nickname: 'A' }, action: 1 }, time);
      join('previous-entry', t);
      session.ingest('roomInfo', { id_str: 'room' }, t + 86400000);
      join('j1', t + 86400000);
      session.ingest('WebcastChatMessage', { common: { msgId: 'c1' }, user: { id: 'a' }, content: 'hello' }, t + 1000);
      session.ingest('WebcastChatMessage', { common: { msgId: 'c2' }, user: { id: 'b' }, content: 'no join' }, t + 2000);
      function screens() {
        const snap = session.snapshot();
        const common = { rows: snap.feed.rows, memos: snap.memos, showAvatars: false, bigGiftDiamonds: 100, empty: '' };
        return [
          renderToStaticMarkup(createElement(FeedList, { ...common, tab: 'all', previousJoinedFor: session.previousJoinedFor })),
          renderToStaticMarkup(createElement(Interactions, { ...common, session, roomId: 'room', likes: snap.feed.likes, likeCount: snap.feed.likeCount, screenEpoch: snap.screenEpoch, onMemo: () => {} })),
        ];
      }
      for (const html of screens()) {
        expect(html).toContain('前回入室：9月28日19時');
        expect(html).toContain('前回入室：未記録');
      }
      join('j2', t + 86400000 + 3600000);
      for (const html of screens()) {
        expect(html).toContain('前回入室：9月28日19時');
        expect(html).not.toContain('前回入室：9月29日20時');
      }
    } finally {
      session.disconnect();
    }
  });
});
