import type { NormalizedEvent, Viewer } from './events';
import { viewerOf } from './events';
import { applyEvent, clearRows, createFeedState, dataRows, enterRoom, restoreFeed, toScreenMeta, type FeedItem, type FeedState, type ScreenItem, type ScreenMeta } from './feed';
import { GiftCatalog } from './gift-catalog';
import { normalize } from './normalize';
import { VisitCounter } from './visits';
import { loadGiftCatalog, loadVisits, saveGiftCatalog, saveVisits, clearVisits, replaceVisits, loadMemos, saveMemos, replaceMemos, saveArchiveRows, listStreams, loadStreamRows, deleteStream, clearArchive, loadAllArchive, loadScreen, saveScreen, replaceScreen, deleteScreenRows, type GiftCatalogRecord } from './db';
import { streamsToPrune, type StreamRecord } from './archive';
import type { ArchiveBackup } from './backup';
import type { FeedRow } from './feed';
import type { VisitRecord } from './visits';
import { MemoBook, type MemoPatch, type MemoRecord } from './memos';
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
  /** リスナーメモ(userId → メモ)。行の描画時に引く。中身が変わったときだけ参照が変わる。 */
  memos: ReadonlyMap<string, MemoRecord>;
  /** 画面をまるごと入れ替えた回数(🧹・復元・デモの出入り)。FeedList の作り直しに使う。 */
  screenEpoch: number;
}

/** リスナー一覧の 1 行(来店履歴 + メモ)。 */
export interface ViewerListItem {
  userId: string;
  nickname?: string;
  uniqueId?: string;
  avatarUrl?: string;
  visits: number;
  lastSeenMs: number;
  memo?: MemoRecord;
}

type Listener = (s: SessionSnapshot) => void;

/** フォローが 1 件届いた(重複排除・鮮度チェック済み)。ポップアップ用。 */
export interface FollowNotice {
  viewer: Viewer;
  visits: number;
  firstEver: boolean;
  tsMs: number;
}
type FollowListener = (n: FollowNotice) => void;

/** これより古いフォローは通知しない(接続直後のバックログ再送対策)。 */
export const FOLLOW_NOTICE_MAX_AGE_MS = 60_000;

/** 画面の履歴の保存先。既定は IndexedDB(テストではメモリの偽物を渡す)。 */
export interface ScreenStore {
  load(): Promise<{ items: ScreenItem[]; meta: ScreenMeta | null }>;
  save(items: ScreenItem[], meta: ScreenMeta | null): Promise<void>;
  replace(items: ScreenItem[], meta: ScreenMeta | null): Promise<void>;
  remove(ids: string[]): Promise<void>;
}

const indexedDbScreenStore: ScreenStore = { load: loadScreen, save: saveScreen, replace: replaceScreen, remove: deleteScreenRows };

/** 復元(IndexedDB)が遅くても、これを過ぎたら受信を画面に流す。 */
export const RESTORE_TIMEOUT_MS = 3000;

export class LiveSession {
  private feed: FeedState = createFeedState();
  /** デモ再生中に退避した本物の画面。null でなければ「デモの画面を出している」。 */
  private parkedFeed: FeedState | null = null;
  private socketState: SocketState = { s: 'idle' };
  private room: RoomState = { roomId: '' };
  /** いまの部屋が roomInfo で確定したものなら true(common.roomId では上書きしない)。 */
  private roomFromInfo = false;
  /** 来店履歴の読込が終わるまで届いたメッセージ。読込後に流し直す。 */
  private pending: Array<[string, unknown, number]> | null = [];
  private visits = new VisitCounter();
  /** デモ再生中だけ使う使い捨てカウンタ(本物の来店履歴を汚さない)。 */
  private demoVisits: VisitCounter | null = null;
  private memos = new MemoBook();
  /** デモ再生中だけ使う使い捨てメモ帳(本物のメモを汚さない)。 */
  private demoMemos: MemoBook | null = null;
  private catalog = new GiftCatalog();
  private socket: EulerSocket | null = null;
  private listeners = new Set<Listener>();
  private followListeners = new Set<FollowListener>();
  private scheduled = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private demoStop: (() => void) | null = null;
  private ready: Promise<void>;
  private getSettings: () => Settings;
  /** アーカイブ保存待ちの行(id → 行)。1 秒ごとに IndexedDB へ。 */
  private archiveDirty = new Map<string, { roomId: string; row: FeedRow }>();
  /** 画面の履歴の保存待ち(id → 行 or 配信の区切り)。 */
  private screenDirty = new Map<string, ScreenItem>();
  private metaDirty = false;
  private screen: ScreenStore;
  /** 保存の順番を守るための列(リセットの消去と書き込みが前後しないように)。 */
  private chain: Promise<void> = Promise.resolve();
  /** 保存の並び順。時刻ベースで単調増加させる。 */
  private lastSeq = 0;
  private screenEpoch = 0;

