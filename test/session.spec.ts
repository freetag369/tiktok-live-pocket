import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSession, type ScreenStore } from '../src/lib/session';
import { createFeedState, type ScreenItem, type ScreenMeta } from '../src/lib/feed';
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
    expect(session.snapshot().feed).toEqual({ ...createFeedState(), roomId: expect.stringMatching(/^demo-/) });
    expect(session.snapshot().knownViewers).toBe(knownViewers);
  });

  it('完了後に再デモしても4行・1717ダイヤで、連打は同じ行を更新する', () => {
    for (let run = 0; run < 2; run++) {
      session.playDemo(demo);
      expect(session.snapshot().feed).toEqual({ ...createFeedState(), roomId: expect.stringMatching(/^demo-/) });
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

  const chat = (id: string, room: string, msg: string) =>
    session.ingest('WebcastChatMessage', { common: { msgId: msg, roomId: room }, user: { id, nickname: id }, content: 'x' });
  const metaOf = (msg: string) => session.rows.find((r) => r.id === msg) as unknown as { visits: number; firstEver: boolean };

  it('roomInfo が無くても common.roomId で配信を数え、次の配信では 2回目', () => {
    chat('u1', 'roomA', 'a1');
    expect(session.roomInfo.roomId).toBe('roomA');
    expect(metaOf('a1')).toMatchObject({ visits: 1, firstEver: true });
    chat('u1', 'roomB', 'b1');
    expect(session.roomInfo.roomId).toBe('roomB');
    expect(metaOf('b1')).toMatchObject({ visits: 2, firstEver: false });
  });

  it('roomInfo で確定した部屋は、別の common.roomId で変わらない', () => {
    session.ingest('roomInfo', { data: { id_str: 'r1' } });
    chat('u1', 'other', 'c1');
    expect(session.roomInfo.roomId).toBe('r1');
  });

  it('読込前に届いたメッセージは読込後に数える', async () => {
    const s = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    s.ingest('roomInfo', { data: { id_str: 'r9' } });
    s.ingest('WebcastChatMessage', { common: { msgId: 'p1' }, user: { id: 'u9' }, content: 'x' });
    await s.whenReady();
    expect(s.roomInfo.roomId).toBe('r9');
    expect(s.rows).toHaveLength(1);
    expect(s.snapshot().knownViewers).toBe(1);
    s.disconnect();
  });

  it('連打途中で再デモしても古いタイマーと連打状態を引き継がない', () => {
    session.playDemo(demo);
    vi.advanceTimersByTime(4700);
    expect(session.snapshot().feed.diamonds).toBe(5);
    session.playDemo(demo);
    expect(session.snapshot().feed).toEqual({ ...createFeedState(), roomId: expect.stringMatching(/^demo-/) });
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

  it('🧹(resetScreen)は行だけ消し、いいね集計は残す', () => {
    session.ingest('WebcastChatMessage', { common: { msgId: 'c1' }, user: { id: 'v1' }, content: 'hi' });
    session.ingest('WebcastLikeMessage', { common: { msgId: 'l1' }, user: { id: 'v1' }, count: 4, total: '10' });
    session.ingest('WebcastLikeMessage', { common: { msgId: 'l2' }, user: { id: 'v1' }, count: 2, total: '12' });
    session.resetScreen();
    const f = session.snapshot().feed;
    expect(f.rows).toHaveLength(0);
    expect(f.likes.get('v1')?.taps).toBe(6);
    expect(f.likeCount).toBe(6);
  });
});

/** 画面の履歴の保存先(メモリ版)。node のテストには IndexedDB が無いので差し替える。 */
function memoryScreenStore(initial: { items?: ScreenItem[]; meta?: ScreenMeta | null } = {}) {
  const state = {
    items: new Map<string, ScreenItem>((initial.items ?? []).map((i) => [i.id, i])),
    meta: initial.meta ?? null,
    replaced: 0,
  };
  const store: ScreenStore = {
    async load() {
      return { items: [...state.items.values()], meta: state.meta };
    },
    async save(items, meta) {
      for (const it of items) {
        const prev = state.items.get(it.id);
        state.items.set(it.id, prev ? { ...it, seq: prev.seq } : it);
      }
      if (meta) state.meta = meta;
    },
    async replace(items, meta) {
      state.replaced++;
      state.items = new Map(items.map((i) => [i.id, i]));
      if (meta) state.meta = meta;
    },
    async remove(ids) {
      for (const id of ids) state.items.delete(id);
    },
  };
  return { store, state };
}

const chat = (id: string, text = 'x'): [string, unknown] => ['WebcastChatMessage', { common: { msgId: id }, user: { id: `u-${id}`, nickname: 'N' }, content: text }];

describe('画面の履歴', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const newSession = (store: ScreenStore) => new LiveSession(() => ({ ...DEFAULT_SETTINGS }), { screenStore: store });

  it('受信した行を積み、🧹 でストアごと空にする(集計は残る)', async () => {
    const { store, state } = memoryScreenStore();
    const session = newSession(store);
    await session.whenReady();
    session.ingest('roomInfo', { id_str: 'room-1' });
    session.ingest(...chat('c1'));
    session.ingest(...chat('c2'));
    await session.listArchive(); // 保存待ちを書き切る

    expect([...state.items.keys()].sort()).toEqual(['c1', 'c2']);
    expect(state.meta).toMatchObject({ roomId: 'room-1', commentCount: 2 });

    session.resetScreen();
    await session.listArchive();
    expect(session.rows).toHaveLength(0);
    expect(state.items.size).toBe(0);
    expect(state.replaced).toBe(1);
    // タブの数と 💎 は「この配信の合計」なので残る
    expect(session.snapshot().feed).toMatchObject({ commentCount: 2, roomId: 'room-1' });

    // リセットのあとに届いた行はちゃんと残る
    session.ingest(...chat('c3'));
    await session.listArchive();
    expect([...state.items.keys()]).toEqual(['c3']);
  });

  it('次に開いたとき同じ並びで戻り、同じ配信なら区切りなしで続く', async () => {
    const items: ScreenItem[] = [{ k: 'comment', id: 'c1', tsMs: 1000, viewer: { userId: 'a' }, text: 'まえの', visits: 1, firstEver: false, roomId: 'room-1', seq: 1 }];
    const meta: ScreenMeta = { roomId: 'room-1', commentCount: 7, joinCount: 2, giftCount: 1, diamonds: 30, seen: ['c1'], streaks: [] };
    const session = newSession(memoryScreenStore({ items, meta }).store);
    await session.whenReady();

    expect(session.rows.map((r) => r.id)).toEqual(['c1']);
    expect(session.snapshot().feed).toMatchObject({ roomId: 'room-1', commentCount: 7, diamonds: 30 });

    // 同じ配信につなぎ直す: 区切りは入らず、集計は続きから
    session.ingest('roomInfo', { id_str: 'room-1' });
    session.ingest(...chat('c2'));
    expect(session.snapshot().feed.rows.some((r) => r.k === 'room')).toBe(false);
    expect(session.snapshot().feed.commentCount).toBe(8);

    // 別の配信: 区切りが入り、集計はリセット。行は残る
    session.ingest('roomInfo', { id_str: 'room-2' });
    session.ingest(...chat('c3'));
    expect(session.snapshot().feed.rows.filter((r) => r.k === 'room')).toHaveLength(1);
    expect(session.snapshot().feed.commentCount).toBe(1);
    expect(session.rows.map((r) => r.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('読込前に届いた行は、復元した行を消さずに後ろへ続く', async () => {
    const items: ScreenItem[] = [{ k: 'comment', id: 'old', tsMs: 1000, viewer: { userId: 'a' }, text: 'ふるい', visits: 1, firstEver: false, roomId: 'room-1', seq: 1 }];
    const session = newSession(memoryScreenStore({ items }).store);
    session.ingest('roomInfo', { id_str: 'room-9' });
    session.ingest(...chat('live1'));
    await session.whenReady();
    // 復元 → 溜めていた分、の順で並ぶ。別配信なので境目に区切りが入る。
    expect(session.rows.map((r) => r.id)).toEqual(['old', 'live1']);
    expect(session.snapshot().feed.rows.filter((r) => r.k === 'room')).toHaveLength(1);
    expect(session.roomInfo.roomId).toBe('room-9');
  });

  it('デモは本物の画面を退避して流し、止めると戻る。デモ中の 🧹 はストアを触らない', async () => {
    const { store, state } = memoryScreenStore();
    const session = newSession(store);
    await session.whenReady();
    session.ingest('roomInfo', { id_str: 'room-1' });
    session.ingest(...chat('real1'));
    await session.listArchive();
    expect(state.items.size).toBe(1);

    session.playDemo(demo);
    expect(session.rows).toHaveLength(0);
    vi.advanceTimersByTime(30_000); // デモが自然に終わる(demo フラグは下りるが画面はデモのまま)
    expect(session.snapshot().demo).toBe(false);
    expect(session.rows.length).toBeGreaterThan(0);

    session.resetScreen();
    await session.listArchive();
    expect(state.replaced).toBe(0);
    expect([...state.items.keys()]).toEqual(['real1']);

    session.disconnect(); // デモを止めると本物の画面に戻る
    expect(session.rows.map((r) => r.id)).toEqual(['real1']);

    // 自然終了のあとに再デモしても本物は失わない
    session.playDemo(demo);
    vi.advanceTimersByTime(30_000);
    session.playDemo(demo);
    session.disconnect();
    expect(session.rows.map((r) => r.id)).toEqual(['real1']);
    expect([...state.items.keys()]).toEqual(['real1']);
  });
});
