import 'fake-indexeddb/auto';
import { deleteDB, openDB, type IDBPDatabase } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, loadDayRows, saveArchiveRows } from '../src/lib/db';
import { GIFT_SEEN_MAX, HIGHLIGHT_LOAD_TIMEOUT_MS, LiveSession, OPEN_TIMEOUT_MS, RESTORE_TIMEOUT_MS } from '../src/lib/session';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/settings';
import { dayRange, highlightMembers, isAction, likeBucketStart, likeRowId, type BoundedSet, type HighlightDay } from '../src/lib/highlights';
import type { ArchivedRow } from '../src/lib/archive';
import type { FeedRow, ScreenItem } from '../src/lib/feed';

/**
 * IndexedDB を使うハイライトのテスト(fake-indexeddb)。
 * fake-indexeddb は setImmediate で動くので、偽タイマーでは setImmediate を偽物にしない。
 */

const DB_NAME = 'tiktok-live-pocket';
const FAKE_TIMERS = { toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as Array<'Date' | 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'> };
const day = '2026-09-23';
const [start, end] = dayRange(day);
const NOON = start + 12 * 3600_000;

async function freshDb(): Promise<void> {
  await closeDb();
  await deleteDB(DB_NAME);
}

// ── 版上げ ──────────────────────────────────────────────────────────────

const visit = { userId: 'u1', visits: 7, lastRoomId: 'old-room', firstSeenMs: start - 86_400_000, lastSeenMs: start + 1000, nickname: 'たろう' };
const giftRec = { giftId: '5655', name: 'Rose', diamonds: 1, iconUrl: 'https://example.com/rose.png', updatedMs: start };
const memo = { userId: 'u1', note: '誕生日 3/4', kana: 'たろう', updatedMs: start };
const oldComment: ArchivedRow = { k: 'comment', id: 'old-c1', roomId: 'old-room', tsMs: start + 1000, viewer: { userId: 'u1', nickname: 'たろう' }, text: 'こんばんは', visits: 7, firstEver: false };
const oldGift: ArchivedRow = { k: 'gift', id: 'old-g1', roomId: 'old-room', tsMs: start + 2000, viewer: { userId: 'u1' }, giftId: '5655', giftName: 'Rose', count: 3, diamondEach: 1, diamonds: 3, streaking: false, visits: 7, firstEver: false };
const oldJoin: ArchivedRow = { k: 'join', id: 'old-j1', roomId: 'old-room', tsMs: start + 500, viewer: { userId: 'u2' }, visits: 1, firstEver: true };
const yesterday: ArchivedRow = { ...oldComment, id: 'old-c0', tsMs: start - 1000 };
const stream = { roomId: 'old-room', startedMs: start - 1000, endedMs: start + 2000, rows: 4, comments: 2, joins: 1, gifts: 1, diamonds: 3 };
const screenItem: ScreenItem = { ...oldComment, seq: 1 } as ScreenItem;
const screenMeta = { k: 'current', roomId: 'old-room', commentCount: 2, joinCount: 1, giftCount: 1, diamonds: 3, seen: ['old-c1'], streaks: [] };

/** 過去の版と同じ作り方でストアを作る(v1: 来店・ギフト、v2: メモ、v3: アーカイブ、v4: 画面の履歴)。 */
function oldSchema(db: IDBPDatabase, version: number, o: { byTs?: boolean } = {}): void {
  db.createObjectStore('visits', { keyPath: 'userId' });
  db.createObjectStore('gifts', { keyPath: 'giftId' });
  if (version >= 2) db.createObjectStore('memos', { keyPath: 'userId' });
  if (version >= 3) {
    const rows = db.createObjectStore('logRows', { keyPath: 'id' });
    rows.createIndex('byRoomTs', ['roomId', 'tsMs']);
    if (o.byTs) rows.createIndex('byTs', 'tsMs');
    db.createObjectStore('streams', { keyPath: 'roomId' });
  }
  if (version >= 4 && !o.byTs) {
    db.createObjectStore('screenRows', { keyPath: 'id' });
    db.createObjectStore('screenMeta', { keyPath: 'k' });
  }
}

async function seedOld(version: number, o: { byTs?: boolean } = {}): Promise<void> {
  const db = await openDB(DB_NAME, version, { upgrade: (d) => oldSchema(d, version, o) });
  await db.put('visits', visit);
  await db.put('gifts', giftRec);
  if (version >= 2) await db.put('memos', memo);
  if (version >= 3) {
    for (const r of [oldComment, oldGift, oldJoin, yesterday]) await db.put('logRows', r);
    await db.put('streams', stream);
  }
  if (version >= 4 && !o.byTs) {
    await db.put('screenRows', screenItem);
    await db.put('screenMeta', screenMeta);
  }
  db.close();
}

describe('IndexedDB の版上げ(v5)', () => {
  beforeEach(freshDb);
  afterEach(closeDb);

  it('新しく開くと v5 で、全部のストアと日付の索引がある', async () => {
    const db = await getDb();
    expect(db.version).toBe(5);
    expect([...db.objectStoreNames].sort()).toEqual(['gifts', 'logRows', 'memos', 'screenMeta', 'screenRows', 'streams', 'visits']);
    expect([...db.transaction('logRows').store.indexNames].sort()).toEqual(['byRoomTs', 'byTs']);
    expect(await loadDayRows(start, end)).toEqual([]);
  });

  it('v4 の DB(画面の履歴・アーカイブ・メモ・来店)を上げても全件そのまま、日付で引ける', async () => {
    await seedOld(4);
    const db = await getDb();
    expect(db.version).toBe(5);
    expect(await db.getAll('visits')).toEqual([visit]);
    expect(await db.getAll('gifts')).toEqual([giftRec]);
    expect(await db.getAll('memos')).toEqual([memo]);
    expect(await db.getAll('streams')).toEqual([stream]);
    expect(await db.getAll('screenRows')).toEqual([screenItem]);
    expect(await db.get('screenMeta', 'current')).toEqual(screenMeta);
    expect((await db.getAll('logRows')).sort((a, b) => a.tsMs - b.tsMs)).toEqual([yesterday, oldJoin, oldComment, oldGift]);
    expect(await db.getAllFromIndex('logRows', 'byRoomTs')).toHaveLength(4);
    // 新しい索引は既存の行からも作られている
    expect(await loadDayRows(start, end)).toEqual([oldJoin, oldComment, oldGift]);
    expect(await loadDayRows(start - 86_400_000, start)).toEqual([yesterday]);
  });

  it('v3 の DB(アーカイブまで)を上げても全件そのまま、画面の履歴のストアも増える', async () => {
    await seedOld(3);
    const db = await getDb();
    expect(db.version).toBe(5);
    expect(await db.getAll('visits')).toEqual([visit]);
    expect(await db.getAll('memos')).toEqual([memo]);
    expect(await db.getAll('gifts')).toEqual([giftRec]);
    expect(await db.getAll('streams')).toEqual([stream]);
    expect(await db.getAll('logRows')).toHaveLength(4);
    expect(await db.getAll('screenRows')).toEqual([]);
    expect(await loadDayRows(start, end)).toEqual([oldJoin, oldComment, oldGift]);
  });

  it('v1 の DB と、索引だけ先に付いた v4(未公開の試作)からも上がる', async () => {
    await seedOld(1);
    let db = await getDb();
    expect(db.version).toBe(5);
    expect(await db.getAll('visits')).toEqual([visit]);
    expect([...db.objectStoreNames]).toContain('logRows');
    await freshDb();
    await seedOld(4, { byTs: true });
    db = await getDb();
    expect(db.version).toBe(5);
    expect([...db.objectStoreNames]).toEqual(expect.arrayContaining(['screenRows', 'screenMeta']));
    expect(await loadDayRows(start, end)).toEqual([oldJoin, oldComment, oldGift]);
  });

  it('v4 の DB を上げたあと、セッションが画面の履歴と来店回数をそのまま使う', async () => {
    await seedOld(4);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOON);
    const s = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    try {
      await s.whenReady();
      expect(s.rows.map((r) => r.id)).toEqual(['old-c1']);
      expect(s.snapshot().memos.get('u1')?.note).toBe('誕生日 3/4');
      expect(s.snapshot().knownViewers).toBe(1);
      expect((await s.highlightsForDay(day)).map((r) => r.id)).toEqual(['old-g1', 'old-c1']);
      await s.exportData();
    } finally {
      s.disconnect();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

// ── 版上げが長引いた起動 ────────────────────────────────────────────────

describe('版上げが長引いた起動(v4 → v5)', () => {
  let holder: IDBPDatabase | null = null;

  beforeEach(freshDb);
  afterEach(async () => {
    holder?.close();
    holder = null;
    vi.clearAllTimers();
    vi.useRealTimers();
    await closeDb();
  });

  /** v4 の DB を作り、古い版の接続を開いたままにして v5 の版上げを止めておく(行の多い索引づくりの代わり)。 */
  async function holdUpgrade(): Promise<void> {
    await seedOld(4);
    holder = await openDB(DB_NAME, 4);
  }
  function releaseUpgrade(): void {
    holder?.close();
    holder = null;
  }
  const chatBy = (s: LiveSession, id: string, user: string) => s.ingest('WebcastChatMessage', { common: { msgId: id }, user: { id: user, nickname: user === 'u1' ? 'たろう' : undefined }, content: id });

  it('索引づくりが RESTORE_TIMEOUT_MS を超えても、受信は読み終えるまで溜めて保存済みの来店・画面の履歴から数える', async () => {
    await holdUpgrade();
    vi.useFakeTimers(FAKE_TIMERS);
    vi.setSystemTime(NOON);
    const s = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    try {
      vi.advanceTimersByTime(RESTORE_TIMEOUT_MS + 1000);
      s.ingest('roomInfo', { id_str: 'new-room' });
      chatBy(s, 'c-new', 'u1');
      vi.advanceTimersByTime(3000); // 1 秒ごとの保存が何度か走る
      expect(s.rows).toEqual([]);
      releaseUpgrade();
      await s.whenReady();
      // 保存してあった画面の後ろに続く。u1 は保存済みの 7 回から数えて 8 回目
      expect(s.rows.map((r) => r.id)).toEqual(['old-c1', 'c-new']);
      expect(s.rows[1]).toMatchObject({ visits: 8, firstEver: false });
      const out = await s.exportData();
      expect(out.visits.find((v) => v.userId === 'u1')).toMatchObject({ visits: 8, lastRoomId: 'new-room', firstSeenMs: visit.firstSeenMs, nickname: 'たろう' });
      const db = await getDb();
      expect(db.version).toBe(5);
      expect(await db.get('visits', 'u1')).toMatchObject({ visits: 8, firstSeenMs: visit.firstSeenMs });
      expect(await db.getAll('memos')).toEqual([memo]);
      expect(await db.getAll('gifts')).toEqual([giftRec]);
      // 画面の履歴: 元の行は残り、新しい配信の分が足される(集計は新しい配信のもの)
      expect((await db.getAll('screenRows')).map((it) => it.id)).toEqual(expect.arrayContaining(['old-c1', 'c-new']));
      expect(await db.get('screenMeta', 'current')).toMatchObject({ roomId: 'new-room', commentCount: 1 });
      expect(await loadDayRows(start, end)).toEqual(expect.arrayContaining([oldJoin, oldComment, oldGift]));
    } finally {
      s.disconnect();
    }
  });

  it('開くのが OPEN_TIMEOUT_MS を超えて受信を先に流しても、保存済みの来店・カタログ・メモ・画面の履歴を仮の値で上書きしない', async () => {
    await holdUpgrade();
    const u2 = { userId: 'u2', visits: 3, lastRoomId: 'old-room', firstSeenMs: start - 5 * 86_400_000, lastSeenMs: start, nickname: 'はなこ' };
    await holder!.put('visits', u2);
    vi.useFakeTimers(FAKE_TIMERS);
    vi.setSystemTime(NOON);
    const s = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    try {
      s.ingest('roomInfo', { id_str: 'room-a' });
      vi.advanceTimersByTime(OPEN_TIMEOUT_MS); // 見切って受信を流す
      // 先に流した間に見かけた人(u2 は前の部屋だけ)は、仮のカウンタで visits:1 になっている
      chatBy(s, 'c-a', 'u2');
      s.ingest('roomInfo', { id_str: 'new-room' });
      chatBy(s, 'c-late', 'u1');
      // 画像の無い tick(保存済みの画像を空で潰さない)と、まだ知らないギフト
      s.ingest('WebcastGiftMessage', { common: { msgId: 'g-late' }, user: { id: 'u1' }, giftId: '5655', gift: { name: 'Rose', type: 1, diamondCount: 1 }, repeatCount: 1, repeatEnd: 1 });
      s.ingest('WebcastGiftMessage', { common: { msgId: 'g-new' }, user: { id: 'u1' }, giftId: '9999', gift: { name: 'Doughnut', type: 1, diamondCount: 30, image: { url_list: ['https://example.com/doughnut.png'] } }, repeatCount: 1, repeatEnd: 1 });
      s.setMemo('u9', { note: '先に書いたメモ', kana: '' });
      vi.advanceTimersByTime(3000); // 1 秒ごとの保存が何度か走る(来店・カタログ・メモ・画面は書かない)
      expect(s.rows.map((r) => r.k)).toEqual(['comment', 'comment', 'gift', 'gift']);
      releaseUpgrade();
      await s.whenReady();
      // 仮のカウンタの部屋を引き継ぐので、読み終えた後の人も数えられる
      chatBy(s, 'c-u4', 'u4');
      const out = await s.exportData();
      expect(out.visits.find((v) => v.userId === 'u1')).toMatchObject({ visits: 8, lastRoomId: 'new-room', firstSeenMs: visit.firstSeenMs, nickname: 'たろう' });
      expect(out.visits.find((v) => v.userId === 'u4')).toMatchObject({ visits: 1, lastRoomId: 'new-room' });
      // 前の部屋だけで見かけた人は数え直せないが、保存済みの記録は仮の visits:1 で上書きしない
      expect(out.visits.find((v) => v.userId === 'u2')).toEqual(u2);
      expect(out.gifts.sort((a, b) => a.giftId.localeCompare(b.giftId))).toEqual([
        expect.objectContaining({ giftId: '5655', iconUrl: giftRec.iconUrl }),
        expect.objectContaining({ giftId: '9999', name: 'Doughnut', diamonds: 30 }),
      ]);
      expect(out.memos).toEqual(expect.arrayContaining([memo, expect.objectContaining({ userId: 'u9', note: '先に書いたメモ' })]));
      const db = await getDb();
      expect(await db.get('visits', 'u1')).toMatchObject({ visits: 8, firstSeenMs: visit.firstSeenMs });
      expect(await db.get('visits', 'u2')).toEqual(u2);
      expect(await db.get('gifts', '5655')).toEqual(giftRec);
      expect(await db.get('gifts', '9999')).toMatchObject({ name: 'Doughnut' });
      expect(await db.get('memos', 'u1')).toEqual(memo);
      expect(await db.get('memos', 'u9')).toMatchObject({ note: '先に書いたメモ' });
      // 先に流した画面には戻せないので、保存してあった画面は次の起動で戻るようそのまま残す
      expect(await db.getAll('screenRows')).toEqual([screenItem]);
      expect(await db.get('screenMeta', 'current')).toEqual(screenMeta);
      // 🧹 でストアをいまの画面に置き換えたら、そこから画面の履歴を書く
      s.resetScreen();
      chatBy(s, 'c-after', 'u1');
      await s.exportData();
      expect((await db.getAll('screenRows')).map((it) => it.id)).toEqual(['c-after']);
      expect(await db.get('screenMeta', 'current')).toMatchObject({ roomId: 'new-room', commentCount: 3, giftCount: 2 });
    } finally {
      s.disconnect();
    }
  });
});

describe('日付の検索(loadDayRows)', () => {
  beforeEach(freshDb);
  afterEach(closeDb);

  it('ページごとに読み、同じ時刻がページをまたいでも 1 回ずつ返す。keep で入室を読みながら捨てる', async () => {
    const comment = (id: string, tsMs: number): FeedRow => ({ k: 'comment', id, tsMs, viewer: { userId: 'u1' }, text: id, visits: 1, firstEver: false });
    const join = (id: string, tsMs: number): FeedRow => ({ k: 'join', id, tsMs, viewer: { userId: 'u2' }, visits: 1, firstEver: false });
    const t = NOON;
    const rows: FeedRow[] = [
      comment('a1', t), comment('a2', t), comment('a3', t), comment('a4', t), comment('a5', t), // 1 つの時刻に 1 ページ以上
      join('b1', t + 1), comment('b2', t + 1),
      comment('c1', t + 2), join('c2', t + 2), join('c3', t + 2), // ページの境目をまたぐ
      join('d1', t + 3),
      comment('e1', t + 4),
      comment('before', start - 1),
      comment('after', end),
    ];
    await saveArchiveRows('r1', rows, {});
    const inDay = rows.filter((r) => r.tsMs >= start && r.tsMs < end).map((r) => r.id);
    for (const page of [1, 2, 3, 4, 100]) {
      expect((await loadDayRows(start, end, undefined, page)).map((r) => r.id)).toEqual(inDay);
      expect((await loadDayRows(start, end, isAction, page)).map((r) => r.id)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'b2', 'c1', 'e1']);
    }
  });
});

// ── セッション ──────────────────────────────────────────────────────────

let session: LiveSession;
let settings: Settings;
const make = (o: { highlightMemoryMax?: number } = {}) => new LiveSession(() => settings, o);

function chat(id: string, o: { user?: string; now?: number; roomId?: string } = {}) {
  session.ingest('WebcastChatMessage', { common: { msgId: id, ...(o.roomId ? { roomId: o.roomId } : {}) }, user: { id: o.user ?? 'u1', nickname: 'テスト' }, content: id }, o.now ?? Date.now());
}
function like(id: string, count: number, o: { user?: string; now?: number } = {}) {
  session.ingest('WebcastLikeMessage', { common: { msgId: id }, user: { id: o.user ?? 'u1' }, likeCount: count }, o.now ?? Date.now());
}
function gift(id: string, count: number, ended: boolean, o: { user?: string; group?: string } = {}) {
  session.ingest('WebcastGiftMessage', { common: { msgId: id }, user: { id: o.user ?? 'u1' }, giftId: '5655', gift: { name: 'Rose', type: 1, diamondCount: 1 }, groupId: o.group ?? 'combo', repeatCount: count, repeatEnd: ended ? 1 : 0 });
}
function follow(id: string, user = 'u1') {
  session.ingest('WebcastSocialMessage', { common: { msgId: id, displayText: { key: 'pm_main_follow_message_viewer_2' } }, user: { id: user } });
}
async function restart(o: { highlightMemoryMax?: number } = {}) {
  await session.exportData();
  session.disconnect();
  session = make(o);
  await session.whenReady();
}
const likeRows = (rows: FeedRow[]) => rows.filter((r): r is Extract<FeedRow, { k: 'like' }> => r.k === 'like');

describe('ハイライト(保存とセッション)', () => {
  beforeEach(async () => {
    await freshDb();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOON);
    settings = { ...DEFAULT_SETTINGS, archiveEnabled: true, archiveKeepStreams: 30 };
    session = make();
    await session.whenReady();
    session.ingest('roomInfo', { id_str: 'r1' });
  });

  afterEach(async () => {
    await session.exportData();
    session.disconnect();
    vi.clearAllTimers();
    vi.useRealTimers();
    await closeDb();
  });

  it('前回は再起動・来店リセット後も残り、アーカイブ用メモはデモから分離される', async () => {
    session.setMemo('4', { note: '', kana: '', previousNote: '本物のお礼' });
    await restart();
    expect(session.getMemo('4')?.previousNote).toBe('本物のお礼');
    expect(session.viewersForList().find((v) => v.userId === '4')?.memo?.previousNote).toBe('本物のお礼');
    await session.resetHistory();
    expect(session.getMemo('4')?.previousNote).toBe('本物のお礼');
    session.playDemo([{ o: 0, type: 'WebcastChatMessage', data: { common: { msgId: 'demo-previous' }, user: { id: '4' }, content: 'デモ' } }]);
    session.setMemo('4', { note: '', kana: '', previousNote: 'デモのお礼' });
    expect(session.snapshot().memos.get('4')?.previousNote).toBe('デモのお礼');
    expect(session.snapshot().archiveMemos.get('4')?.previousNote).toBe('本物のお礼');
    expect((await session.exportData()).memos.find((m) => m.userId === '4')?.previousNote).toBe('本物のお礼');
  });

  it('いいねは (配信, 人, 1 分) ごとに 1 行。保存を何度くり返しても合計を二重に数えない', async () => {
    like('l1', 4, { now: NOON + 1000 });
    await session.exportData();
    like('l2', 6, { now: NOON + 20_000 });
    await session.exportData();
    await session.exportData();
    like('l3', 5, { now: NOON + 61_000 });
    like('l4', 2, { user: 'u2', now: NOON + 62_000 });
    const rows = likeRows(await session.loadArchivedStream('r1'));
    expect(rows.map((r) => [r.id, r.count])).toEqual([
      [likeRowId('r1', 'u1', likeBucketStart(NOON)), 10],
      [likeRowId('r1', 'u1', likeBucketStart(NOON + 60_000)), 5],
      [likeRowId('r1', 'u2', likeBucketStart(NOON + 60_000)), 2],
    ]);
    expect(rows[0]!.tsMs).toBe(NOON + 20_000);
    // 配信の集計: いいねの行は 1 行ずつ(上書きで増えない)。コメント・ギフトの数には入らない。
    const [s] = await session.listArchive();
    expect(s).toMatchObject({ roomId: 'r1', rows: 3, comments: 0, gifts: 0, diamonds: 0 });
    // u2 が最後(NOON+62s)なので先。u1 は 2 行の合計
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ likes: 2 }, { likes: 15 }]);
    // 画面の行・画面の履歴には入らず、いいねランキングは今まで通り
    expect(session.rows).toEqual([]);
    const f = session.snapshot().feed;
    expect(f.likeCount).toBe(17);
    expect(f.likes.get('u1')?.taps).toBe(15);
    const db = await getDb();
    expect(await db.getAll('screenRows')).toEqual([]);
  });

  it('開き直しても同じ 1 分のいいねは保存済みの行に足し、再送は数えない', async () => {
    like('l1', 10, { now: NOON + 1000 });
    chat('c1');
    await restart();
    session.ingest('roomInfo', { id_str: 'r1' });
    like('l1', 10, { now: NOON + 1000 }); // 再接続のバックログ再送
    chat('c1');
    like('l2', 5, { now: NOON + 30_000 });
    const rows = likeRows(await session.loadArchivedStream('r1'));
    expect(rows.map((r) => r.count)).toEqual([15]);
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ comments: 1, likes: 15 }]);
    expect(session.rows.some((r) => r.k === 'like')).toBe(false);
  });

  it('保存できた行はメモリから外し、保存 OFF・部屋不明の行だけ残す', async () => {
    chat('c1');
    like('l1', 3);
    gift('g1', 1, false);
    follow('f1');
    session.ingest('WebcastMemberMessage', { common: { msgId: 'j1' }, user: { id: 'u9' }, action: 1 });
    // 入室は数えない。いいねは 1 行
    expect(session.highlightRowsInMemory).toBe(4);
    await session.exportData();
    expect(session.highlightRowsInMemory).toBe(0);
    // 保存済みでも見える
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ comments: 1, likes: 3, gifts: 1, follows: 1 }]);

    // 連打の続きは保存済みの行を更新する(メモリには保存待ちの間だけ)
    gift('g2', 6, true);
    expect(session.highlightRowsInMemory).toBe(1);
    await session.exportData();
    expect(session.highlightRowsInMemory).toBe(0);
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ gifts: 6 }]);

    settings = { ...settings, archiveEnabled: false };
    chat('c2');
    like('l2', 2);
    await session.exportData();
    expect(session.highlightRowsInMemory).toBe(2);
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ comments: 2, likes: 5, gifts: 6 }]);

    // 部屋が分からないうちの行(roomInfo 前)も保存しないのでメモリに残す
    settings = { ...settings, archiveEnabled: true };
    await restart();
    chat('no-room');
    await session.exportData();
    expect(session.roomInfo.roomId).toBe('');
    expect(session.highlightRowsInMemory).toBe(1);
    expect((await session.highlightsForDay(day)).map((r) => [r.roomId, r.id])).toContainEqual(['', 'no-room']);
  });

  it('開いている日は IndexedDB を読み直さず受信を重ね、保存をまたいでもいいねを数えすぎない', async () => {
    like('l0', 1);
    await session.exportData();
    const seen: { view?: HighlightDay; changes: number } = { changes: 0 };
    const stop = session.watchHighlightDay(day, (v) => {
      seen.view = v;
      seen.changes++;
    });
    await session.exportData(); // 読み込みは保存の列に並ぶ
    const view = seen.view!;
    expect(view.loaded).toBe(true);
    // セッションを通さずに書いた行は、読み直すまで出ない(= 受信のたびには読まない)
    await saveArchiveRows('elsewhere', [{ k: 'comment', id: 'x1', tsMs: NOON, viewer: { userId: 'ux' }, text: 'x', visits: 1, firstEver: false }], {});
    for (let i = 0; i < 30; i++) {
      like(`l${i + 1}`, 2, { now: NOON + i * 1000 });
      if (i % 7 === 0) await session.exportData();
    }
    chat('c1');
    await session.exportData();
    const likesOf = (rows: ArchivedRow[]) => rows.filter((r) => r.k === 'like').reduce((n, r) => n + (r.k === 'like' ? r.count : 0), 0);
    expect(likesOf(view.list())).toBe(61);
    expect(view.list().some((r) => r.id === 'x1')).toBe(false);
    expect(seen.changes).toBeGreaterThan(30);
    const saved = likeRows(await session.loadArchivedStream('r1'));
    expect(saved.reduce((n, r) => n + r.count, 0)).toBe(61);
    stop();

    // アーカイブを書き換える操作(ここでは存在しない配信の削除)で世代が上がり、読み直すと出る
    const gen = session.snapshot().archiveGeneration;
    await session.deleteArchivedStream('nothing');
    expect(session.snapshot().archiveGeneration).toBe(gen + 1);
    const rows = await session.highlightsForDay(day);
    expect(rows.some((r) => r.id === 'x1')).toBe(true);
    expect(likesOf(rows)).toBe(61);
  });

  it('同日の複数配信をまとめ、日付の範囲で検索する', async () => {
    chat('yesterday', { now: start - 1 });
    chat('today', { now: start });
    chat('tomorrow', { now: end });
    await session.exportData();
    session.ingest('roomInfo', { id_str: 'r2' });
    chat('second-room', { now: start + 1 });
    expect((await session.highlightsForDay(day)).map((r) => r.id)).toEqual(['second-room', 'today']);
    expect((await session.highlightsForDay('2026-09-22')).map((r) => r.id)).toEqual(['yesterday']);
    expect((await session.highlightsForDay('2026-09-24')).map((r) => r.id)).toEqual(['tomorrow']);
  });

  it('500 行超過と 🧹 の後も履歴と連続ギフトを保持する', async () => {
    gift('g1', 1, false);
    for (let i = 0; i < 501; i++) chat(`c${i}`);
    session.resetScreen();
    gift('g2', 8, true);
    await session.exportData();
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ comments: 501, gifts: 8 }]);
    expect((await session.loadArchivedStream('r1')).find((r) => r.k === 'gift')).toMatchObject({ id: 'g1', count: 8 });
  });

  it('保存 OFF の記録は起動中だけで、アーカイブには残らない', async () => {
    settings = { ...settings, archiveEnabled: false };
    chat('temporary');
    like('temporary-like', 3);
    expect(await session.highlightsForDay(day)).toHaveLength(2);
    expect((await session.exportData({ includeArchive: true })).archive?.rows).toHaveLength(0);
    await restart();
    expect(await session.highlightsForDay(day)).toEqual([]);
  });

  it('重複表(seen)が溢れた後の連打ギフトの再送も二重に数えない。ギフトの重複表は上限つきで配信ごとに空になる', async () => {
    settings = { ...settings, archiveEnabled: false };
    gift('g1', 1, false);
    gift('g2', 8, true);
    for (let i = 0; i < 5001; i++) like(`l${i}`, 1, { now: NOON + i });
    gift('g2', 8, true);
    expect(session.rows.filter((r) => r.k === 'gift')).toHaveLength(1);
    expect(session.snapshot().feed.diamonds).toBe(8);
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ gifts: 8, likes: 5001 }]);

    const giftSeen = () => (session as unknown as { giftSeen: BoundedSet }).giftSeen;
    for (let i = 0; i < GIFT_SEEN_MAX + 50; i++) gift(`solo${i}`, 1, true, { group: `grp${i}` });
    expect(giftSeen().size).toBe(GIFT_SEEN_MAX);
    session.ingest('roomInfo', { id_str: 'r2' });
    expect(giftSeen().size).toBe(0);
  });

  it('長い配信でもメモリの行は増え続けない(保存できた分は捨て、保存 OFF でも上限で止まる)', async () => {
    // 8 時間ぶんのいいね・コメントを 1 分ずつ流し、1 秒ごとの保存に相当する exportData を挟む
    for (let m = 0; m < 480; m++) {
      const t = NOON - 6 * 3600_000 + m * 60_000;
      for (let u = 0; u < 5; u++) like(`l${m}-${u}`, 3, { user: `u${u}`, now: t + u });
      chat(`c${m}`, { now: t + 10 });
      if (m % 60 === 59) {
        await session.exportData();
        expect(session.highlightRowsInMemory).toBe(0);
      }
    }
    await session.exportData();
    expect(session.highlightRowsInMemory).toBe(0);
    const members = highlightMembers(await session.highlightsForDay(day));
    expect(members.reduce((n, m) => n + m.likes, 0)).toBe(480 * 5 * 3);
    expect(likeRows(await session.loadArchivedStream('r1'))).toHaveLength(480 * 5);

    expect(session.highlightMemoryTrimmed).toBe(false);

    settings = { ...settings, archiveEnabled: false };
    await restart({ highlightMemoryMax: 100 });
    session.ingest('roomInfo', { id_str: 'r1' });
    for (let i = 0; i < 100; i++) chat(`off${i}`, { now: NOON + i });
    expect(session.highlightMemoryTrimmed).toBe(false);
    for (let i = 100; i < 1000; i++) chat(`off${i}`, { now: NOON + i });
    expect(session.highlightRowsInMemory).toBe(100);
    // 捨てたことはハイライトに出す(全消去まで)
    expect(session.highlightMemoryTrimmed).toBe(true);
    // 古い方から捨てる
    const shown = (await session.highlightsForDay(day)).filter((r) => r.id.startsWith('off'));
    expect(shown).toHaveLength(100);
    expect(shown[0]!.id).toBe('off999');
    expect(shown[99]!.id).toBe('off900');
    await session.clearArchive();
    expect(session.highlightMemoryTrimmed).toBe(false);
  });

  it('バックアップの統合では保存値が古いメモリ値に隠れず、何度取り込んでもいいねは増えない', async () => {
    like('l1', 3);
    const backup = await session.exportData({ includeArchive: true });
    const archive = backup.archive!;
    archive.rows = archive.rows.map((row) => (row.k === 'like' ? { ...row, count: 12 } : row));
    await session.importData({ ...backup, archive, mode: 'merge' });
    await session.importData({ ...backup, archive, mode: 'merge' });
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ likes: 12 }]);
    const [s] = await session.listArchive();
    expect(s).toMatchObject({ rows: 1 });

    // 保存 OFF でメモリだけにある行も、取り込んだ行が勝つ
    settings = { ...settings, archiveEnabled: false };
    chat('c-memory');
    const withComment = { ...archive, rows: [...archive.rows, { k: 'comment', id: 'c-memory', roomId: 'r1', tsMs: NOON, viewer: { userId: 'u1' }, text: '取り込んだ本文', visits: 1, firstEver: false } as ArchivedRow] };
    await session.importData({ ...backup, archive: withComment, mode: 'merge' });
    expect((await session.highlightsForDay(day)).find((r) => r.id === 'c-memory')).toMatchObject({ text: '取り込んだ本文' });
  });

  it('配信の削除と全消去で、メモリにも履歴を残さない', async () => {
    chat('c1');
    settings = { ...settings, archiveEnabled: false };
    chat('c-off');
    const gen = session.snapshot().archiveGeneration;
    await session.deleteArchivedStream('r1');
    expect(session.snapshot().archiveGeneration).toBe(gen + 1);
    expect(await session.highlightsForDay(day)).toEqual([]);
    settings = { ...settings, archiveEnabled: true };
    chat('c2');
    await session.exportData();
    chat('c3');
    await session.clearArchive();
    expect(session.snapshot().archiveGeneration).toBe(gen + 2);
    expect(await session.highlightsForDay(day)).toEqual([]);
    expect(await session.listArchive()).toEqual([]);
  });

  it('保持数を超えたアーカイブは起動時に消え、ハイライトからも消える', async () => {
    await session.exportData();
    const row: FeedRow = { k: 'comment', id: 'old', tsMs: start, viewer: { userId: 'u1' }, text: 'old', visits: 1, firstEver: false };
    await saveArchiveRows('old', [row], {});
    await saveArchiveRows('new', [{ ...row, id: 'new', tsMs: start + 1 }], {});
    settings = { ...settings, archiveKeepStreams: 1 };
    await restart();
    expect((await session.highlightsForDay(day)).map((r) => r.id)).toEqual(['new']);
  });

  it('デモは再生中だけデモの行(今日の日付)を見せ、終わると本物に戻る。保存・バックアップには混ざらない', async () => {
    chat('real');
    session.playDemo([
      { o: 0, type: 'WebcastLikeMessage', data: { common: { msgId: 'demo-like', createTime: '1785240000' }, user: { id: 'demo-user' }, likeCount: 7 } },
      { o: 0, type: 'WebcastChatMessage', data: { common: { msgId: 'demo-chat', createTime: '1785240000' }, user: { id: 'demo-user' }, content: 'デモ' } },
      { o: 5000, type: 'WebcastChatMessage', data: { common: { msgId: 'demo-chat2', createTime: '1785240001' }, user: { id: 'demo-user2' }, content: 'デモ2' } },
    ]);
    vi.advanceTimersByTime(100);
    expect(session.snapshot().demo).toBe(true);
    const demoRows = await session.highlightsForDay(day);
    expect(demoRows.map((r) => r.k).sort()).toEqual(['comment', 'like']);
    expect(demoRows.find((r) => r.k === 'like')).toMatchObject({ count: 7 });
    expect(demoRows.some((r) => r.id === 'real')).toBe(false);
    expect((await session.exportData({ includeArchive: true })).archive?.rows.map((r) => r.id)).toEqual(['real']);
    expect(session.highlightRowsInMemory).toBe(0);

    vi.advanceTimersByTime(10_000); // デモが自然に終わる
    expect(session.snapshot().demo).toBe(false);
    expect((await session.highlightsForDay(day)).map((r) => r.id)).toEqual(['real']);
    session.stopDemo();
    expect((await session.highlightsForDay(day)).map((r) => r.id)).toEqual(['real']);
  });

  it('デモが自然に終わった後のハイライトは本物の行と本物のメモを使い、そこで書いたメモは接続・切断の後も残る', async () => {
    session.setMemo('real-user', { note: 'existing real memo', kana: 'ほんもの' });
    chat('real', { user: 'real-user' });
    await session.exportData();
    session.playDemo([{ o: 0, type: 'WebcastChatMessage', data: { common: { msgId: 'demo-chat' }, user: { id: 'demo-user' }, content: 'デモ' } }]);
    vi.advanceTimersByTime(100);
    let snap = session.snapshot();
    expect(snap.demo).toBe(true);
    // デモ中はハイライトもデモの帳(本物のメモは出さない)。書いても使い捨て
    expect(snap.highlightMemos.get('real-user')).toBeUndefined();
    session.setMemo('demo-user', { note: 'デモのメモ', kana: '' }, Date.now(), { real: !snap.demo });

    vi.advanceTimersByTime(10_000); // デモが自然に終わる(stopDemo はまだ)
    snap = session.snapshot();
    expect(snap.demo).toBe(false);
    expect((await session.highlightsForDay(day)).map((r) => r.viewer.userId)).toEqual(['real-user']);
    // ハイライトは本物の帳。本画面はまだデモの行なのでデモの帳のまま
    expect(snap.highlightMemos.get('real-user')).toMatchObject({ note: 'existing real memo', kana: 'ほんもの' });
    expect(snap.memos.get('real-user')).toBeUndefined();
    // Highlights.tsx と同じ書き方(real: !demo)
    session.setMemo('real-user', { note: 'edited in highlights after demo', kana: 'ほんもの' }, Date.now(), { real: !snap.demo });
    expect(session.snapshot().highlightMemos.get('real-user')?.note).toBe('edited in highlights after demo');

    session.disconnect(); // 接続・切断はデモの帳を捨てる
    expect(session.getMemo('real-user')?.note).toBe('edited in highlights after demo');
    expect(session.getMemo('demo-user')).toBeUndefined();
    const out = await session.exportData();
    expect(out.memos.map((m) => [m.userId, m.note])).toEqual([['real-user', 'edited in highlights after demo']]);
    await restart();
    expect(session.getMemo('real-user')?.note).toBe('edited in highlights after demo');
  });

  it('タブを行き来しただけなら IndexedDB を読み直さず、閉じている間の受信も重なっている', async () => {
    chat('c1');
    await session.exportData();
    expect((await session.highlightsForDay(day)).map((r) => r.id)).toEqual(['c1']);
    // セッションを通さずに書いた行: 取っておいた 1 日分を使う間は出ない(= 読み直していない)
    await saveArchiveRows('elsewhere', [{ k: 'comment', id: 'x1', tsMs: NOON, viewer: { userId: 'ux' }, text: 'x', visits: 1, firstEver: false }], {});
    chat('c2', { now: NOON + 1 }); // 閉じている間に受信
    like('l1', 4, { now: NOON + 2 });
    await session.exportData();
    const again = await session.highlightsForDay(day);
    expect(again.map((r) => r.id).sort()).toEqual(['c1', 'c2', likeRowId('r1', 'u1', likeBucketStart(NOON))].sort());
    expect(highlightMembers(again)).toMatchObject([{ comments: 2, likes: 4 }]);
    // 別の日を開くと取っておいた分は捨て、戻ったら読み直す
    expect(await session.highlightsForDay('2026-09-22')).toEqual([]);
    const reread = await session.highlightsForDay(day);
    expect(reread.map((r) => r.id)).toContain('x1');
    expect(highlightMembers(reread).find((m) => m.row.viewer.userId === 'u1')).toMatchObject({ comments: 2, likes: 4 });
    // アーカイブを書き換える操作でも捨てる
    await session.highlightsForDay(day);
    await saveArchiveRows('elsewhere', [{ k: 'comment', id: 'x2', tsMs: NOON, viewer: { userId: 'ux' }, text: 'x', visits: 1, firstEver: false }], {});
    await session.deleteArchivedStream('nothing');
    expect((await session.highlightsForDay(day)).map((r) => r.id)).toContain('x2');
  });

  it('統合の取り込みで、少ない数のいいねの行は保存済みの数を減らさない(置き換えならバックアップの数)', async () => {
    like('l1', 10, { now: NOON + 1000 });
    await session.exportData();
    like('l2', 10, { now: NOON + 2000 });
    const backup = await session.exportData({ includeArchive: true });
    expect(likeRows(await session.loadArchivedStream('r1')).map((r) => r.count)).toEqual([20]);
    const lower = { ...backup.archive!, rows: backup.archive!.rows.map((row) => (row.k === 'like' ? { ...row, count: 3, tsMs: NOON } : row)) };
    await session.importData({ ...backup, archive: lower, mode: 'merge' });
    const merged = likeRows(await session.loadArchivedStream('r1'));
    expect(merged.map((r) => [r.count, r.tsMs])).toEqual([[20, NOON + 2000]]);
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ likes: 20 }]);
    expect((await session.listArchive())[0]).toMatchObject({ rows: 1 });
    await session.importData({ ...backup, archive: lower, mode: 'replace' });
    expect(likeRows(await session.loadArchivedStream('r1')).map((r) => r.count)).toEqual([3]);
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ likes: 3 }]);
  });

  it('保存中に全消去して同じ 1 分にいいねが来ても、消す前の保存分を後から来た分から引かない', async () => {
    like('l1', 5, { now: NOON + 1000 });
    vi.advanceTimersByTime(1000); // 1 秒ごとの保存が取り出して列に並べる(まだ書き終わっていない)
    const clearing = session.clearArchive();
    like('l2', 3, { now: NOON + 2000 }); // 同じ (配信, 人, 1 分)
    await clearing;
    // 消す前の 5 を書き終えても、後から来た 3 はまだ書けていないので残す
    expect(session.highlightRowsInMemory).toBe(1);
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ likes: 3 }]);
    await session.exportData();
    expect(session.highlightRowsInMemory).toBe(0);
    expect(likeRows(await session.loadArchivedStream('r1')).map((r) => r.count)).toEqual([3]);
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ likes: 3 }]);
  });

  it('保存の列が詰まっても、受信中の行だけで先に開き、読めたら保存済みの行に差し替える', async () => {
    chat('saved-1');
    await session.exportData();
    let unblock!: () => void;
    const stuck = new Promise<void>((resolve) => (unblock = resolve));
    // IndexedDB が固まった代わりに、保存の列を止める
    void (session as unknown as { queue(step: () => Promise<void>): Promise<void> }).queue(() => stuck);
    chat('live-1');
    const views: Array<{ ids: string[]; failed: boolean }> = [];
    const stop = session.watchHighlightDay(day, (v) => views.push({ ids: v.list().map((r) => r.id), failed: v.failed }));
    vi.advanceTimersByTime(HIGHLIGHT_LOAD_TIMEOUT_MS - 10);
    expect(views).toEqual([]);
    vi.advanceTimersByTime(20);
    expect(views.at(-1)).toEqual({ ids: ['live-1'], failed: true });
    chat('live-2', { now: NOON + 1 });
    expect(views.at(-1)).toEqual({ ids: ['live-2', 'live-1'], failed: true });
    unblock();
    await session.exportData();
    expect(views.at(-1)).toEqual({ ids: ['live-2', 'live-1', 'saved-1'], failed: false });
    stop();
    // 読めていない(failed)1 日分は取っておかない
    expect((await session.highlightsForDay(day)).map((r) => r.id)).toEqual(['live-2', 'live-1', 'saved-1']);
  });
});
