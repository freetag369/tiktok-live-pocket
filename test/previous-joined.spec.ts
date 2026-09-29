import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { VisitCounter, sanitizeRecord } from '../src/lib/visits';
import { buildBackup, parseBackup } from '../src/lib/backup';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { saveVisits, loadVisits, clearVisits } from '../src/lib/db';
const T = new Date(2026, 8, 28, 19).getTime();
const user = { userId: 'previous-test' };
function firstRoom() {
  const c = new VisitCounter(); c.setRoom('A'); c.touch(user, T); c.recordJoin(user.userId, T); return c;
}
function nextRoom(c: VisitCounter) {
  c.setRoom('B'); c.touch(user, T + 86400000);
}
function backup(c: VisitCounter) {
  return parseBackup(JSON.stringify(buildBackup({settings: DEFAULT_SETTINGS, visits: c.all(), gifts: [], includeApiKey: false, appVersion: 'test'}))).visits;
}
describe('配信単位の前回入室', () => {
  it('初回は未記録。コメントが先でも確定し、入り直し・再接続・古い通知で変化しない', () => {
    const c = firstRoom(); expect(c.previousJoinedFor(user.userId)).toBeUndefined();
    c.recordJoin(user.userId, T + 3600000);
    nextRoom(c); expect(c.previousJoinedFor(user.userId)).toBe(T + 3600000);
    for (const ts of [T + 86400000, T + 90000000, T + 86400000, T - 1]) c.recordJoin(user.userId, ts);
    c.setRoom('B'); c.touch(user, T + 91000000);
    expect(c.previousJoinedFor(user.userId)).toBe(T + 3600000);
    expect(c.all()[0]?.lastJoinedRoomId).toBe('B');
    c.setRoom('C'); c.touch(user, T + 172800000);
    expect(c.previousJoinedFor(user.userId)).toBe(T + 90000000);
  });
  it('再起動・DB読込・バックアップの復元で今回と前回を混同しない', async () => {
    await clearVisits();
    const c = firstRoom(); nextRoom(c); c.recordJoin(user.userId, T + 86400000);
    await saveVisits(c.drainDirty());
    const restored = new VisitCounter(await loadVisits()); restored.setRoom('B'); restored.touch(user, T + 90000000);
    expect(restored.previousJoinedFor(user.userId)).toBe(T);
    const imported = new VisitCounter(); imported.import(backup(restored), 'replace'); imported.setRoom('B'); imported.touch(user, T + 92000000);
    expect(imported.previousJoinedFor(user.userId)).toBe(T);
    await clearVisits();
  });
  it('統合は日時・配信IDの組を保ち、配信中に確定した前回表示は固定する', () => {
    const active = firstRoom(); nextRoom(active); active.recordJoin(user.userId, T + 86400000);
    const incoming = new VisitCounter(backup(active)); incoming.setRoom('C'); incoming.touch(user, T + 172800000); incoming.recordJoin(user.userId, T + 172800000);
    active.import(backup(incoming), 'merge');
    expect(active.previousJoinedFor(user.userId)).toBe(T);
    expect(active.all()[0]).toMatchObject({lastJoinedMs: T + 172800000, lastJoinedRoomId:'C', previousJoinedMs: T, previousJoinedRoomId:'A', previousForRoomId:'B'});
    const cold = new VisitCounter(backup(firstRoom())); cold.import(backup(incoming), 'merge'); cold.setRoom('C');
    expect(cold.previousJoinedFor(user.userId)).toBe(T + 86400000);
    cold.import(backup(firstRoom()), 'merge');
    expect(cold.all()[0]?.lastJoinedRoomId).toBe('C');
  });
  it('旧データの配信不明な日時を前回と推測しない', () => {
    const c = new VisitCounter([{userId:user.userId, visits:2, lastRoomId:'A', firstSeenMs:T, lastSeenMs:T, lastJoinedMs:T}]);
    nextRoom(c); expect(c.previousJoinedFor(user.userId)).toBeUndefined();
    c.recordJoin(user.userId, T + 86400000); expect(c.previousJoinedFor(user.userId)).toBeUndefined();
    c.setRoom('C'); c.touch(user, T + 172800000); expect(c.previousJoinedFor(user.userId)).toBe(T + 86400000);
    const invalid = sanitizeRecord({...c.all()[0], previousJoinedRoomId:'C'});
    expect(invalid?.previousJoinedMs).toBeUndefined();
  });
  it('起動時の受信記録統合でも前の配信の日時を保持する', () => {
    const loaded = firstRoom(); const early = new VisitCounter(); nextRoom(early); early.recordJoin(user.userId, T + 86400000);
    loaded.adopt(early); expect(loaded.previousJoinedFor(user.userId)).toBe(T);
    expect(loaded.all()[0]?.lastJoinedRoomId).toBe('B');
  });
});
