import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RegularToast } from '../src/components/RegularToast';
import { isRegularJoin, makeRegularPop, nextRegular, pushRegular, REGULAR_POPUP_MS, REGULAR_QUEUE_MAX, REGULAR_VISITS } from '../src/lib/regular-popup';
import type { MemoRecord } from '../src/lib/memos';
import { LiveSession, type JoinNotice } from '../src/lib/session';
import { DEFAULT_SETTINGS, sanitize } from '../src/lib/settings';

const memo = (p: Partial<MemoRecord>): MemoRecord => ({ userId: 'u', note: '', kana: '', updatedMs: 1, ...p });

describe('常連さんの入室ポップアップ', () => {
  it('来店 5 回以上か、メモ・前回・よみがな・お気に入りのある人の、その配信で最初の入室だけ', () => {
    expect(isRegularJoin({ visits: REGULAR_VISITS, firstEver: false, nth: 1 }, undefined)).toBe(true);
    expect(isRegularJoin({ visits: REGULAR_VISITS - 1, firstEver: false, nth: 1 }, undefined)).toBe(false);
    expect(isRegularJoin({ visits: 2, firstEver: false, nth: 1 }, memo({ previousNote: 'お礼済み' }))).toBe(true);
    expect(isRegularJoin({ visits: 2, firstEver: false }, memo({ favorite: true }))).toBe(true);
    // 再入室・初見は出さない
    expect(isRegularJoin({ visits: 10, firstEver: false, nth: 2 }, undefined)).toBe(false);
    expect(isRegularJoin({ visits: 1, firstEver: true, nth: 1 }, memo({ note: '常連' }))).toBe(false);
  });

  it('表示中に来た人は順番待ち(同じ人は重ねず、上限を超えたら古い順番待ちから捨てる)', () => {
    const v = (id: string) => makeRegularPop({ userId: id, nickname: id }, 6, undefined, undefined);
    let q = pushRegular(null, v('a'), 0);
    expect(q.current.userId).toBe('a');
    expect(q.untilMs).toBe(REGULAR_POPUP_MS);
    q = pushRegular(q, v('a'), 10);
    expect(q.waiting).toEqual([]);
    for (let i = 0; i < REGULAR_QUEUE_MAX + 2; i++) q = pushRegular(q, v(`w${i}`), 20);
    expect(q.waiting.map((w) => w.userId)).toEqual(Array.from({ length: REGULAR_QUEUE_MAX }, (_, i) => `w${i + 2}`));
    const n = nextRegular(q, 5000)!;
    expect(n.current.userId).toBe('w2');
    expect(n.untilMs).toBe(5000 + REGULAR_POPUP_MS);
    expect(nextRegular({ ...n, waiting: [] }, 6000)).toBeNull();
  });

  it('前回のメモ・📝・前回入室・よみがなを出す', () => {
    const pop = makeRegularPop({ userId: 'u', nickname: 'さるちゃん' }, 10, memo({ kana: 'さるちゃん', note: '12/23 誕生日', previousNote: '女の子、三年前手術してる' }), new Date(2026, 10, 7, 15).getTime());
    const html = renderToStaticMarkup(createElement(RegularToast, { queue: { current: pop, untilMs: Date.now() + REGULAR_POPUP_MS, waiting: [] }, showAvatars: false, onDone: () => {} }));
    expect(html).toContain('★10回目');
    expect(html).toContain('前回：女の子、三年前手術してる');
    expect(html).toContain('📝 12/23 誕生日');
    expect(html).toContain('前回 11/7');
    expect(html).toContain('前回入室：11月7日15時');
    expect(html).toContain('(さるちゃん)');
  });

  it('セッションは入室ごとに通知し、再入室には nth を付ける', async () => {
    const session = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    await session.whenReady();
    const got: JoinNotice[] = [];
    const off = session.onJoin((n) => got.push(n));
    try {
      const t = Date.now();
      session.ingest('roomInfo', { id_str: 'room' }, t);
      session.ingest('WebcastMemberMessage', { common: { msgId: 'j1', createTime: t }, user: { id: 'a', nickname: 'たろう' }, action: 1 }, t);
      session.ingest('WebcastMemberMessage', { common: { msgId: 'j2', createTime: t + 60_000 }, user: { id: 'a', nickname: 'たろう' }, action: 1 }, t + 60_000);
      expect(got.map((n) => [n.viewer.userId, n.nth])).toEqual([
        ['a', 1],
        ['a', 2],
      ]);
    } finally {
      off();
      session.disconnect();
    }
  });

  it('設定は既定 ON、boolean 以外は ON に戻す', () => {
    expect(DEFAULT_SETTINGS.regularPopup).toBe(true);
    expect(sanitize({ ...DEFAULT_SETTINGS, regularPopup: undefined as never }).regularPopup).toBe(true);
    expect(sanitize({ ...DEFAULT_SETTINGS, regularPopup: false }).regularPopup).toBe(false);
  });
});
