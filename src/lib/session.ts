import type { NormalizedEvent } from './events';
import { viewerOf } from './events';
import { applyEvent, createFeedState, resetForNewRoom, type FeedState } from './feed';
import { GiftCatalog } from './gift-catalog';
import { normalize } from './normalize';
import { VisitCounter } from './visits';
import { loadGiftCatalog, loadVisits, saveGiftCatalog, saveVisits, clearVisits } from './db';
import { EulerSocket, type SocketState } from './euler-socket';
import { buildEulerUrl } from './euler-url';
import type { Settings } from './settings';

/**
 * 受信 → 正規化 → 来店カウント → フィード、の配線。React からは `subscribe` で購読する。
 * UI を 1 メッセージごとに再描画しないよう、変更は rAF(なければ 50ms)でまとめて通知する。
 */

export interface RoomState {
  roomId: string;
  hostNickname?: string;
  hostUniqueId?: string;
  viewerCount?: number;
  control?: 'paused' | 'unpaused' | 'ended' | 'suspended';
}

export interface SessionSnapshot {
  feed: FeedState;
  socket: SocketState;
  room: RoomState;
  /** デモ再生中なら true。 */
  demo: boolean;
  /** 保存済み来店レコード数(設定画面の表示用)。 */
  knownViewers: number;
}

type Listener = (s: SessionSnapshot) => void;

export class LiveSession {
  private feed: FeedState = createFeedState();
  private socketState: SocketState = { s: 'idle' };
  private room: RoomState = { roomId: '' };
  private visits = new VisitCounter();
  /** デモ再生中だけ使う使い捨てカウンタ(本物の来店履歴を汚さない)。 */
  private demoVisits: VisitCounter | null = null;
  private catalog = new GiftCatalog();
  private socket: EulerSocket | null = null;
  private listeners = new Set<Listener>();
  private scheduled = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private demoStop: (() => void) | null = null;
  private ready: Promise<void>;
  private getSettings: () => Settings;

