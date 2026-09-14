import type { Viewer } from './events';

/**
 * 来店カウンタ。
 *
 * 規則(既存 PC アプリの touchViewer と同じ):
 *  - 「その配信(roomId)で初めて姿を見せた瞬間」に visits を +1 する。入室メッセージは
 *    混雑時に間引かれるので、コメント・ギフト・いいね等どのイベントでも初回観測で数える。
 *  - 初見かどうかは +1 する**前**の visits が 0 かで決め、その配信中はラッチ(固定)する。
 *    後から再計算すると、その配信で来店済みの人が全員「2回目」になってしまう。
 *  - 再接続やアプリ再起動で同じ roomId を見ても二重に数えない(lastRoomId で判定)。
 *
 * 永続化は `VisitStore` インターフェース越し(IndexedDB 実装は visit-db.ts)。
 */

export interface VisitRecord {
  userId: string;
  visits: number;
  lastRoomId: string;
  uniqueId?: string;
  nickname?: string;
  avatarUrl?: string;
  firstSeenMs: number;
  lastSeenMs: number;
}

export interface VisitMeta {
  visits: number;
  firstEver: boolean;
}

export class VisitCounter {
  private records = new Map<string, VisitRecord>();
  /** この配信でラッチした判定(userId → meta)。roomId が変わるとクリア。 */
  private latched = new Map<string, VisitMeta>();
  private roomId = '';
  private dirty = new Set<string>();

  constructor(initial: Iterable<VisitRecord> = []) {
    for (const r of initial) this.records.set(r.userId, r);
  }

  get currentRoomId(): string {
    return this.roomId;
  }

  /** 配信(部屋)を切り替える。同じ roomId なら何もしない。 */
  setRoom(roomId: string): void {
    if (roomId === this.roomId) return;
    this.roomId = roomId;
    this.latched.clear();
  }

  /** イベントで見かけた viewer を記録し、その人の「何回目/初見」を返す。 */
  touch(v: Viewer, now: number): VisitMeta {
    const cached = this.latched.get(v.userId);
    if (cached) {
      this.refreshIdentity(v, now);
      return cached;
    }
    const rec = this.records.get(v.userId);
    if (!this.roomId) {
      // roomInfo がまだ来ていない(通常は最初のメッセージで来る)。数えずに現状だけ返す。
      const visits = rec?.visits ?? 0;
      return { visits: Math.max(visits, 1), firstEver: visits === 0 };
    }
    let meta: VisitMeta;
    if (!rec) {
      meta = { visits: 1, firstEver: true };
      this.records.set(v.userId, {
        userId: v.userId,
        visits: 1,
        lastRoomId: this.roomId,
        uniqueId: v.uniqueId,
        nickname: v.nickname,
        avatarUrl: v.avatarUrl,
        firstSeenMs: now,
        lastSeenMs: now,
      });
      this.dirty.add(v.userId);
    } else if (rec.lastRoomId === this.roomId) {
      // 再接続・再起動でこの配信を再び見ている。増やさない。
      // この配信でしか見たことがない人(visits===1)は、再起動後も初見のまま。
      meta = { visits: rec.visits, firstEver: rec.visits === 1 };
      this.refreshIdentity(v, now);
    } else {
      meta = { visits: rec.visits + 1, firstEver: rec.visits === 0 };
      rec.visits = meta.visits;
      rec.lastRoomId = this.roomId;
      rec.lastSeenMs = now;
      this.applyIdentity(rec, v);
      this.dirty.add(v.userId);
    }
    this.latched.set(v.userId, meta);
    return meta;
  }

  private applyIdentity(rec: VisitRecord, v: Viewer): void {
    if (v.uniqueId) rec.uniqueId = v.uniqueId;
    if (v.nickname) rec.nickname = v.nickname;
    if (v.avatarUrl) rec.avatarUrl = v.avatarUrl;
  }

  private refreshIdentity(v: Viewer, now: number): void {
    const rec = this.records.get(v.userId);
    if (!rec) return;
    const before = `${rec.uniqueId}|${rec.nickname}|${rec.avatarUrl}`;
    this.applyIdentity(rec, v);
    rec.lastSeenMs = now;
    if (before !== `${rec.uniqueId}|${rec.nickname}|${rec.avatarUrl}`) this.dirty.add(v.userId);
  }

  /** 保存待ちのレコードを取り出す(呼ぶと dirty はクリアされる)。 */
  drainDirty(): VisitRecord[] {
    const out: VisitRecord[] = [];
    for (const id of this.dirty) {
      const r = this.records.get(id);
      if (r) out.push({ ...r });
    }
    this.dirty.clear();
    return out;
  }

  get size(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
    this.latched.clear();
    this.dirty.clear();
  }
}
