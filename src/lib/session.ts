import type { LikeEvent, NormalizedEvent, Viewer } from './events';
import { viewerOf } from './events';
import { applyEvent, clearRows, createFeedState, dataRows, enterRoom, restoreFeed, toScreenMeta, type FeedItem, type FeedState, type ScreenItem, type ScreenMeta, type ViewerMeta } from './feed';
import { GiftCatalog } from './gift-catalog';
import { normalize } from './normalize';
import { VisitCounter } from './visits';
import { getDb, loadGiftCatalog, loadVisits, saveGiftCatalog, saveVisits, clearVisits, replaceVisits, loadMemos, saveMemos, replaceMemos, saveArchiveRows, listStreams, loadStreamRows, deleteStream, clearArchive, loadAllArchive, loadDayRows, loadScreen, saveScreen, replaceScreen, deleteScreenRows, type GiftCatalogRecord } from './db';
import { streamsToPrune, type ArchivedRow, type StreamRecord } from './archive';
import { BoundedSet, HighlightDay, actionKey, addLike, isAction, likeBucketStart, likeRowId, type LikeRow } from './highlights';
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
 * ハイライト(日別のメンバー一覧)は `watchHighlightDay` で開き、受信した行をその場で重ねる。
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
  /** アーカイブ用。本物のメモをデモ再生中も参照する。 */
  archiveMemos: ReadonlyMap<string, MemoRecord>;
  /**
   * ハイライトで使うメモ。デモ再生中はデモの使い捨て帳、それ以外は本物の帳。
   * デモが自然に終わった後は、本画面はまだデモの行(とデモの帳)だが、ハイライトは本物の行に戻るので本物の帳を渡す。
   * 書くときは `setMemo(..., { real: !demo })`。
   */
  highlightMemos: ReadonlyMap<string, MemoRecord>;
  /** 画面をまるごと入れ替えた回数(🧹・復元・デモの出入り)。FeedList の作り直しに使う。 */
  screenEpoch: number;
  /**
   * アーカイブを受信以外で書き換えた回数(取り込み・配信の削除・全消去・自動削除)。
   * ハイライトはこれが変わったときだけ IndexedDB を読み直す(受信 1 件ごとには読まない)。
   */
  archiveGeneration: number;
}

