import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GiftDock } from '../src/components/GiftDock';
import { FeedList } from '../src/components/FeedList';
import { dockGifts, GIFT_DOCK_KEEP } from '../src/lib/feed';
import { LiveSession } from '../src/lib/session';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

describe('下の固定枠の右の列(ギフト)', () => {
  it('すべて・コメントタブではギフトを上のフィードに流さず右の列に出し、ギフトタブでは上に流す', async () => {
    const session = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    await session.whenReady();
    try {
      const t = new Date(2026, 10, 10, 20).getTime();
      session.ingest('roomInfo', { id_str: 'room' }, t);
      session.ingest('WebcastChatMessage', { common: { msgId: 'c1' }, user: { id: 'c', nickname: 'はなこ' }, content: 'こんばんは' }, t);
      session.ingest('WebcastGiftMessage', { common: { msgId: 'g1' }, user: { id: 'g', nickname: 'ギフトさん' }, giftId: '5655', gift: { name: 'Rose', type: 1, diamondCount: 1 }, groupId: 'combo', repeatCount: 3, repeatEnd: 0 }, t + 1000);
      session.ingest('WebcastGiftMessage', { common: { msgId: 'g2' }, user: { id: 'g', nickname: 'ギフトさん' }, giftId: '5655', gift: { name: 'Rose', type: 1, diamondCount: 1 }, groupId: 'combo', repeatCount: 7, repeatEnd: 1 }, t + 2000);
      session.ingest('WebcastGiftMessage', { common: { msgId: 'g3' }, user: { id: 'b', nickname: 'おおもの' }, giftId: '1', gift: { name: 'Lion', type: 2, diamondCount: 29999 }, repeatCount: 1, repeatEnd: 1 }, t + 3000);
      const snap = session.snapshot();

      for (const tab of ['all', 'comment'] as const) {
        const gifts = dockGifts(snap.feed.rows, tab);
        // 連打は 1 枚のカードが伸びる
        expect(gifts.map((r) => [r.id, r.count])).toEqual([
          ['g1', 7],
          ['g3', 1],
        ]);
        const dock = renderToStaticMarkup(createElement(GiftDock, { rows: gifts, bigGiftDiamonds: 100 }));
        expect(dock).toContain('ギフトさん');
        expect(dock).toContain('×7');
        expect(dock).toContain('dock-gift big');
        const feed = renderToStaticMarkup(createElement(FeedList, { rows: snap.feed.rows, tab, showAvatars: false, bigGiftDiamonds: 100, memos: snap.memos, empty: '', docked: true }));
        expect(feed).not.toContain('ギフトさん');
        expect(feed).not.toContain('おおもの');
      }
      expect(dockGifts(snap.feed.rows, 'all').length).toBeLessThanOrEqual(GIFT_DOCK_KEEP);
      // ギフトタブは枠を出さず、上に全部流す
      expect(dockGifts(snap.feed.rows, 'gift')).toEqual([]);
      const giftTab = renderToStaticMarkup(createElement(FeedList, { rows: snap.feed.rows, tab: 'gift', showAvatars: false, bigGiftDiamonds: 100, memos: snap.memos, empty: '' }));
      expect(giftTab).toContain('ギフトさん');
      expect(giftTab).toContain('おおもの');
    } finally {
      session.disconnect();
    }
  });

  it('メモに書いた呼び方を名前の後ろに出す', () => {
    const row = { k: 'gift' as const, id: 'g', tsMs: 0, viewer: { userId: 'u', nickname: 'Hongissara' }, giftId: '1', giftName: 'Rose', count: 1, diamondEach: 1, diamonds: 1, streaking: false, visits: 3, firstEver: false };
    const html = renderToStaticMarkup(createElement(GiftDock, { rows: [row], bigGiftDiamonds: 100, kanaFor: (id: string) => (id === 'u' ? 'ほんぎさん' : undefined) }));
    expect(html).toContain('Hongissara</span><span class="kana">(ほんぎさん)</span>');
  });

  it('ギフトが無ければ案内だけ出す', () => {
    expect(renderToStaticMarkup(createElement(GiftDock, { rows: [], bigGiftDiamonds: 100 }))).toContain('ギフトはここに出ます');
  });
});
