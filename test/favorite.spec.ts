import 'fake-indexeddb/auto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FeedList } from '../src/components/FeedList';
import { JoinDock } from '../src/components/JoinDock';
import { ViewersSheet } from '../src/components/ViewersSheet';
import { hasMemoContent, MemoBook, sanitizeMemo } from '../src/lib/memos';
import { LiveSession } from '../src/lib/session';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import type { JoinRow } from '../src/lib/feed';

const T = 1_785_240_000_000;

describe('お気に入り(MemoBook)', () => {
  it('お気に入りだけでも残り、メモの欄は空のまま・メモ扱いにはならない', () => {
    const b = new MemoBook();
    const r = b.set('u1', { favorite: true, nickname: 'A' }, T);
    expect(r).toMatchObject({ userId: 'u1', note: '', kana: '', favorite: true, nickname: 'A' });
    expect(hasMemoContent(b.get('u1'))).toBe(false);
    expect(b.drainDirty().put).toHaveLength(1);
  });

  it('省略した欄は保持する(★ を押してもメモは消えない・メモを直しても ★ は外れない)', () => {
    const b = new MemoBook([{ userId: 'u1', note: '誕生日', kana: 'たろう', previousNote: 'お礼', updatedMs: T }]);
    b.set('u1', { favorite: true }, T + 1);
    expect(b.get('u1')).toMatchObject({ note: '誕生日', kana: 'たろう', previousNote: 'お礼', favorite: true });
    b.set('u1', { note: 'ゲーム好き', kana: 'たろう' }, T + 2);
    expect(b.get('u1')?.favorite).toBe(true);
  });

  it('メモを削除しても ★ は残り、★ も外すと記録ごと消える', () => {
    const b = new MemoBook([{ userId: 'u1', note: 'a', kana: '', favorite: true, updatedMs: T }]);
    b.drainDirty();
    b.set('u1', { note: '', previousNote: '', kana: '' }, T + 1);
    expect(b.get('u1')).toMatchObject({ note: '', favorite: true });
    b.set('u1', { favorite: false }, T + 2);
    expect(b.get('u1')).toBeUndefined();
    expect(b.drainDirty().del).toEqual(['u1']);
  });

  it('★ を外してもメモがあれば残り、favorite は持たない', () => {
    const b = new MemoBook([{ userId: 'u1', note: 'a', kana: '', favorite: true, updatedMs: T }]);
    expect(b.set('u1', { favorite: false }, T + 1)).toEqual({ userId: 'u1', note: 'a', kana: '', updatedMs: T + 1 });
  });

  it('同じ状態を押し直しても dirty にならない', () => {
    const b = new MemoBook([{ userId: 'u1', note: '', kana: '', favorite: true, updatedMs: T }]);
    const v = b.view();
    b.set('u1', { favorite: true }, T + 1);
    expect(b.view()).toBe(v);
    expect(b.drainDirty().put).toEqual([]);
  });

  it('バックアップの読込: お気に入りだけの行も残し、true 以外は付けない', () => {
    expect(sanitizeMemo({ userId: 'u', favorite: true })).toEqual({ userId: 'u', note: '', kana: '', favorite: true, updatedMs: 0 });
    expect(sanitizeMemo({ userId: 'u', favorite: 'yes' })).toBeNull();
    expect(sanitizeMemo({ userId: 'u', note: 'a', favorite: 1 })?.favorite).toBeUndefined();
    const b = new MemoBook();
    expect(b.import([{ userId: 'u', favorite: true, updatedMs: T }], 'merge')).toBe(1);
    expect(b.get('u')?.favorite).toBe(true);
  });
});

describe('お気に入りの表示', () => {
  it('フィード・入室の枠・リスナー一覧の行に fav が付き、メモ数には数えない', async () => {
    const session = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    await session.whenReady();
    const fav = 'favorite-ui-fav';
    const other = 'favorite-ui-other';
    try {
      session.ingest('roomInfo', { id_str: 'favorite-room' });
      session.ingest('WebcastChatMessage', { common: { msgId: 'fv-c1' }, user: { id: fav, nickname: 'すき' }, content: 'やあ' });
      session.ingest('WebcastChatMessage', { common: { msgId: 'fv-c2' }, user: { id: other, nickname: 'ふつう' }, content: 'どうも' });
      session.setMemo(fav, { favorite: true });
      const snap = session.snapshot();
      expect(session.memoCount).toBe(0);

      const feed = renderToStaticMarkup(createElement(FeedList, { rows: snap.feed.rows, memos: snap.memos, tab: 'all', showAvatars: false, bigGiftDiamonds: 100, empty: '' }));
      expect(feed).toMatch(/class="row comment[^"]* fav[^"]*"[^>]*>(?:(?!<div class="row).)*すき/s);
      expect(feed).not.toMatch(/class="row comment[^"]* fav[^"]*"[^>]*>(?:(?!<div class="row).)*ふつう/s);
      expect(feed).not.toContain('has-memo');

      const join = (id: string, userId: string): JoinRow => ({ k: 'join', id, tsMs: T, viewer: { userId, nickname: userId }, visits: 2, firstEver: false });
      const dock = renderToStaticMarkup(createElement(JoinDock, { rows: [join('j1', fav), join('j2', other)], showAvatars: false, isFavorite: (id: string) => Boolean(snap.memos.get(id)?.favorite) }));
      expect(dock).toContain('class="row join dock-row fav"');
      expect(dock.match(/ fav"/g)).toHaveLength(1);

      const list = renderToStaticMarkup(createElement(ViewersSheet, { items: session.viewersForList(), showAvatars: false, onPick: () => {}, onClose: () => {} }));
      expect(list).toContain('class="vrow fav"');
      expect(list).toContain('メモ 0 件');
    } finally {
      session.setMemo(fav, { favorite: false });
    }
  });
});