/** リスナー一覧の 1 行(来店履歴 + メモ)。 */
export interface ViewerListItem {
  userId: string;
  nickname?: string;
  uniqueId?: string;
  avatarUrl?: string;
  visits: number;
  lastSeenMs: number;
  lastJoinedMs?: number;
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

/** 復元(IndexedDB の読込)が遅くても、これを過ぎたら受信を画面に流す。IndexedDB が開いてから数える。 */
export const RESTORE_TIMEOUT_MS = 3000;

/**
 * IndexedDB が開く(版上げを含む)のを待つ上限。v5 の版上げは保存済みの行すべてに日付の索引を作るので、
 * 行が多いと数秒かかる。その間に届いた受信は溜めておき、読み終えてから数える(IndexedDB が固まったときだけこれで見切る)。
 */
export const OPEN_TIMEOUT_MS = 30_000;

/** ハイライトの保存済みの行がこれより遅ければ、受信中の行だけで先に開く(読めたら差し替える)。 */
export const HIGHLIGHT_LOAD_TIMEOUT_MS = RESTORE_TIMEOUT_MS;

/** 受け取ったギフトの msgId を覚えておく数(古い方から捨てる)。配信が変わったら空にする。 */
export const GIFT_SEEN_MAX = 5000;

/**
 * ハイライト用にメモリに持つ行の上限。保存できた行はすぐ捨てるので、ふだん残るのは
 * 保存 OFF・部屋が不明の行だけ。長い配信でも超えたら古く更新された方から捨てる
 * (捨てたことは `highlightMemoryTrimmed` でハイライトに出す)。
 */
export const HIGHLIGHT_MEMORY_MAX = 20_000;

/** 開いているハイライトの 1 日分(受信した行をその場で重ねる)。 */
interface HighlightWatcher {
  view: HighlightDay;
  /** デモ再生中に開いたもの(デモの行だけを重ねる)。 */
  demo: boolean;
  changed: () => void;
}

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
  /**
   * IndexedDB の読込(来店・カタログ・メモ・画面の履歴)が終わった。それまでは仮の入れ物で数え、
   * 来店・カタログ・メモ・画面の履歴は保存しない(読む前の仮の値で保存済みの記録を上書きしない)。
   */
  private loaded = false;
  /**
   * 読込が遅くて受信を先に流したので、保存してあった画面の履歴を画面に戻せなかった。
   * ストアの画面は次の起動で戻るよう、🧹 で置き換えるまで画面の履歴を書き足さない。
   */
  private screenHeld = false;
  /** 読込が終わる前に 🧹 でストアの画面を置き換えた(もう戻す画面は無い)。 */
  private screenReplacedEarly = false;
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
  /** アーカイブ保存待ちの行(id → 行)。1 秒ごとに IndexedDB へ。いいねの行は「まだ保存していない分」の数。 */
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
  /**
   * ハイライト用の受信中の行(key = actionKey)。コメント・いいね・ギフト・フォローだけ(入室・シェアは持たない)。
   * IndexedDB に書けた行はすぐ捨てるので、残るのは保存待ち・保存 OFF・部屋が不明('')の行だけ。
   * いいねの行は「まだ保存できていない分」の数を持つ。
   */
  private liveActions = new Map<string, ArchivedRow>();
  /**
   * liveActions のいいねの行が作られたときの番号(key → 番号)。消えて作り直されたら番号が変わる。
   * 保存が終わって「書けた分」を引くとき、保存を始めたときと同じ行かを確かめる
   * (全消去などで消えた後に届いた分から、消す前の保存を引かない)。
   */
  private likeGen = new Map<string, number>();
  private lastLikeGen = 0;
  /** 上限を超えて古い行を捨てた(保存 OFF の長い配信)。ハイライトに「古い記録は消えた」と出す。 */
  private liveTrimmed = false;
  /** デモ再生中の行(デモ中だけ見せる。保存しない)。 */
  private demoActions = new Map<string, ArchivedRow>();
  /** 受け取ったギフトの msgId。feed の seen(いいねでもすぐ溢れる)から落ちた後の再送でも連打を二重に数えない。 */
  private giftSeen = new BoundedSet(GIFT_SEEN_MAX);
  private highlightWatchers = new Set<HighlightWatcher>();
  /**
   * 最後に閉じたハイライトの 1 日分(key = 日付|世代|デモ)。閉じた後も受信を重ね続けるので、
   * タブを行き来しただけなら IndexedDB を読み直さずにそのまま使う。1 つだけ持つ。
   */
  private highlightCache: { key: string; w: HighlightWatcher } | null = null;
  private highlightMax: number;
  private archiveGeneration = 0;

  constructor(getSettings: () => Settings, o: { screenStore?: ScreenStore; highlightMemoryMax?: number } = {}) {
    this.getSettings = getSettings;
    this.screen = o.screenStore ?? indexedDbScreenStore;
    this.highlightMax = o.highlightMemoryMax ?? HIGHLIGHT_MEMORY_MAX;
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
    // IndexedDB が固まっても受信が止まらないよう、一定時間で待つのをやめる(溜めた受信を流す)。
    // 版上げ(索引づくり)は行が多いと長くかかるので、開くまでは長めに待ち、開いてからの読込は短めで見切る。
    let timer = setTimeout(() => this.releasePending(), OPEN_TIMEOUT_MS);
    try {
      await Promise.resolve()
        .then(getDb)
        .catch(() => undefined);
      clearTimeout(timer);
      timer = setTimeout(() => this.releasePending(), RESTORE_TIMEOUT_MS);
      const [v, g, m] = await Promise.all([loadVisits(), loadGiftCatalog(), loadMemos()]);
      this.adoptLoaded(v, g, m);
      const { items, meta } = await this.screen.load();
      this.restoreScreen(items, meta);
    } finally {
      clearTimeout(timer);
      // ここから来店・カタログ・メモ・画面の履歴を保存してよい。
      this.loaded = true;
      // 読込前に数えると保存済みの人まで「初見」になるので、溜めておいた分をここで流す。
      this.releasePending();
      this.notify();
    }
    await this.pruneArchive();
  }