  constructor(getSettings: () => Settings, o: { screenStore?: ScreenStore } = {}) {
    this.getSettings = getSettings;
    this.screen = o.screenStore ?? indexedDbScreenStore;
    this.ready = this.load().catch(() => {});
    this.flushTimer = setInterval(() => void this.persist(), 1000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.socket?.wake();
        // バックグラウンドに回る直前に書き切る(iOS はこの後タイマーが止まる)
        else void this.persist();
      });
    }
  }

  private async load(): Promise<void> {
    // IndexedDB が固まっても受信が止まらないよう、一定時間で待つのをやめる。
    const timer = setTimeout(() => this.releasePending(), RESTORE_TIMEOUT_MS);
    try {
      const [v, g, m] = await Promise.all([loadVisits(), loadGiftCatalog(), loadMemos()]);
      this.visits = new VisitCounter(v);
      this.catalog = new GiftCatalog(g);
      this.memos = new MemoBook(m);
      const { items, meta } = await this.screen.load();
      // タイムアウトで受信を流した後に届いた復元は捨てる(ストアは残るので次の起動で戻る)。
      if (this.pending) this.applyRestored(items, meta);
    } finally {
      clearTimeout(timer);
      // 読込前に数えると保存済みの人まで「初見」になるので、溜めておいた分をここで流す。
      this.releasePending();
      this.notify();
    }
    await this.pruneArchive();
  }

  /** 保存してあった画面の履歴を、まだ何も出ていない画面にだけ戻す。 */
  private applyRestored(items: ScreenItem[], meta: ScreenMeta | null): void {
    if (items.length === 0 && !meta) return;
    for (const it of items) if (it.seq > this.lastSeq) this.lastSeq = it.seq;
    const target = this.parkedFeed ?? this.feed;
    if (target.rows.length > 0 || target.roomId) return;
    const { state, dropIds } = restoreFeed(items, meta);
    if (this.parkedFeed) this.parkedFeed = state;
    else this.feed = state;
    this.screenEpoch++;
    if (dropIds.length) void this.queue(() => this.screen.remove(dropIds));
  }

  /** 読込・復元を待って貯めていたメッセージを、受信したときの時刻のまま流す。 */
  private releasePending(): void {
    const queued = this.pending;
    if (!queued) return;
    this.pending = null;
    for (const [type, data, now] of queued) this.ingest(type, data, now);
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

  /** フォロー到着を購読する。戻り値で解除。 */
  onFollow(fn: FollowListener): () => void {
    this.followListeners.add(fn);
    return () => {
      this.followListeners.delete(fn);
    };
  }

  snapshot(): SessionSnapshot {
    return {
      feed: this.feed,
      socket: this.socketState,
      room: this.room,
      demo: this.demoStop != null,
      knownViewers: this.visits.size,
      memos: (this.demoMemos ?? this.memos).view(),
      screenEpoch: this.screenEpoch,
    };
  }

  private notify(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      this.scheduled = false;
      const snap = this.snapshot();
      for (const l of this.listeners) l(snap);
    };
    // 画面が隠れていたり描画が止まっていると rAF は来ない(iOS の背面・低電力、PC のタブ非表示)。
    // その間も状態は届けたいので、rAF と setTimeout の早い方で流す。
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (typeof requestAnimationFrame === 'function' && !hidden) requestAnimationFrame(run);
    setTimeout(run, hidden ? 50 : 100);
  }

  /** 保存はこの列で順に流す。失敗しても列は止めない。 */
  private queue(step: () => Promise<void>): Promise<void> {
    const run = this.chain.then(step).catch(() => {});
    this.chain = run;
    return run;
  }

  private async persist(): Promise<void> {
    // 呼ばれた時点の分をその場で取り出してから列に並べる(リセットとの前後が入れ替わらない)。
    const v = this.visits.drainDirty();
    const g = this.catalog.drainDirty();
    const m = this.memos.drainDirty();
    const host = { hostUniqueId: this.room.hostUniqueId, hostNickname: this.room.hostNickname };
    const archive = new Map<string, FeedRow[]>();
    for (const { roomId, row } of this.archiveDirty.values()) {
      let list = archive.get(roomId);
      if (!list) archive.set(roomId, (list = []));
      list.push(row);
    }
    this.archiveDirty.clear();
    const screen = [...this.screenDirty.values()];
    this.screenDirty.clear();
    const meta = this.metaDirty && !this.parkedFeed ? toScreenMeta(this.feed) : null;
    this.metaDirty = false;
    if (!v.length && !g.length && !m.put.length && !m.del.length && archive.size === 0 && screen.length === 0 && !meta) return this.chain;
    return this.queue(async () => {
      if (v.length) await saveVisits(v);
      if (g.length) await saveGiftCatalog(g);
      if (m.put.length || m.del.length) await saveMemos(m.put, m.del);
      for (const [roomId, rows] of archive) await saveArchiveRows(roomId, rows, host);
      if (screen.length || meta) await this.screen.save(screen, meta);
    });
  }

  /** 設定の保持数を超えた古い配信を消す(受信中の部屋は残す)。 */
  private async pruneArchive(): Promise<void> {
    const keep = this.getSettings().archiveKeepStreams;
    const streams = await listStreams();
    for (const roomId of streamsToPrune(streams, keep, this.room.roomId)) await deleteStream(roomId);
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
    if (this.pending) {
      this.pending.push([type, data, now]);
      return;
    }
    const e = normalize(type, data, now);
    if (!e) return;
    this.apply(e, now);
  }

  private apply(e: NormalizedEvent, now: number): void {
    switch (e.kind) {
      case 'roomInfo': {
        if (e.roomId !== this.room.roomId) {
          this.switchRoom(e.roomId, now, e.hostNickname, e.hostUniqueId);
        } else {
          this.room = { ...this.room, hostNickname: e.hostNickname ?? this.room.hostNickname, hostUniqueId: e.hostUniqueId ?? this.room.hostUniqueId };
        }
        this.roomFromInfo = true;
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

    // roomInfo が来ない・読めないと来店を数えられず全員「初見」になる。common.roomId で部屋を補う。
    // roomInfo で確定した部屋は上書きしない。
    if (e.roomId && e.roomId !== this.room.roomId && !this.roomFromInfo) {
      this.switchRoom(e.roomId, now);
      this.notify();
    }

    const v = viewerOf(e);
    if (!v) return;
    const meta = (this.demoVisits ?? this.visits).touch(v, now);
    if (e.kind === 'gift') this.catalog.observe(e, now);
    const next = applyEvent(this.feed, e, meta, e.kind === 'gift' ? this.catalog.iconOf(e.giftId) : undefined, now);
    if (next !== this.feed) {
      // デモは本物のアーカイブ・画面の履歴に残さない。roomInfo 前の行(部屋が不明)も残さない。
      if (next.lastTouched && this.room.roomId && !this.parkedFeed) {
        if (this.getSettings().archiveEnabled) this.archiveDirty.set(next.lastTouched.id, { roomId: this.room.roomId, row: next.lastTouched });
        this.rememberScreen(next.lastTouched, this.room.roomId);
      }
      this.feed = next;
      this.metaDirty = true;
      this.notify();
      // デモは fixture の createTime が固定値なので鮮度は見ない。
      if (e.kind === 'social' && e.sub === 'follow' && (this.demoStop != null || now - e.tsMs <= FOLLOW_NOTICE_MAX_AGE_MS)) {
        const n: FollowNotice = { viewer: v, visits: meta.visits, firstEver: meta.firstEver, tsMs: e.tsMs };
        for (const l of this.followListeners) l(n);
      }
    }
  }

  /**
   * 配信が変わった。画面の行は残したまま、境目に区切りを入れて集計をやり直す。
   * roomInfo で確定した部屋は common.roomId では上書きしない(roomFromInfo)。
   */
  private switchRoom(roomId: string, now: number, hostNickname?: string, hostUniqueId?: string): void {
    const next = enterRoom(this.feed, roomId, { hostNickname, now });
    if (next !== this.feed) {
      const mark = next.rows[next.rows.length - 1];
      if (mark && mark.k === 'room' && mark !== this.feed.rows[this.feed.rows.length - 1]) this.rememberScreen(mark, roomId);
      this.feed = next;
      this.metaDirty = true;
    }
    this.room = { roomId, hostNickname, hostUniqueId };
    this.roomFromInfo = false;
    (this.demoVisits ?? this.visits).setRoom(roomId);
    if (!this.parkedFeed) void this.persist().then(() => this.pruneArchive());
  }

  /** 画面の履歴に 1 件積む(連打の更新で呼び直しても、保存側が並び順を引き継ぐ)。 */
  private rememberScreen(item: FeedItem, roomId: string): void {
    if (this.parkedFeed) return;
    this.screenDirty.set(item.id, { ...item, roomId, seq: this.nextSeq() } as ScreenItem);
  }

  private nextSeq(): number {
    this.lastSeq = Math.max(this.lastSeq + 1, Date.now() * 1000);
    return this.lastSeq;
  }

  // ── デモ再生(ネット不要) ─────────────────────────────────────────

  /** 既存 fixtures 形式(`{o, type, data}` の ndjson)を時間どおりに流す。 */
  playDemo(lines: Array<{ o: number; type?: string; data?: unknown }>, speed = 1): void {
    this.socket?.stop();
    this.socket = null;
    this.stopDemo();
    // 本物の画面は退避し、デモは空の画面で流す(デモで本物の履歴が消えない)。
    this.parkedFeed ??= this.feed;
    this.feed = createFeedState();
    this.screenEpoch++;
    const roomId = `demo-${Date.now()}`;
    // 見本として「常連」「2回目」「初見」が混ざるように種を入れる(保存はしない)。
    const t0 = Date.now() - 7 * 24 * 3600 * 1000;
    this.demoVisits = new VisitCounter([
      { userId: '1', visits: 12, lastRoomId: 'demo-old', firstSeenMs: t0, lastSeenMs: t0 },
      { userId: '3', visits: 1, lastRoomId: 'demo-old', firstSeenMs: t0, lastSeenMs: t0 },
      { userId: '4', visits: 40, lastRoomId: 'demo-old', firstSeenMs: t0, lastSeenMs: t0 },
      { userId: '5', visits: 4, lastRoomId: 'demo-old', firstSeenMs: t0, lastSeenMs: t0 },
    ]);
    // 見本のメモ(たろう = モデ)。デモ中に書いたメモもこの使い捨て帳に入り、本物には残らない。
    this.demoMemos = new MemoBook([{ userId: '4', note: 'モデさん。ゲームの話が好き', kana: 'たろう', updatedMs: t0, nickname: 'たろう', uniqueId: 'taro.t' }]);
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
      this.demoMemos = null;
      // デモの部屋を本物の来店カウンタに残さない。次の roomInfo で切り替わる。
      this.room = { roomId: '' };
      this.roomFromInfo = false;
      // 退避しておいた本物の画面に戻す。
      this.feed = this.parkedFeed ?? createFeedState();
      this.parkedFeed = null;
      this.screenEpoch++;
    }
  }

  // ── 設定画面から ─────────────────────────────────────────────────

  /** 来店回数を全消去する。リスナーメモは残す。 */
  async resetHistory(): Promise<void> {
    this.visits.clear();
    await clearVisits();
    this.notify();
  }

  // ── リスナーメモ ─────────────────────────────────────────────────

  /** メモを書く(両方空なら削除)。デモ中は使い捨て帳に書く。すぐ保存する。 */
  setMemo(userId: string, patch: MemoPatch, now = Date.now()): MemoRecord | null {
    const book = this.demoMemos ?? this.memos;
    const r = book.set(userId, patch, now);
    this.notify();
    if (book === this.memos) void this.persist();
    return r;
  }

  getMemo(userId: string): MemoRecord | undefined {
    return (this.demoMemos ?? this.memos).get(userId);
  }

  get memoCount(): number {
    return this.memos.size;
  }

  /** リスナー一覧(来店履歴 + メモ)。最近来た順。来店履歴の無いメモだけの人は末尾。 */
  viewersForList(): ViewerListItem[] {
    const out: ViewerListItem[] = [];
    const seen = new Set<string>();
    for (const v of this.visits.all()) {
      seen.add(v.userId);
      const memo = this.memos.get(v.userId);
      out.push({ userId: v.userId, nickname: v.nickname, uniqueId: v.uniqueId, avatarUrl: v.avatarUrl, visits: v.visits, lastSeenMs: v.lastSeenMs, memo });
    }
    out.sort((a, b) => b.lastSeenMs - a.lastSeenMs);
    for (const m of this.memos.all()) {
      if (seen.has(m.userId)) continue;
      out.push({ userId: m.userId, nickname: m.nickname, uniqueId: m.uniqueId, visits: 0, lastSeenMs: 0, memo: m });
    }
    return out;
  }

  // ── バックアップ ─────────────────────────────────────────────────

  /** 保存待ちを書き切ってから、来店履歴・ギフトカタログ・メモ(と任意でアーカイブ)の全件を返す。 */
  async exportData(o: { includeArchive?: boolean } = {}): Promise<{ visits: VisitRecord[]; gifts: GiftCatalogRecord[]; memos: MemoRecord[]; archive?: ArchiveBackup }> {
    await this.persist();
    const out: { visits: VisitRecord[]; gifts: GiftCatalogRecord[]; memos: MemoRecord[]; archive?: ArchiveBackup } = { visits: this.visits.all(), gifts: this.catalog.all(), memos: this.memos.all() };
    if (o.includeArchive) out.archive = await loadAllArchive();
    return out;
  }

  /** バックアップを取り込み、IndexedDB に反映する。 */
  async importData(o: { visits: VisitRecord[]; gifts: GiftCatalogRecord[]; memos?: MemoRecord[]; archive?: ArchiveBackup | null; mode: 'merge' | 'replace' }): Promise<{ added: number; updated: number; gifts: number; memos: number; streams: number }> {
    const r = this.visits.import(o.visits, o.mode);
    const gifts = this.catalog.import(o.gifts);
    const memos = this.memos.import(o.memos ?? [], o.mode);
    if (o.mode === 'replace') {
      this.visits.drainDirty();
      this.memos.drainDirty();
      await replaceVisits(this.visits.all());
      await replaceMemos(this.memos.all());
    }
    await this.persist();
    const streams = await this.importArchive(o.archive ?? null, o.mode);
    this.notify();
    return { ...r, gifts, memos, streams };
  }

  /**
   * アーカイブの取り込み。行は id で上書きし、集計は保存側が差分で数え直すので
   * 統合でも二重計上しない。配信レコードの host 名だけバックアップの値を引き継ぐ。
   */
  private async importArchive(a: ArchiveBackup | null, mode: 'merge' | 'replace'): Promise<number> {
    if (!a || a.rows.length === 0) return 0;
    if (mode === 'replace') await clearArchive();
    const hostOf = new Map<string, StreamRecord>();
    for (const s of a.streams) hostOf.set(s.roomId, s);
    const byRoom = new Map<string, FeedRow[]>();
    for (const { roomId, ...row } of a.rows) {
      let list = byRoom.get(roomId);
      if (!list) byRoom.set(roomId, (list = []));
      list.push(row as FeedRow);
    }
    for (const [roomId, rows] of byRoom) {
      const s = hostOf.get(roomId);
      await saveArchiveRows(roomId, rows, { hostUniqueId: s?.hostUniqueId, hostNickname: s?.hostNickname });
    }
    await this.pruneArchive();
    return byRoom.size;
  }

  // ── アーカイブ(閲覧画面から) ───────────────────────────────────

  /** 配信の一覧(新しい順)。受信中の行も書き切ってから返す。 */
  async listArchive(): Promise<StreamRecord[]> {
    await this.persist();
    return listStreams();
  }

  async loadArchivedStream(roomId: string): Promise<FeedRow[]> {
    await this.persist();
    return loadStreamRows(roomId);
  }

  async deleteArchivedStream(roomId: string): Promise<void> {
    for (const [id, d] of this.archiveDirty) if (d.roomId === roomId) this.archiveDirty.delete(id);
    await deleteStream(roomId);
  }

  async clearArchive(): Promise<void> {
    this.archiveDirty.clear();
    await clearArchive();
  }

  // ── 画面の履歴 ───────────────────────────────────────────────────

  /** いま画面にある行(書き出し用。配信の区切りは含まない)。 */
  get rows(): FeedRow[] {
    return dataRows(this.feed.rows);
  }

  get roomInfo(): RoomState {
    return this.room;
  }

  /**
   * 🧹 画面の行を消す。🗂 アーカイブ・💎・タブの数(この配信の集計)は残す。
   * 連打の途中のギフト行だけは残して、続きの ×N が迷子にならないようにする。
   */
  resetScreen(): void {
    this.feed = clearRows(this.feed);
    this.screenEpoch++;
    // デモの画面を消しているときは、退避中の本物の履歴とストアには触らない。
    if (!this.parkedFeed) {
      this.screenDirty.clear();
      const roomId = this.room.roomId || this.feed.roomId;
      const items = this.feed.rows.map((r) => ({ ...r, roomId: r.k === 'room' ? r.roomId : roomId, seq: this.nextSeq() }) as ScreenItem);
      const meta = toScreenMeta(this.feed);
      this.metaDirty = false;
      void this.queue(() => this.screen.replace(items, meta));
    }
    this.notify();
  }
}
