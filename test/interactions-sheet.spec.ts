import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PersonSheet } from '../src/components/Interactions';
import type { FeedRow } from '../src/lib/feed';
import { hhmm } from '../src/lib/format';
import type { Interaction } from '../src/lib/interactions';

const T = 1_785_240_000_000;
const viewer = { userId: 'u1', nickname: 'ゆなちゃん', uniqueId: 'yuna.x', gifterLevel: 12 };

const comment = (id: string, tsMs: number, text: string): FeedRow => ({ k: 'comment', id, tsMs, viewer, text, visits: 3, firstEver: false });
const gift = (id: string, tsMs: number): FeedRow => ({ k: 'gift', id, tsMs, viewer, giftId: '5655', giftName: 'Rose', count: 2, diamondEach: 1, diamonds: 2, streaking: false, visits: 3, firstEver: false });
const follow = (id: string, tsMs: number): FeedRow => ({ k: 'social', id, tsMs, viewer, sub: 'follow', visits: 3, firstEver: false });

const rows = [comment('c1', T, 'こんばんは'), gift('g1', T + 1000), comment('c2', T + 2000, '今日も来たよ'), follow('s1', T + 3000)];
const person: Interaction = { userId: 'u1', viewer, comments: 2, gifts: 1, diamonds: 2, joins: 0, follows: 1, likes: 5, lastMs: T + 4000, likeLastMs: T + 4000, visits: 3, firstEver: false, rows };

function render(it: Interaction, memo?: Parameters<typeof PersonSheet>[0]['memo']): string {
  return renderToStaticMarkup(createElement(PersonSheet, { it, memo, showAvatars: false, bigGiftDiamonds: 100, onMemo: () => {}, onBack: () => {} }));
}

describe('やり取りの人物シート', () => {
  const html = render(person);
  const commentsOnly = render({ ...person, rows: rows.filter((r) => r.k === 'comment'), gifts: 0, diamonds: 0, follows: 0 });

  it('名前・バッジ・数は上に 1 回だけ出し、コメント行には繰り返さない', () => {
    expect(commentsOnly.split('ゆなちゃん').length - 1).toBe(1);
    expect(commentsOnly.split('3回目').length - 1).toBe(1);
    expect(commentsOnly.split('Lv.12').length - 1).toBe(1);
    // アイコンはヘッダの 1 つだけ
    expect(commentsOnly.split('class="avatar').length - 1).toBe(1);
    const summary = html.slice(html.indexOf('person-summary'), html.indexOf('memo-line'));
    expect(summary).toContain('3回目');
    expect(summary).toContain('Lv.12');
    expect(summary).toContain('💬 2');
    expect(summary).toContain('💎 2');
  });

  it('いいねは別ブロックではなく数の行に最後の時刻つきで入る', () => {
    expect(html).toContain(`❤️ 5 · 最後 ${hhmm(T + 4000)}`);
    expect(html).not.toContain('person-likes');
    expect(html).not.toContain('いいねは回数だけで');
    // ヘッダの @ハンドルは残り、バッジはヘッダから下の 1 行へ移る
    const header = html.slice(0, html.indexOf('person-head'));
    expect(header).toContain('@yuna.x');
    expect(header).not.toContain('3回目');
  });

  it('コメントは時刻 + 本文だけの行、ギフト・フォローは従来の行', () => {
    expect(html.split('class="row cline').length - 1).toBe(2);
    expect(html).toContain(`<time>${hhmm(T)}</time><span class="text">こんばんは</span>`);
    expect(html).toContain('今日も来たよ');
    expect(html).toContain('class="row gift');
    expect(html).toContain('class="row social');
    // ギフト・フォロー行は名前つきのまま(上 1 回 + 2 行)
    expect(html.split('ゆなちゃん').length - 1).toBe(3);
  });

  it('メモ・前回はシート上部に出て、コメント行には繰り返さない', () => {
    const memo = { userId: 'u1', note: '誕生日 3/4', previousNote: 'ギフトのお礼', kana: 'ゆな', updatedMs: T };
    const only = render({ ...person, rows: rows.filter((r) => r.k === 'comment'), gifts: 0, diamonds: 0, follows: 0 }, memo);
    expect(only.split('誕生日 3/4').length - 1).toBe(1);
    expect(only.split('前回：ギフトのお礼').length - 1).toBe(1);
    expect(only).toContain('(ゆな)');
    // ギフト・フォロー行(FeedRowView のまま)にはメモが付く: 上部 1 + 2 行
    expect(render(person, memo).split('前回：ギフトのお礼').length - 1).toBe(3);
  });

  it('行が無ければ「いいねだけ」と出る', () => {
    expect(render({ ...person, rows: [], comments: 0, gifts: 0, diamonds: 0, follows: 0 })).toContain('この配信ではいいねだけです。');
  });
});