  /**
   * 読み込んだ来店履歴・カタログ・メモに切り替える。読込の前に仮の入れ物へ入った分
   * (読込が遅くて先に流した受信、先に書いたメモ)は読み込んだ方へ移す。仮の入れ物のまま保存すると、
   * 保存済みの記録を visits:1 などで上書きしてしまう(persist は loaded まで書かない)。
   */
  private adoptLoaded(v: VisitRecord[], g: GiftCatalogRecord[], m: MemoRecord[]): void {
    const visits = new VisitCounter(v);
    // 仮のカウンタがいた部屋を引き継ぎ、そこで見かけた人を保存済みの記録から数え直す。
    visits.adopt(this.visits);
    const catalog = new GiftCatalog(g);
    catalog.adopt(this.catalog);
    const memos = new MemoBook(m);
    memos.adopt(this.memos);
    this.visits = visits;
    this.catalog = catalog;
    this.memos = memos;
  }

  /** 読み込んだ画面の履歴を戻す。受信を先に流していたら戻さず、ストアの画面を次の起動用に残す。 */
  private restoreScreen(items: ScreenItem[], meta: ScreenMeta | null): void {
    if (this.pending) {
      this.applyRestored(items, meta);
    } else if ((items.length > 0 || meta) && !this.screenReplacedEarly) {
      // タイムアウトで受信を先に流した画面には、保存してあった画面を戻せない。ストアの画面は次の起動で戻るよう、
      // 🧹 で置き換えるまで書き足さない(受信を先に流した画面の集計で、保存済みの集計・重複表を上書きしない)。
      this.screenHeld = true;
      this.screenDirty.clear();
      this.metaDirty = false;
      for (const it of items) if (it.seq > this.lastSeq) this.lastSeq = it.seq;
    }
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
      archiveMemos: this.memos.view(),
      highlightMemos: (this.demoStop != null ? (this.demoMemos ?? this.memos) : this.memos).view(),
      screenEpoch: this.screenEpoch,
      archiveGeneration: this.archiveGeneration,
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
    // 読込が終わるまでは来店・カタログ・メモ・画面の履歴は取り出さない(仮の値で保存済みの記録を上書きしない)。
    const loaded = this.loaded;
    const v = loaded ? this.visits.drainDirty() : [];
    const g = loaded ? this.catalog.drainDirty() : [];
    const m = loaded ? this.memos.drainDirty() : { put: [], del: [] };
    const host = { hostUniqueId: this.room.hostUniqueId, hostNickname: this.room.hostNickname };
    const archive = new Map<string, FeedRow[]>();
    // 取り出した時点のいいねの行の番号(書けたときに、同じ行から引くため)。
    const gens = new Map<string, number | undefined>();
    for (const { roomId, row } of this.archiveDirty.values()) {
      let list = archive.get(roomId);
      if (!list) archive.set(roomId, (list = []));
      list.push(row);
      if (row.k === 'like') {
        const key = actionKey({ roomId, id: row.id });
        gens.set(key, this.likeGen.get(key));
      }
    }
    this.archiveDirty.clear();
    let screen: ScreenItem[] = [];
    let meta: ScreenMeta | null = null;
    if (loaded) {
      screen = [...this.screenDirty.values()];
      this.screenDirty.clear();
      meta = this.metaDirty && !this.parkedFeed && !this.screenHeld ? toScreenMeta(this.feed) : null;
      this.metaDirty = false;
    }
    if (!v.length && !g.length && !m.put.length && !m.del.length && archive.size === 0 && screen.length === 0 && !meta) return this.chain;
    return this.queue(async () => {
      if (v.length) await saveVisits(v);
      if (g.length) await saveGiftCatalog(g);
      if (m.put.length || m.del.length) await saveMemos(m.put, m.del);
      // いいねの行は「まだ保存していない分」なので保存済みの行に足す。書けた行はハイライトのメモリから外す。
      for (const [roomId, rows] of archive) if (await saveArchiveRows(roomId, rows, host, { addLikes: true })) this.releaseSaved(roomId, rows, gens);
      if (screen.length || meta) await this.screen.save(screen, meta);
    });
  }

