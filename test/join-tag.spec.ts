import 'fake-indexeddb/auto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FeedList } from '../src/components/FeedList';
import { MemoSheet } from '../src/components/MemoSheet';
import { LiveSession } from '../src/lib/session';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/** 行ごとの HTML(行の始まりで割る)。 */
function rowsOf(html: string): string[] {
  return html.split('<div class="row ').slice(1);
}

describe('入室の緑タグと前回入室の出る行', () => {
  it('すべて: メモ持ちの入室は緑タグ、同じ配信の出直しは「再入室 2回目」、前回入室は入室行と最初の行だけ。コメント: どれも出ない', async () => {
    const session = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    await session.whenReady();
    try {
      const t = new Date(2026, 8, 28, 19).getTime();
      session.ingest('roomInfo', { id_str: 'previous' }, t);
      const join = (id: string, user: Record<string, unknown>, time: number) => session.ingest('WebcastMemberMessage', { common: { msgId: id }, user, action: 1 }, time);
      const chat = (id: string, user: Record<string, unknown>, text: string, time: number) => session.ingest('WebcastChatMessage', { common: { msgId: id }, user, content: text }, time);
      join('p1', { id: 'a', nickname: 'たろう' }, t);
      const t2 = t + 86400000;
      session.ingest('roomInfo', { id_str: 'room' }, t2);
      join('j1', { id: 'a', nickname: 'たろう' }, t2);
      chat('c1', { id: 'a', nickname: 'たろう' }, 'こんばんは', t2 + 1000);
      chat('c2', { id: 'a', nickname: 'たろう' }, 'また来た', t2 + 2000);
      // 入室メッセージが届かなかった人: コメントが最初の行
      chat('c3', { id: 'b', nickname: 'はなこ' }, '入室なし', t2 + 3000);
      chat('c4', { id: 'b', nickname: 'はなこ' }, '2 行目', t2 + 4000);
      join('j2', { id: 'a', nickname: 'たろう' }, t2 + 3600_000);
      session.setMemo('a', { note: '常連', kana: '', previousNote: 'お礼' }, t2);
      const snap = session.snapshot();
      const common = { rows: snap.feed.rows, memos: snap.memos, showAvatars: false, bigGiftDiamonds: 100, empty: '', previousJoinedFor: session.previousJoinedFor, docked: true };

      const all = renderToStaticMarkup(createElement(FeedList, { ...common, tab: 'all' }));
      const rows = rowsOf(all).filter((r) => r.includes('data-id="j1"') || r.includes('data-id="c1"') || r.includes('data-id="c2"') || r.includes('data-id="c3"') || r.includes('data-id="c4"') || r.includes('data-id="j2"'));
      expect(rows).toHaveLength(6);
      const [j1, c1, c2, c3, c4, j2] = rows as [string, string, string, string, string, string];
      expect(j1).toContain('class="badge join">入室<');
      expect(j1).toContain('前回入室：9月28日19時');
      expect(j1).toContain('📝 常連');
      expect(j1).toContain('前回：お礼');
      expect(j1).not.toContain('が入室');
      // 同じ人の 2 行目以降: 📝 は出るが前回入室は出ない
      expect(c1).toContain('📝 常連');
      expect(c1).not.toContain('前回入室：');
      expect(c2).not.toContain('前回入室：');
      // 入室が無い人は最初の行にだけ
      expect(c3).toContain('前回入室：未記録');
      expect(c4).not.toContain('前回入室：');
      // 出直しは「再入室 2回目」で、前回入室はまた出る(前の配信の日時のまま)
      expect(j2).toContain('class="badge join again">再入室 2回目<');
      expect(j2).toContain('前回入室：9月28日19時');
      // 「前回：」は配信ごとに最初の行(前の配信の p1 と今の j1)= 2 回。今の配信では j1 だけ。
      expect(count(all, '前回：お礼')).toBe(2);
      expect(c1).not.toContain('前回：お礼');
      expect(j2).not.toContain('前回：お礼');

      const comment = renderToStaticMarkup(createElement(FeedList, { ...common, tab: 'comment' }));
      expect(comment).toContain('こんばんは');
      expect(comment).toContain('class="badge join">入室<');
      expect(comment).toContain('再入室 2回目');
      expect(comment).not.toContain('前回入室：');
      expect(comment).not.toContain('📝');
      expect(comment).not.toContain('前回：');

      // 入室タブは全入室行に前回入室
      const joinTab = renderToStaticMarkup(createElement(FeedList, { ...common, docked: false, tab: 'join' }));
      expect(count(joinTab, '前回入室：')).toBe(3);
    } finally {
      session.disconnect();
    }
  });

  it('メモ画面は前回入室を出す(タップしたときに分かる)', () => {
    const target = { userId: 'a', nickname: 'たろう', visits: 3, firstEver: false };
    const props = { target, showAvatars: false, onSave: () => {}, onFavorite: () => {}, onClose: () => {}, autoFocus: false };
    const withJoin = renderToStaticMarkup(createElement(MemoSheet, { ...props, showPreviousJoined: true, previousJoinedMs: new Date(2026, 8, 28, 19).getTime() }));
    expect(withJoin).toContain('前回入室：9月28日19時');
    expect(withJoin).toContain('3回目');
    const unknown = renderToStaticMarkup(createElement(MemoSheet, { ...props, showPreviousJoined: true }));
    expect(unknown).toContain('前回入室：未記録');
    const off = renderToStaticMarkup(createElement(MemoSheet, props));
    expect(off).not.toContain('前回入室');
  });
});
