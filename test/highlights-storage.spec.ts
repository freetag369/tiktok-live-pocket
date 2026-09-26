import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, loadDayRows, saveArchiveRows } from '../src/lib/db';
import { LiveSession } from '../src/lib/session';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { dayRange, highlightMembers } from '../src/lib/highlights';
import type { FeedRow } from '../src/lib/feed';

const day = '2026-09-23';
const [start, end] = dayRange(day);
const comment: FeedRow = { k: 'comment', id: 'old', tsMs: start, viewer: { userId: 'u1' }, visits: 1, firstEver: true, text: 'old' };
let session: LiveSession;
let enabled = true;
let keep = 30;

beforeAll(async () => {
  const old = await openDB('tiktok-live-pocket', 3, { upgrade(db) {
    for (const name of ['visits', 'memos']) db.createObjectStore(name, { keyPath: 'userId' });
    db.createObjectStore('gifts', { keyPath: 'giftId' });
    db.createObjectStore('streams', { keyPath: 'roomId' });
    db.createObjectStore('logRows', { keyPath: 'id' }).createIndex('byRoomTs', ['roomId', 'tsMs']);
  } });
  await old.put('logRows', { ...comment, roomId: 'old-room' });
  old.close();
  const db = await getDb();
  expect(db.version).toBe(4);
  expect(await loadDayRows(start, end)).toMatchObject([{ id: 'old' }]);
});

beforeEach(async () => {
  const db = await getDb();
  for (const name of db.objectStoreNames) await db.clear(name);
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(start + 12 * 3600_000);
  enabled = true;
  keep = 30;
  session = new LiveSession(() => ({ ...DEFAULT_SETTINGS, archiveEnabled: enabled, archiveKeepStreams: keep }));
  await session.whenReady();
  session.ingest('roomInfo', { id_str: 'r1' });
});

afterEach(async () => {
  await session.exportData();
  session.disconnect();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function chat(id: string, now = Date.now()) {
  session.ingest('WebcastChatMessage', { common: { msgId: id }, user: { id: 'u1', nickname: 'テスト' }, content: id }, now);
}
function like(id: string, count: number) {
  session.ingest('WebcastLikeMessage', { common: { msgId: id }, user: { id: 'u1' }, likeCount: count });
}
function gift(id: string, count: number, ended: boolean) {
  session.ingest('WebcastGiftMessage', { common: { msgId: id }, user: { id: 'u1' }, giftId: '5655', gift: { name: 'Rose', type: 1, diamondCount: 1 }, groupId: 'combo', repeatCount: count, repeatEnd: ended ? 1 : 0 });
}

describe('highlight storage and session', () => {
  it('保存と再起動・再送後もいいねとコメントを重複せず復元する', async () => {
    chat('c1'); like('l1', 10); like('l1', 10);
    await session.exportData();
    session.disconnect();
    session = new LiveSession(() => DEFAULT_SETTINGS);
    await session.whenReady();
    session.ingest('roomInfo', { id_str: 'r1' });
    chat('c1'); like('l1', 10);
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ comments: 1, likes: 10 }]);
    expect(session.rows.some(r => r.k === 'like')).toBe(false);
  });

  it('同日の複数配信をまとめ、日付の範囲で検索する', async () => {
    chat('yesterday', start - 1); chat('today', start); chat('tomorrow', end);
    await session.exportData();
    session.ingest('roomInfo', { id_str: 'r2' });
    chat('second-room', start + 1);
    expect((await session.highlightsForDay(day)).map(r => r.id)).toEqual(['second-room', 'today']);
    expect((await session.highlightsForDay('2026-09-22')).map(r => r.id)).toEqual(['yesterday']);
  });

  it('500行超過と表示クリア後も履歴と連続ギフトを保持する', async () => {
    gift('g1', 1, false);
    for (let i = 0; i < 501; i++) chat(`c${i}`);
    session.clearFeed();
    gift('g2', 8, true);
    await session.exportData();
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ comments: 501, gifts: 8 }]);
    expect((await session.loadArchivedStream('r1')).find(r => r.k === 'gift')).toMatchObject({ count: 8 });
  });

  it('保存OFFの記録は実行中だけで、アーカイブには保存しない', async () => {
    enabled = false;
    chat('temporary'); like('temporary-like', 3);
    expect(await session.highlightsForDay(day)).toHaveLength(2);
    expect((await session.exportData({ includeArchive: true })).archive?.rows).toHaveLength(0);
    session.disconnect();
    session = new LiveSession(() => DEFAULT_SETTINGS);
    await session.whenReady();
    expect(await session.highlightsForDay(day)).toEqual([]);
  });

  it('重複表の上限を超えても連続ギフトの更新再送を二重計上しない', async () => {
    enabled = false;
    gift('g1', 1, false); gift('g2', 8, true);
    for (let i = 0; i < 5001; i++) like(`l${i}`, 1);
    gift('g2', 8, true);
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ gifts: 8, likes: 5001 }]);
  });

  it('バックアップ統合後の保存値が古いメモリ値に隠れない', async () => {
    like('l1', 3);
    const backup = await session.exportData({ includeArchive: true });
    const archive = backup.archive!;
    archive.rows = archive.rows.map(row => row.k === 'like' ? { ...row, count: 12 } : row);
    await session.importData({ ...backup, archive, mode: 'merge' });
    expect(highlightMembers(await session.highlightsForDay(day))).toMatchObject([{ likes: 12 }]);
  });

  it('配信削除と全消去でメモリにも履歴を残さない', async () => {
    chat('c1');
    await session.deleteArchivedStream('r1');
    expect(await session.highlightsForDay(day)).toEqual([]);
    chat('c2');
    await session.clearArchive();
    expect(await session.highlightsForDay(day)).toEqual([]);
  });

  it('保持数を超えたアーカイブは起動時に削除する', async () => {
    await session.exportData();
    await saveArchiveRows('old', [{ ...comment, id: 'old', tsMs: start }], {});
    await saveArchiveRows('new', [{ ...comment, id: 'new', tsMs: start + 1 }], {});
    session.disconnect(); keep = 1;
    session = new LiveSession(() => ({ ...DEFAULT_SETTINGS, archiveKeepStreams: keep }));
    await session.whenReady();
    expect((await session.highlightsForDay(day)).map(r => r.id)).toEqual(['new']);
  });

  it('デモは当日に表示され、本番やバックアップと混ざらない', async () => {
    chat('real');
    session.playDemo([{ o: 0, type: 'WebcastLikeMessage', data: { common: { msgId: 'demo-like', createTime: '1785240000' }, user: { id: 'demo-user' }, likeCount: 7 } }]);
    vi.advanceTimersByTime(900);
    expect(await session.highlightsForDay(day)).toMatchObject([{ id: 'demo-like', count: 7 }]);
    expect((await session.exportData({ includeArchive: true })).archive?.rows.map(r => r.id)).toEqual(['real']);
    session.stopDemo();
    expect((await session.highlightsForDay(day)).map(r => r.id)).toEqual(['real']);
  });
});
