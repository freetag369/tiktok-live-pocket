import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { VisitCounter, sanitizeRecord } from '../src/lib/visits';
import { lastJoined } from '../src/lib/format';
import { LiveSession } from '../src/lib/session';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { buildBackup, parseBackup } from '../src/lib/backup';
import { loadVisits, saveVisits, clearVisits } from '../src/lib/db';

const T = new Date(2026, 8, 28, 19).getTime();
const viewer = { userId: 'joined-user' };
const record = { ...viewer, visits: 1, lastRoomId: 'room', firstSeenMs: T, lastSeenMs: T };
let session: LiveSession | undefined;
afterEach(async () => {
  session?.disconnect();
  session = undefined;
  await clearVisits();
});

describe('最終入室日時', () => {
  it('端末のローカル月日と24時間表記、未記録を表示する', () => {
    expect(lastJoined(T)).toBe('9月28日19時');
    expect(lastJoined(new Date(2026, 8, 29, 0, 30).getTime())).toBe('9月29日0時');
    expect(lastJoined()).toBe('未記録');
    expect(lastJoined(0)).toBe('未記録');
  });

  it('日時だけの変更を保存し、再読み込み後も保持する', async () => {
    const counter = new VisitCounter([record]);
    counter.recordJoin(viewer.userId, T);
    await saveVisits(counter.drainDirty());
    const restored = new VisitCounter(await loadVisits());
    expect(restored.all()[0]?.lastJoinedMs).toBe(T);
    restored.recordJoin(viewer.userId, T - 1);
    restored.recordJoin(viewer.userId, T);
    expect(restored.drainDirty()).toEqual([]);
    restored.recordJoin(viewer.userId, T + 60000);
    expect(restored.drainDirty()[0]?.lastJoinedMs).toBe(T + 60000);
  });

  it('起動時の統合で新しい入室日時を保持する', () => {
    const early = new VisitCounter([{ ...record, lastJoinedMs: T + 60000 }]);
    early.setRoom('room');
    const loaded = new VisitCounter([{ ...record, lastJoinedMs: T }]);
    loaded.adopt(early);
    expect(loaded.drainDirty()[0]?.lastJoinedMs).toBe(T + 60000);
    loaded.adopt(new VisitCounter());
    expect(loaded.all()[0]?.lastJoinedMs).toBe(T + 60000);
  });

  it('新旧バックアップの復元と日時だけが異なる統合に対応する', () => {
    const makeBackup = (joined?: number) => parseBackup(JSON.stringify(buildBackup({
      settings: DEFAULT_SETTINGS, visits: [{ ...record, lastJoinedMs: joined }],
      gifts: [], includeApiKey: false, appVersion: '0.1.0',
    })));
    expect(makeBackup().visits[0]).not.toHaveProperty('lastJoinedMs');
    const restored = new VisitCounter();
    restored.import(makeBackup(T).visits, 'replace');
    expect(restored.all()[0]?.lastJoinedMs).toBe(T);
    restored.drainDirty();
    expect(restored.import(makeBackup(T + 60000).visits, 'merge').updated).toBe(1);
    expect(restored.drainDirty()[0]?.lastJoinedMs).toBe(T + 60000);
    restored.import(makeBackup(T).visits, 'merge');
    restored.import(makeBackup().visits, 'merge');
    expect(restored.all()[0]?.lastJoinedMs).toBe(T + 60000);
    for (const invalid of [NaN, Infinity, -1, 0, 'bad']) {
      expect(sanitizeRecord({ ...record, lastJoinedMs: invalid })).not.toHaveProperty('lastJoinedMs');
    }
  });

  it('重複除去済み入室だけを記録し、コメント・購読・古い入室では更新しない', async () => {
    session = new LiveSession(() => ({ ...DEFAULT_SETTINGS }));
    await session.whenReady();
    session.ingest('roomInfo', { id_str: 'room' }, T);
    const join = (id: string, ts: number, action = 1) => session!.ingest('WebcastMemberMessage', {
      common: { msgId: id, createTime: ts / 1000 }, user: { id: viewer.userId }, action,
    }, T + 300000);
    const value = () => session!.viewersForList().find((v) => v.userId === viewer.userId)?.lastJoinedMs;
    join('j1', T);
    expect(value()).toBe(T);
    join('j1', T + 60000);
    join('duplicate-entrance', T + 1000);
    expect(value()).toBe(T);
    session.ingest('WebcastChatMessage', { common: { msgId: 'c1' }, user: { id: viewer.userId }, content: 'hello' }, T + 60000);
    join('subscribe', T + 60000, 3);
    expect(value()).toBe(T);
    join('j2', T + 120000);
    expect(value()).toBe(T + 120000);
    join('old', T - 60000);
    expect(value()).toBe(T + 120000);
    session.setMemo('memo-only', { note: 'メモ', kana: '' });
    expect(session.viewersForList().find((v) => v.userId === 'memo-only')?.lastJoinedMs).toBeUndefined();
    session.playDemo([]);
    join('demo-join', T + 240000);
    expect((await session.exportData()).visits.find((v) => v.userId === viewer.userId)?.lastJoinedMs).toBe(T + 120000);
  });
});