  constructor(getSettings: () => Settings) {
    this.getSettings = getSettings;
    this.ready = this.load();
    this.flushTimer = setInterval(() => void this.persist(), 1000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.socket?.wake();
      });
    }
  }

  private async load(): Promise<void> {
    const [v, g] = await Promise.all([loadVisits(), loadGiftCatalog()]);
    this.visits = new VisitCounter(v);
    this.catalog = new GiftCatalog(g);
    this.notify();
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => {
      this.listeners.delete(fn);
    };
  }

  snapshot(): SessionSnapshot {
    return { feed: this.feed, socket: this.socketState, room: this.room, demo: this.demoStop != null, knownViewers: this.visits.size };
  }

  private notify(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      const snap = this.snapshot();
      for (const l of this.listeners) l(snap);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 50);
  }

  private async persist(): Promise<void> {
    const v = this.visits.drainDirty();
    const g = this.catalog.drainDirty();
    if (v.length) await saveVisits(v);
    if (g.length) await saveGiftCatalog(g);
  }

  // ── 接続 ─────────────────────────────────────────────────────────────

  connect(): void {
    this.stopDemo();
    this.socket?.stop();
    const s = this.getSettings();
    this.socket = new EulerSocket({
      makeUrl: () => {
        const cur = this.getSettings();
        if (!cur.hostUniqueId) throw new Error('配信者名が未設定です');
        if (!cur.eulerApiKey) throw new Error('Euler Stream の API キーが未設定です');
        return buildEulerUrl({ baseUrl: cur.wsUrl, uniqueId: cur.hostUniqueId, apiKey: cur.eulerApiKey, closeInactiveAfterSec: 120 });
      },
      sink: {
        state: (st) => {
          this.socketState = st;
          this.notify();
        },
        message: (type, data) => this.ingest(type, data),
      },
    });
    void s;
    this.socket.start();
  }

  disconnect(): void {
    this.socket?.stop();
    this.socket = null;
    this.stopDemo();
    this.socketState = { s: 'idle' };
    this.notify();
  }

  get connected(): boolean {
    return this.socket?.isRunning ?? false;
  }

  // ── 取り込み ───────────────────────────────────────────────────────

  ingest(type: string, data: unknown, now = Date.now()): void {
    const e = normalize(type, data, now);
    if (!e) return;
    this.apply(e, now);
  }

  private apply(e: NormalizedEvent, now: number): void {
    switch (e.kind) {
      case 'roomInfo': {
        if (e.roomId !== this.room.roomId) {
          if (this.room.roomId) this.feed = resetForNewRoom(this.feed);
          this.room = { roomId: e.roomId, hostNickname: e.hostNickname, hostUniqueId: e.hostUniqueId };
          (this.demoVisits ?? this.visits).setRoom(e.roomId);
        } else {
          this.room = { ...this.room, hostNickname: e.hostNickname ?? this.room.hostNickname, hostUniqueId: e.hostUniqueId ?? this.room.hostUniqueId };
        }
        this.notify();
        return;
      }
      case 'roomStats':
        if (e.viewerCount != null) {
          this.room = { ...this.room, viewerCount: e.viewerCount };
          this.notify();
        }
        return;
      case 'roomControl':
        this.room = { ...this.room, control: e.action };
        this.notify();
        return;
      default:
        break;
    }

    const v = viewerOf(e);
    if (!v) return;
    const meta = (this.demoVisits ?? this.visits).touch(v, now);
    if (e.kind === 'gift') this.catalog.observe(e, now);
    const next = applyEvent(this.feed, e, meta, e.kind === 'gift' ? this.catalog.iconOf(e.giftId) : undefined);
    if (next !== this.feed) {
      this.feed = next;
      this.notify();
    }
  }

  // ── デモ再生(ネット不要) ─────────────────────────────────────────

  /** 既存 fixtures 形式(`{o, type, data}` の ndjson)を時間どおりに流す。 */
  playDemo(lines: Array<{ o: number; type?: string; data?: unknown }>, speed = 1): void {
    this.socket?.stop();
    this.socket = null;
    this.stopDemo();
    const roomId = `demo-${Date.now()}`;
    // 見本として「常連」「2回目」「初見」が混ざるように種を入れる(保存はしない)。
    const t0 = Date.now() - 7 * 24 * 3600 * 1000;
    this.demoVisits = new VisitCounter([
      { userId: '1', visits: 12, lastRoomId: 'demo-old', firstSeenMs: t0, lastSeenMs: t0 },
      { userId: '3', visits: 1, lastRoomId: 'demo-old', firstSeenMs: t0, lastSeenMs: t0 },
      { userId: '4', visits: 40, lastRoomId: 'demo-old', firstSeenMs: t0, lastSeenMs: t0 },
      { userId: '5', visits: 4, lastRoomId: 'demo-old', firstSeenMs: t0, lastSeenMs: t0 },
    ]);
    this.socketState = { s: 'live', sinceMs: Date.now() };
    this.apply({ kind: 'roomInfo', msgId: `roomInfo:${roomId}`, tsMs: Date.now(), roomId, hostNickname: 'デモ配信', hostUniqueId: 'demo' }, Date.now());
    const timers: ReturnType<typeof setTimeout>[] = [];
    let last = 0;
    for (const l of lines) {
      if (!l.type) continue;
      const at = Math.max(0, l.o) / speed;
      last = Math.max(last, at);
      timers.push(setTimeout(() => this.ingest(l.type!, l.data), at));
    }
    timers.push(
      setTimeout(() => {
        this.demoStop = null;
        this.socketState = { s: 'ended', reason: 'デモ再生が終わりました' };
        this.notify();
      }, last + 800)
    );
    this.demoStop = () => {
      for (const t of timers) clearTimeout(t);
    };
    this.notify();
  }

  stopDemo(): void {
    if (this.demoStop) {
      this.demoStop();
      this.demoStop = null;
    }
    if (this.demoVisits) {
      this.demoVisits = null;
      // デモの部屋を本物の来店カウンタに残さない。次の roomInfo で切り替わる。
      this.room = { roomId: '' };
      this.feed = resetForNewRoom(this.feed);
    }
  }

  // ── 設定画面から ─────────────────────────────────────────────────

  async resetHistory(): Promise<void> {
    this.visits.clear();
    await clearVisits();
    this.notify();
  }

  clearFeed(): void {
    this.feed = { ...createFeedState(), seen: this.feed.seen, seenOrder: this.feed.seenOrder, streaks: this.feed.streaks, diamonds: this.feed.diamonds, giftCount: this.feed.giftCount, commentCount: this.feed.commentCount, joinCount: this.feed.joinCount };
    this.notify();
  }
}