  /**
   * IndexedDB に書けた行を、ハイライトのメモリから外す。書いている間に更新された行(連打の続きなど)は残し、
   * いいねは書けた分だけ引く(残りは次の保存で足す)。書いている間に全消去などで消えて作り直された
   * いいねの行(番号が違う)からは引かない(後から届いた分は、まだ書けていない)。
   */
  private releaseSaved(roomId: string, rows: FeedRow[], gens: ReadonlyMap<string, number | undefined>): void {
    for (const row of rows) {
      const key = actionKey({ roomId, id: row.id });
      const cur = this.liveActions.get(key);
      if (!cur) continue;
      if (row.k === 'like') {
        if (cur.k !== 'like' || this.likeGen.get(key) !== gens.get(key)) continue;
        const left = cur.count - row.count;
        if (left > 0) this.liveActions.set(key, { ...cur, count: left });
        else this.dropLive(key);
      } else if (cur === row) {
        this.dropLive(key);
      }
    }
  }

  /** ハイライトのメモリから 1 行捨てる(いいねの番号も一緒に)。 */
  private dropLive(key: string): void {
    this.liveActions.delete(key);
    this.likeGen.delete(key);
  }

  /** 設定の保持数を超えた古い配信を消す(受信中の部屋は残す)。保存の列に並べる。 */
  private pruneArchive(): Promise<void> {
    return this.queue(() => this.pruneNow());
  }

  /** 列の中から呼ぶ版(取り込みの途中など)。 */
  private async pruneNow(): Promise<void> {
    const keep = this.getSettings().archiveKeepStreams;
    const streams = await listStreams();
    const drop = streamsToPrune(streams, keep, this.room.roomId);
    for (const roomId of drop) {
      await deleteStream(roomId);
      this.forgetRoom(roomId);
    }
    if (drop.length) this.archiveChanged();
  }

  /** その配信の行をハイライトのメモリから捨てる(アーカイブの削除に合わせる)。 */
  private forgetRoom(roomId: string): void {
    for (const [key, row] of this.liveActions) if (row.roomId === roomId) this.dropLive(key);
  }

