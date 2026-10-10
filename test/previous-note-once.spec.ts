import 'fake-indexeddb/auto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { FeedList, type Tab } from '../src/components/FeedList';
import { Interactions } from '../src/components/Interactions';
import { LiveSession } from '../src/lib/session';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

it('フィードでは「前回」をその配信でその人の最初の行にだけ出し、配信が変わればまた 1 回出す', async () => {
  const session = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
  await session.whenReady();
  const userId = 'previous-note-once';
  try {
    session.ingest('roomInfo', { id_str: 'once-room-1' });
    session.ingest('WebcastChatMessage', { common: { msgId: 'once-c1' }, user: { id: userId }, content: 'こんにちは' });
    session.ingest('WebcastChatMessage', { common: { msgId: 'once-c2' }, user: { id: userId }, content: 'また来ました' });
    session.ingest('WebcastGiftMessage', { common: { msgId: 'once-g1' }, user: { id: userId }, giftId: 5655, repeatCount: 1, repeatEnd: 1, giftDetails: { id: '5655', giftName: 'Rose', giftType: 1, diamondCount: 1 } });
    session.ingest('WebcastChatMessage', { common: { msgId: 'once-c3' }, user: { id: 'someone-else' }, content: '別の人' });
    session.setMemo(userId, { note: '常連さん', kana: '', previousNote: 'ギフトのお礼' });

    const feed = (tab: Tab) => {
      const snap = session.snapshot();
      return renderToStaticMarkup(createElement(FeedList, { rows: snap.feed.rows, memos: snap.memos, tab, showAvatars: false, bigGiftDiamonds: 100, empty: '', previousJoinedFor: session.previousJoinedFor }));
    };

    let html = feed('all');
    expect(count(html, '前回：ギフトのお礼')).toBe(1);
    // 📝 本文と前回入室は今まで通り全行に出る。
    expect(count(html, '📝 常連さん')).toBe(3);
    expect(count(html, '前回入室：')).toBe(4);
    // 最初の行(c1)に付き、2 行目(c2)には付かない。
    expect(html.indexOf('前回：ギフトのお礼')).toBeLessThan(html.indexOf('また来ました'));
    expect(count(feed('comment'), '前回：ギフトのお礼')).toBe(1);
    expect(count(feed('gift'), '前回：ギフトのお礼')).toBe(1);

    // 配信が変わると、その配信の最初の行にまた 1 回出る。
    session.ingest('roomInfo', { id_str: 'once-room-2' });
    session.ingest('WebcastChatMessage', { common: { msgId: 'once-c4' }, user: { id: userId }, content: '翌日' });
    session.ingest('WebcastChatMessage', { common: { msgId: 'once-c5' }, user: { id: userId }, content: '翌日 2' });
    html = feed('all');
    expect(count(html, '前回：ギフトのお礼')).toBe(2);

    // やり取り(人ごとに 1 行)は対象外で、従来どおり出る。
    const snap = session.snapshot();
    const people = renderToStaticMarkup(createElement(Interactions, { session, roomId: 'once-room-2', rows: snap.feed.rows, likes: snap.feed.likes, likeCount: snap.feed.likeCount, screenEpoch: snap.screenEpoch, memos: snap.memos, showAvatars: false, bigGiftDiamonds: 100, onMemo: () => {}, empty: '' }));
    expect(people).toContain('前回：ギフトのお礼');
  } finally {
    session.disconnect();
  }
});
