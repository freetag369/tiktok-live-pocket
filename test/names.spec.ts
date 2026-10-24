import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { displayName, handleOf, hasVisibleChar, initialOf } from '../src/lib/names';
import { dockLabel } from '../src/components/JoinDock';
import { FeedRowView } from '../src/components/FeedRow';
import { Avatar } from '../src/components/Avatar';
import { followToastLabel, followerName } from '../src/lib/follow-toast';

/** PC 版 DB(2,953 人)で実際に見つかった「描けない文字だけ」のニックネーム。 */
const REAL_INVISIBLE = {
  'j241845': '\uFE0F', // 変異セレクタ単独
  'nlzxy_': '\uFFF4\uFFF4', // 未割当の文字
  '490nyan': '\u0F80\u0F72', // 土台の無いチベット結合母音
  'my0dd': '\u0651', // 土台の無いアラビア結合記号
};

describe('描ける文字の判定', () => {
  it('普通の名前・既定名・絵文字 1 文字は描ける', () => {
    expect(hasVisibleChar('たろう')).toBe(true);
    expect(hasVisibleChar('user28420669859')).toBe(true);
    expect(hasVisibleChar('🎁')).toBe(true);
    expect(hasVisibleChar('❤️')).toBe(true);
    expect(hasVisibleChar('é')).toBe(true); // 結合記号は土台の字があれば描ける
    expect(hasVisibleChar('_')).toBe(true);
  });

  it('空・空白・不可視文字・結合記号だけ・ハングル詰め物・点字空白は描けない', () => {
    expect(hasVisibleChar('')).toBe(false);
    expect(hasVisibleChar(undefined)).toBe(false);
    expect(hasVisibleChar(' \u3000')).toBe(false);
    for (const nick of Object.values(REAL_INVISIBLE)) expect(hasVisibleChar(nick), JSON.stringify(nick)).toBe(false);
    expect(hasVisibleChar('\u200B\u200D')).toBe(false);
    expect(hasVisibleChar('\u3164\u3164')).toBe(false);
    expect(hasVisibleChar('\u2800')).toBe(false);
  });
});

describe('表示名', () => {
  it('描けるニックネームはそのまま、描けなければ @ハンドル、それも無ければ ID', () => {
    expect(displayName({ userId: '1', nickname: 'たろう', uniqueId: 'taro' })).toBe('たろう');
    expect(displayName({ userId: '1', nickname: '🎁', uniqueId: 'gift' })).toBe('🎁');
    for (const [handle, nick] of Object.entries(REAL_INVISIBLE)) {
      expect(displayName({ userId: '1', nickname: nick, uniqueId: handle })).toBe(handle);
    }
    expect(displayName({ userId: '7', nickname: '\uFE0F' })).toBe('7');
  });

  it('メモに残した名前を次の候補にする(一覧・やり取り・シート)', () => {
    expect(displayName({ userId: '1', nickname: '\uFE0F' }, { nickname: 'たろう', uniqueId: 'taro' })).toBe('たろう');
    expect(displayName({ userId: '1', nickname: '\uFE0F' }, { nickname: '\uFE0F', uniqueId: 'taro' })).toBe('taro');
  });

  it('@ハンドルは名前と同じなら添えない', () => {
    const v = { userId: '1', nickname: '\uFE0F', uniqueId: 'j241845' };
    const name = displayName(v);
    expect(name).toBe('j241845');
    expect(handleOf(v, name)).toBe('');
    expect(handleOf({ userId: '1', nickname: 'たろう', uniqueId: 'taro' }, 'たろう')).toBe('@taro');
  });

  it('固定枠は @ハンドル / ID 付きで落とす', () => {
    expect(dockLabel({ userId: '1', nickname: '\uFE0F', uniqueId: 'j241845' })).toBe('@j241845');
    expect(dockLabel({ userId: '9', nickname: '\u0651' })).toBe('ID 9');
    expect(dockLabel({ userId: '1', nickname: '🎁' })).toBe('🎁');
  });

  it('フォローのトーストも同じ規則', () => {
    expect(followerName({ userId: '1', nickname: '\uFE0F', uniqueId: 'j241845' })).toBe('j241845');
    expect(followToastLabel(['j241845'])).toContain('j241845');
  });

  it('アバターの代替は絵文字を割らない', () => {
    expect(initialOf('🎁たろう')).toBe('🎁');
    expect(initialOf('たろう')).toBe('た');
    expect(initialOf('')).toBe('?');
    const html = renderToStaticMarkup(createElement(Avatar, { name: '🩵', enabled: false }));
    expect(html).toContain('🩵');
  });

  it('フィードの行は不可視の名前を @ハンドル(素のまま)で出す', () => {
    const row = { k: 'join' as const, id: 'j', tsMs: 0, viewer: { userId: '1', nickname: '\uFE0F', uniqueId: 'j241845' }, visits: 1, firstEver: true };
    const html = renderToStaticMarkup(createElement(FeedRowView, { row, showAvatars: false, bigGiftDiamonds: 1000 }));
    expect(html).toContain('<span class="who">j241845</span>');
  });
});