  /** アーカイブを受信以外で書き換えた(ハイライトは読み直す。取っておいた 1 日分も捨てる)。 */
  private archiveChanged(): void {
    this.archiveGeneration++;
    this.dropHighlightCache();
    this.notify();
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
    // ギフトの再送は、feed の seen から落ちた後でも数え直さない(連打の tick が新しい行になって二重に数えられる)。
    if (e.kind === 'gift' && this.giftSeen.has(e.msgId)) return;
    const meta = (this.demoVisits ?? this.visits).touch(v, now);
    if (e.kind === 'gift') this.catalog.observe(e, now);
    const next = applyEvent(this.feed, e, meta, e.kind === 'gift' ? this.catalog.iconOf(e.giftId) : undefined, now);
    if (next !== this.feed) {
      if (e.kind === 'gift') this.giftSeen.add(e.msgId);
      if (e.kind === 'join' && e.action === 1) (this.demoVisits ?? this.visits).recordJoin(v.userId, e.tsMs);
      const roomId = this.room.roomId;
      const touched = next.lastTouched;
      // ハイライトに数える行は、アーカイブ保存待ちとメモリで同じ物を持つ(書けたら同じ物かで外す)。
      const action = touched && isAction(touched) ? ({ ...touched, roomId } as ArchivedRow) : null;
      // デモは本物のアーカイブ・画面の履歴に残さない。roomInfo 前の行(部屋が不明)も残さない。
      if (touched && roomId && !this.parkedFeed) {
        if (this.getSettings().archiveEnabled) this.archiveDirty.set(touched.id, { roomId, row: action ?? touched });
        this.rememberScreen(touched, roomId);
      }
      // いいねは行を作らない(lastTouched は null)。アーカイブとハイライトには 1 分ごとにまとめて残す。
      if (e.kind === 'like') this.recordLike(e, meta, now);
      else if (action) this.recordAction(action, now);
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
    // feed の seen と同じく、ギフトの msgId も配信ごとに数え直す。
    this.giftSeen.clear();
    (this.demoVisits ?? this.visits).setRoom(roomId);
    if (!this.parkedFeed) void this.persist().then(() => this.pruneArchive());
  }

  // ── ハイライト ─────────────────────────────────────────────────

  /** コメント・ギフト・フォローの行をハイライトのメモリに置く(同じ行の更新は置き換え)。 */
  private recordAction(action: ArchivedRow, now: number): void {
    const demo = this.parkedFeed != null;
    // デモの fixture は createTime が固定値なので、受け取った時刻で「今日」に並べる。
    const row = demo ? ({ ...action, tsMs: now } as ArchivedRow) : action;
    this.keepAction(demo ? this.demoActions : this.liveActions, row);
    this.emitHighlight(row, demo);
  }

  /**
   * いいね 1 通を (配信, 人, 1 分) の行に足す。アーカイブには「まだ保存していない分」を貯め、
   * 保存するときに保存済みの同じ行へ足す(行は 1 つ・数は合計)。
   */
  private recordLike(e: LikeEvent, meta: ViewerMeta, now: number): void {
    const demo = this.parkedFeed != null;
    const roomId = this.room.roomId;
    const tsMs = demo ? now : e.tsMs;
    const row: LikeRow & { roomId: string } = {
      k: 'like',
      id: likeRowId(roomId, e.viewer.userId, likeBucketStart(tsMs)),
      roomId,
      tsMs,
      viewer: e.viewer,
      count: e.count,
      visits: meta.visits,
      firstEver: meta.firstEver,
    };
    if (!demo && roomId && this.getSettings().archiveEnabled) {
      const prev = this.archiveDirty.get(row.id)?.row;
      this.archiveDirty.set(row.id, { roomId, row: addLike(prev?.k === 'like' ? prev : undefined, row) });
    }
    const map = demo ? this.demoActions : this.liveActions;
    const key = actionKey(row);
    const prev = map.get(key);
    // 新しく作った行には番号を振る(保存が終わったときに、同じ行から引くか確かめる)。
    if (!demo && !prev) this.likeGen.set(key, ++this.lastLikeGen);
    this.keepAction(map, addLike(prev?.k === 'like' ? prev : undefined, row));
    // 開いている日には、この 1 通の分だけを足す。
    this.emitHighlight(row, demo);
  }

  /** 更新した行を後ろへ回し、上限を超えたら古く更新された方から捨てる。 */
  private keepAction(map: Map<string, ArchivedRow>, row: ArchivedRow): void {
    const key = actionKey(row);
    map.delete(key);
    map.set(key, row);
    while (map.size > this.highlightMax) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
      if (map === this.liveActions) {
        this.likeGen.delete(oldest);
        this.liveTrimmed = true;
      }
    }
  }

  private emitHighlight(row: ArchivedRow, demo: boolean): void {
    for (const w of this.highlightWatchers) {
      if (w.demo !== demo) continue;
      w.view.applyLive(row);
      w.changed();
    }
  }

