import 'fake-indexeddb/auto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { FeedList } from '../src/components/FeedList';
import { ViewersSheet } from '../src/components/ViewersSheet';
import { LikeRanking } from '../src/components/LikeRanking';
import { Interactions } from '../src/components/Interactions';
import { LiveSession } from '../src/lib/session';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { MemoBook } from '../src/lib/memos';
import { loadMemos, saveMemos } from '../src/lib/db';
import { buildInteractions, filterInteractions } from '../src/lib/interactions';

it('前回だけの保存・復元と各ユーザー一覧の表示、デモ分離', async () => {
  const session = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
  await session.whenReady();
  const userId = 'previous-note-ui';
  try {
    session.ingest('roomInfo', { id_str: 'previous-note-room' });
    session.ingest('WebcastChatMessage', { common: { msgId: 'pn-comment' }, user: { id: userId }, content: 'こんにちは' });
    session.ingest('WebcastLikeMessage', { common: { msgId: 'pn-like' }, user: { id: userId }, likeCount: 3 });
    session.setMemo(userId, { note: '', kana: '', previousNote: 'ギフトのお礼' });
    const data = await session.exportData();
    await saveMemos(data.memos, []);
    expect(new MemoBook(await loadMemos()).get(userId)?.previousNote).toBe('ギフトのお礼');
    const snap = session.snapshot();
    const common = { rows: snap.feed.rows, memos: snap.memos, showAvatars: false, bigGiftDiamonds: 100, empty: '' };
    const likes = { likes: snap.feed.likes, likeCount: snap.feed.likeCount };
    for (const html of [
      renderToStaticMarkup(createElement(FeedList, { ...common, tab: 'all' })),
      renderToStaticMarkup(createElement(LikeRanking, { ...common, ...likes })),
      renderToStaticMarkup(createElement(ViewersSheet, { items: session.viewersForList(), showAvatars: false, onPick: () => {}, onClose: () => {} })),
      renderToStaticMarkup(createElement(Interactions, { ...common, ...likes, session, roomId: 'previous-note-room', screenEpoch: snap.screenEpoch, onMemo: () => {} })),
    ]) expect(html).toContain('前回：ギフトのお礼');
    expect(filterInteractions(buildInteractions(snap.feed.rows.filter((r) => r.k !== 'room'), snap.feed.likes), 'お礼', snap.memos).map((r) => r.userId)).toContain(userId);
    await session.resetHistory();
    expect(session.getMemo(userId)?.previousNote).toBe('ギフトのお礼');
    session.playDemo([{ o: 10000, type: 'WebcastChatMessage', data: {} }]);
    session.setMemo(userId, { note: '', kana: '', previousNote: 'デモ限定' });
    expect(session.snapshot().memos.get(userId)?.previousNote).toBe('デモ限定');
    expect(session.snapshot().archiveMemos.get(userId)?.previousNote).toBe('ギフトのお礼');
  } finally {
    session.disconnect();
  }
});
