import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSession } from '../src/lib/session';
import { createFeedState } from '../src/lib/feed';
import { rankLikes } from '../src/lib/likes';
import { DEFAULT_SETTINGS } from '../src/lib/settings';

const demo = readFileSync(new URL('../src/fixtures/demo.ndjson', import.meta.url), 'utf8')
  .split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));

describe('demo session', () => {
  let session: LiveSession;

  beforeEach(async () => {
    vi.useFakeTimers();
    session = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    await session.whenReady();
  });

  afterEach(() => {
    session.disconnect();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('デモ開始時に前のチャットを消し、来店履歴は保持する', () => {
    session.ingest('WebcastChatMessage', {
      common: { msgId: 'live-chat' }, user: { id: 'real-viewer' }, content: '前のチャット',
    });
    expect(session.rows).toHaveLength(1);
    const knownViewers = session.snapshot().knownViewers;
    session.playDemo(demo);
    expect(session.snapshot().feed).toEqual(createFeedState());
    expect(session.snapshot().knownViewers).toBe(knownViewers);
  });

  it('完了後に再デモしても4行・1717ダイヤで、連打は同じ行を更新する', () => {
    for (let run = 0; run < 2; run++) {
      session.playDemo(demo);
      expect(session.snapshot().feed).toEqual(createFeedState());
      vi.advanceTimersByTime(4000);
      for (const [count, delay] of [[1, 350], [3, 350], [5, 350], [8, 0]]) {
        const gifts = session.rows.filter((row) => row.k === 'gift');
        expect(gifts).toHaveLength(1);
        expect(gifts[0]).toMatchObject({ giftName: 'Rose', count, diamonds: count });
        vi.advanceTimersByTime(delay!);
      }
      vi.advanceTimersByTime(10000);
      expect(session.snapshot().demo).toBe(false);
      expect(session.snapshot().feed).toMatchObject({ giftCount: 4, diamonds: 1717 });
      expect(session.rows.filter((row) => row.k === 'gift')).toHaveLength(4);
      expect(new Set(session.rows.map((row) => row.id)).size).toBe(session.rows.length);
    }
  });

  it('setMemo は snapshot.memos に載り、resetHistory 後も残る', async () => {
    session.setMemo('real-1', { note: '常連さん', kana: 'たろう', nickname: 'たろう' });
    expect(session.snapshot().memos.get('real-1')).toMatchObject({ note: '常連さん', kana: 'たろう' });
    expect(session.memoCount).toBe(1);
    await session.resetHistory();
    expect(session.snapshot().memos.get('real-1')?.note).toBe('常連さん');
    // 両方空にすると消える
    session.setMemo('real-1', { note: '', kana: '' });
    expect(session.snapshot().memos.get('real-1')).toBeUndefined();
    expect(session.memoCount).toBe(0);
  });

  it('デモ中のメモは使い捨てで、本物のメモとバックアップに残らない', async () => {
    session.setMemo('real-1', { note: '本物', kana: '' });
    session.playDemo(demo);
    // 見本のメモが見え、本物は見えない
    expect(session.snapshot().memos.get('4')?.note).toBeTruthy();
    expect(session.snapshot().memos.get('real-1')).toBeUndefined();
    session.setMemo('1', { note: 'デモで書いた', kana: '' });
    expect(session.snapshot().memos.get('1')?.note).toBe('デモで書いた');
    session.disconnect();
    expect(session.snapshot().memos.get('1')).toBeUndefined();
    expect(session.snapshot().memos.get('real-1')?.note).toBe('本物');
    const data = await session.exportData();
    expect(data.memos.map((m) => m.userId)).toEqual(['real-1']);
  });

  it('viewersForList は最近来た順で、メモを結合し、来店履歴の無いメモは末尾', () => {
    session.ingest('roomInfo', { id_str: 'r1' });
    session.ingest('WebcastChatMessage', { common: { msgId: 'c1' }, user: { id: 'a', nickname: 'A' }, content: 'x' }, 1000);
    session.ingest('WebcastChatMessage', { common: { msgId: 'c2' }, user: { id: 'b', nickname: 'B' }, content: 'y' }, 2000);
    session.setMemo('a', { note: 'メモA', kana: '' });
    session.setMemo('ghost', { note: '来店履歴なし', kana: '', nickname: 'G' });
    const list = session.viewersForList();
    expect(list.map((x) => x.userId)).toEqual(['b', 'a', 'ghost']);
    expect(list[1]!.memo?.note).toBe('メモA');
    expect(list[2]).toMatchObject({ visits: 0, nickname: 'G' });
  });

  it('連打途中で再デモしても古いタイマーと連打状態を引き継がない', () => {
    session.playDemo(demo);
    vi.advanceTimersByTime(4700);
    expect(session.snapshot().feed.diamonds).toBe(5);
    session.playDemo(demo);
    expect(session.snapshot().feed).toEqual(createFeedState());
    vi.advanceTimersByTime(15000);
    expect(session.snapshot().feed).toMatchObject({ giftCount: 4, diamonds: 1717 });
    expect(session.rows.filter((row) => row.k === 'gift')).toHaveLength(4);
  });

  it('デモのいいねが人ごとに集計され、ランキングになる', () => {
    session.playDemo(demo);
    vi.advanceTimersByTime(15000);
    const f = session.snapshot().feed;
    expect(f.likeCount).toBe(40);
    expect(f.likes.size).toBe(6);
    expect(f.likeRoomTotal).toBe(157);
    expect(rankLikes(f.likes, 3).map((e) => [e.viewer.nickname, e.taps])).toEqual([
      ['さくら🌸', 15],
      ['ゆな', 10],
      ['あお', 9],
    ]);
  });

  it('clearFeed は行だけ消し、いいね集計は残す', () => {
    session.ingest('WebcastChatMessage', { common: { msgId: 'c1' }, user: { id: 'v1' }, content: 'hi' });
    session.ingest('WebcastLikeMessage', { common: { msgId: 'l1' }, user: { id: 'v1' }, count: 4, total: '10' });
    session.ingest('WebcastLikeMessage', { common: { msgId: 'l2' }, user: { id: 'v1' }, count: 2, total: '12' });
    session.clearFeed();
    const f = session.snapshot().feed;
    expect(f.rows).toHaveLength(0);
    expect(f.likes.get('v1')?.taps).toBe(6);
    expect(f.likeCount).toBe(6);
  });
});