  /**
   * ハイライトの 1 日分(日本時間)を開く。保存済みの行は開いたときに 1 回だけ読み、あとは受信した行をその場で重ねる。
   * 読み込みは保存の列に並べ、読み終えた瞬間にメモリに残っている(= まだ書けていない)行だけを重ねるので、
   * 書き込み中のいいねを二重に数えたり取りこぼしたりしない。
   * 保存の列が詰まって HIGHLIGHT_LOAD_TIMEOUT_MS を過ぎたら、受信中の行だけで先に開き(failed)、読めたら差し替える。
   * 閉じた 1 日分は受信を重ね続けて取っておき、同じ日・同じ世代をもう一度開いたら読み直さずに使う。
   * デモ再生中に開いたらデモの行だけ(保存済みは読まない)。
   * onChange は行が変わるたびに呼ぶ(描画は呼ぶ側で間引く)。戻り値で閉じる。
   */
  watchHighlightDay(day: string, onChange: (view: HighlightDay) => void): () => void {
    const demo = this.demoStop != null;
    const key = `${day}|${this.archiveGeneration}|${demo ? 'demo' : 'live'}`;
    const w: HighlightWatcher = { view: new HighlightDay(day), demo, changed: () => onChange(w.view) };
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const show = (view: HighlightDay) => {
      if (closed) return;
      w.view = view;
      this.highlightWatchers.add(w);
      w.changed();
    };
    const cached = this.takeHighlightCache(key);
    if (cached) {
      // タブを行き来しただけ。閉じている間も受信を重ねていた 1 日分をそのまま使う(IndexedDB は読まない)。
      w.view = cached;
      this.highlightWatchers.add(w);
      void Promise.resolve().then(() => {
        if (!closed) w.changed();
      });
    } else if (demo || !Number.isFinite(w.view.start)) {
      void Promise.resolve().then(() => show(this.buildHighlightDay(day, [], demo, false)));
    } else {
      const { start, end } = w.view;
      timer = setTimeout(() => {
        timer = null;
        // IndexedDB が固まって列が進まない: 受信中の行だけで先に開く(読めたら下で差し替える)。
        if (!w.view.loaded) show(this.buildHighlightDay(day, [], false, true));
      }, HIGHLIGHT_LOAD_TIMEOUT_MS);
      void this.queue(async () => {
        if (closed) return;
        let saved: ArchivedRow[] = [];
        let failed = false;
        try {
          // 入室・シェアは読みながら捨てる(1 日分を丸ごと抱えない)。
          saved = await loadDayRows(start, end, isAction);
        } catch {
          failed = true;
        }
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        show(this.buildHighlightDay(day, saved, false, failed));
      });
    }
    return () => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      this.highlightWatchers.delete(w);
      if (w.view.loaded && !w.view.failed) this.keepHighlightCache(key, w.view, demo);
    };
  }

  /** 保存済みの行に、いまメモリにある(= まだ書けていない)行を重ねた 1 日分。 */
  private buildHighlightDay(day: string, saved: ArchivedRow[], demo: boolean, failed: boolean): HighlightDay {
    const view = new HighlightDay(day);
    view.putSaved(saved);
    for (const row of (demo ? this.demoActions : this.liveActions).values()) view.applyLive(row);
    view.failed = failed;
    view.loaded = true;
    return view;
  }

  /** 閉じた 1 日分を取っておく(受信は重ね続ける)。前に取っておいた分は捨てる。 */
  private keepHighlightCache(key: string, view: HighlightDay, demo: boolean): void {
    this.dropHighlightCache();
    const w: HighlightWatcher = { view, demo, changed: () => {} };
    this.highlightWatchers.add(w);
    this.highlightCache = { key, w };
  }

  /** 取っておいた 1 日分を取り出す(key が違えば捨てて null)。 */
  private takeHighlightCache(key: string): HighlightDay | null {
    const c = this.highlightCache;
    this.dropHighlightCache();
    return c && c.key === key ? c.w.view : null;
  }

  private dropHighlightCache(): void {
    if (this.highlightCache) this.highlightWatchers.delete(this.highlightCache.w);
    this.highlightCache = null;
  }

  /** その日のハイライトの行(新しい順)を 1 回だけ取り出す。 */
  highlightsForDay(day: string): Promise<ArchivedRow[]> {
    return new Promise((resolve) => {
      const stop = this.watchHighlightDay(day, (view) => {
        stop();
        resolve(view.list());
      });
    });
  }

  /** ハイライト用にメモリに残っている行の数(保存待ち・保存 OFF・部屋不明の分)。 */
  get highlightRowsInMemory(): number {
    return this.liveActions.size;
  }

  /** メモリの上限(保存 OFF の長い配信)で、古い行を捨てたことがある(全消去まで)。 */
  get highlightMemoryTrimmed(): boolean {
    return this.liveTrimmed;
  }

  /** 画面の履歴に 1 件積む(連打の更新で呼び直しても、保存側が並び順を引き継ぐ)。 */
  private rememberScreen(item: FeedItem, roomId: string): void {
    if (this.parkedFeed || this.screenHeld) return;
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
    // デモは毎回同じ msgId を使うので、ハイライトのデモ行も毎回空から。
    this.demoActions.clear();
    this.dropHighlightCache();
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
      this.demoActions.clear();
      this.dropHighlightCache();
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
    // 読込の前に消すと、読み込んだ履歴で戻ってしまう。
    await this.ready;
    this.visits.clear();
    await clearVisits();
    this.notify();
  }

  // ── リスナーメモ ─────────────────────────────────────────────────

  /**
   * メモを書く(3 項目すべて空なら削除)。デモの画面を出している間は使い捨て帳に書く。すぐ保存する。
   * `real`: デモの帳が残っていても本物の帳に書く(デモが自然に終わり、ハイライトが本物の行を出しているとき)。
   */
  setMemo(userId: string, patch: MemoPatch, now = Date.now(), o: { real?: boolean } = {}): MemoRecord | null {
    const book = o.real ? this.memos : (this.demoMemos ?? this.memos);
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
      out.push({ userId: v.userId, nickname: v.nickname, uniqueId: v.uniqueId, avatarUrl: v.avatarUrl, visits: v.visits, lastSeenMs: v.lastSeenMs, lastJoinedMs: v.lastJoinedMs, memo });
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
    // 読込が終わる前は仮の入れ物しか無いので、読み終えてから書き出す。
    await this.ready;
    await this.persist();
    const out: { visits: VisitRecord[]; gifts: GiftCatalogRecord[]; memos: MemoRecord[]; archive?: ArchiveBackup } = { visits: this.visits.all(), gifts: this.catalog.all(), memos: this.memos.all() };
    if (o.includeArchive) out.archive = await loadAllArchive();
    return out;
  }

  /** バックアップを取り込み、IndexedDB に反映する。 */
  async importData(o: { visits: VisitRecord[]; gifts: GiftCatalogRecord[]; memos?: MemoRecord[]; archive?: ArchiveBackup | null; mode: 'merge' | 'replace' }): Promise<{ added: number; updated: number; gifts: number; memos: number; streams: number }> {
    // 読込の前に取り込むと、読み込んだ履歴で置き換わって消える。
    await this.ready;
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
    const hostOf = new Map<string, StreamRecord>();
    for (const s of a.streams) hostOf.set(s.roomId, s);
    const byRoom = new Map<string, FeedRow[]>();
    for (const { roomId, ...row } of a.rows) {
      let list = byRoom.get(roomId);
      if (!list) byRoom.set(roomId, (list = []));
      list.push(row as FeedRow);
    }
    // 置き換えならハイライトのメモリもアーカイブと一緒に捨てる(まだ書いていない保存待ちの行は、取り込みの後に書くので残す)。
    if (mode === 'replace') for (const [key, row] of this.liveActions) if (!this.archiveDirty.has(row.id)) this.dropLive(key);
    // 保存の列の中で書く(受信中の保存と前後しない)。いいねも合計値なので上書き(何度取り込んでも増えない)。
    await this.queue(async () => {
      if (mode === 'replace') await clearArchive();
      for (const [roomId, rows] of byRoom) {
        const s = hostOf.get(roomId);
        await saveArchiveRows(roomId, rows, { hostUniqueId: s?.hostUniqueId, hostNickname: s?.hostNickname });
      }
      await this.pruneNow();
    });
    // 取り込んだ(保存済みの)行を、取り込む前のメモリの行より優先する。
    // ただし取り込み中に届いてまだ書いていない行(保存待ち)は、この後の保存で書くので残す。
    for (const row of a.rows) if (!this.archiveDirty.has(row.id)) this.dropLive(actionKey(row));
    this.archiveChanged();
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
    // ハイライトの履歴もアーカイブの削除に合わせて消す。
    this.forgetRoom(roomId);
    // 先に並んだ保存が、消した後に行を戻さないよう列の後ろで消す。
    await this.queue(() => deleteStream(roomId));
    this.archiveChanged();
  }

  async clearArchive(): Promise<void> {
    this.archiveDirty.clear();
    this.liveActions.clear();
    this.likeGen.clear();
    this.liveTrimmed = false;
    await this.queue(() => clearArchive());
    this.archiveChanged();
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
      // 🧹 はストアの画面をいまの画面で置き換えるので、書き足しを止めていた(screenHeld)ならここから再開する。
      this.screenHeld = false;
      if (!this.loaded) this.screenReplacedEarly = true;
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
