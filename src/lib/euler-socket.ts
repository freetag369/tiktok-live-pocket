/**
 * Euler Stream Cloud WebSocket の接続状態機械。
 *
 * ブラウザの WebSocket を直接使い、切断コードごとに次の行動を決める。
 * iOS Safari はバックグラウンドで WebSocket を落とすので、前面復帰(visibilitychange)で
 * 閉じていれば即つなぎ直す(呼び出し側が `wake()` を呼ぶ)。
 */

export type SocketState =
  | { s: 'idle' }
  | { s: 'connecting'; attempt: number }
  | { s: 'live'; sinceMs: number }
  | { s: 'waitingLive'; nextTryMs: number; givesUpMs: number }
  | { s: 'reconnecting'; attempt: number; nextTryMs: number; reason: string }
  | { s: 'ended'; reason: string }
  | { s: 'error'; message: string; fatal: boolean };

export interface EulerBundle {
  timestamp?: number;
  messages?: Array<{ type: string; data: unknown }>;
}

export interface SocketSink {
  state(s: SocketState): void;
  message(type: string, data: unknown): void;
}

export interface SocketDeps {
  /** URL を毎回作り直す(設定変更を拾うため)。 */
  makeUrl: () => string;
  sink: SocketSink;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  makeSocket?: (url: string) => WebSocketLike;
}

export interface WebSocketLike {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(code?: number, reason?: string): void;
}

/** Euler の切断コード(SDK の ClientCloseCode より)。 */
export const CLOSE = {
  NORMAL: 1000,
  INTERNAL: 1011,
  STREAM_END: 4005,
  NO_MESSAGES_TIMEOUT: 4006,
  INVALID_OPTIONS: 4400,
  INVALID_AUTH: 4401,
  NO_PERMISSION: 4403,
  NOT_LIVE: 4404,
  TOO_MANY_CONNECTIONS: 4429,
  TIKTOK_CLOSED: 4500,
  MAX_LIFETIME: 4555,
  WEBCAST_FETCH_ERROR: 4556,
  ROOM_INFO_FETCH_ERROR: 4557,
} as const;

export type CloseAction =
  | { action: 'stopEnded'; reason: string }
  | { action: 'waitLive'; delayMs: number }
  | { action: 'retry'; delayMs: number; reason: string }
  | { action: 'fatal'; message: string };

export const WAIT_LIVE_POLL_MS = 60_000;
export const WAIT_LIVE_MAX_MS = 4 * 60 * 60 * 1000;
export const RATE_LIMIT_BACKOFF_MS = 60_000;
export const BACKOFF_MIN_MS = 2_000;
export const BACKOFF_MAX_MS = 30_000;

/** 切断コード → 次の行動(純粋関数・テスト対象)。 */
export function decideOnClose(code: number, attempt: number, wasLive: boolean): CloseAction {
  switch (code) {
    case CLOSE.STREAM_END:
      return { action: 'stopEnded', reason: '配信が終了しました' };
    case CLOSE.NOT_LIVE:
      return { action: 'waitLive', delayMs: WAIT_LIVE_POLL_MS };
    case CLOSE.TOO_MANY_CONNECTIONS:
      return { action: 'retry', delayMs: RATE_LIMIT_BACKOFF_MS, reason: '接続が多すぎます(1分待機)' };
    case CLOSE.INVALID_AUTH:
      return { action: 'fatal', message: 'API キーが正しくありません。設定を確認してください。' };
    case CLOSE.NO_PERMISSION:
      return { action: 'fatal', message: 'このアカウントに接続する権限がありません。' };
    case CLOSE.INVALID_OPTIONS:
      return { action: 'fatal', message: '配信者名か API キーの形式が不正です。設定を確認してください。' };
    case CLOSE.NORMAL:
      // こちらから閉じた場合は呼び出し側が先に stopped にしている。サーバー側の正常終了は再接続。
      return { action: 'retry', delayMs: backoff(attempt), reason: '切断されました' };
    case CLOSE.MAX_LIFETIME:
      return { action: 'retry', delayMs: BACKOFF_MIN_MS, reason: '8時間の上限に達したため再接続' };
    case CLOSE.NO_MESSAGES_TIMEOUT:
      return { action: 'retry', delayMs: wasLive ? BACKOFF_MIN_MS : backoff(attempt), reason: '無通信のため再接続' };
    default:
      return { action: 'retry', delayMs: backoff(attempt), reason: `切断(${code})` };
  }
}

export function backoff(attempt: number): number {
  const n = Math.max(0, attempt - 1);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** n);
}

export class EulerSocket {
  private ws: WebSocketLike | null = null;
  private stopped = true;
  private attempt = 0;
  private wasLive = false;
  private timer: unknown = null;
  private waitLiveSinceMs = 0;
  private state: SocketState = { s: 'idle' };
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly makeSocket: (url: string) => WebSocketLike;

  constructor(private readonly deps: SocketDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.makeSocket = deps.makeSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  }

  get current(): SocketState {
    return this.state;
  }

  get isRunning(): boolean {
    return !this.stopped;
  }

  start(): void {
    this.stopped = false;
    this.attempt = 0;
    this.wasLive = false;
    this.waitLiveSinceMs = 0;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.cancelTimer();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close(CLOSE.NORMAL, 'user');
      } catch {
        /* already closed */
      }
    }
    this.set({ s: 'idle' });
  }

  /**
   * 前面復帰時に呼ぶ。待機中(タイマー)なら即座に試し、閉じたまま放置されていたら開く。
   */
  wake(): void {
    if (this.stopped) return;
    if (this.ws && this.ws.readyState <= 1) return; // CONNECTING / OPEN
    this.cancelTimer();
    this.open();
  }

  private set(s: SocketState): void {
    this.state = s;
    this.deps.sink.state(s);
  }

  private cancelTimer(): void {
    if (this.timer != null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private open(): void {
    if (this.stopped) return;
    this.cancelTimer();
    this.attempt++;
    this.set({ s: 'connecting', attempt: this.attempt });

    let url: string;
    try {
      url = this.deps.makeUrl();
    } catch (e) {
      this.stopped = true;
      this.set({ s: 'error', message: String((e as Error)?.message ?? e), fatal: true });
      return;
    }

    let ws: WebSocketLike;
    try {
      ws = this.makeSocket(url);
    } catch (e) {
      this.scheduleRetry(backoff(this.attempt), `接続できません: ${String((e as Error)?.message ?? e)}`);
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.attempt = 0;
      this.wasLive = true;
      this.waitLiveSinceMs = 0;
      this.set({ s: 'live', sinceMs: this.now() });
    };

    ws.onmessage = (ev) => {
      if (ws !== this.ws) return;
      const raw = ev.data;
      if (typeof raw !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      this.dispatch(parsed);
    };

    ws.onerror = () => {
      /* onclose が続けて来るのでそこで扱う */
    };

    ws.onclose = (ev) => {
      if (ws !== this.ws) return;
      this.ws = null;
      if (this.stopped) return;
      const d = decideOnClose(ev.code, this.attempt, this.wasLive);
      this.wasLive = false;
      switch (d.action) {
        case 'stopEnded':
          this.stopped = true;
          this.set({ s: 'ended', reason: d.reason });
          return;
        case 'fatal':
          this.stopped = true;
          this.set({ s: 'error', message: d.message, fatal: true });
          return;
        case 'waitLive': {
          const now = this.now();
          if (!this.waitLiveSinceMs) this.waitLiveSinceMs = now;
          const givesUpMs = this.waitLiveSinceMs + WAIT_LIVE_MAX_MS;
          if (now >= givesUpMs) {
            this.stopped = true;
            this.set({ s: 'error', message: '配信待ちの上限(4時間)に達しました。もう一度「接続」を押してください。', fatal: false });
            return;
          }
          this.attempt = 0;
          this.set({ s: 'waitingLive', nextTryMs: now + d.delayMs, givesUpMs });
          this.timer = this.setTimer(() => this.open(), d.delayMs);
          return;
        }
        case 'retry':
          this.scheduleRetry(d.delayMs, d.reason);
          return;
      }
    };
  }

  private scheduleRetry(delayMs: number, reason: string): void {
    if (this.stopped) return;
    this.set({ s: 'reconnecting', attempt: this.attempt, nextTryMs: this.now() + delayMs, reason });
    this.timer = this.setTimer(() => this.open(), delayMs);
  }

  private dispatch(parsed: unknown): void {
    if (!parsed || typeof parsed !== 'object') return;
    const b = parsed as EulerBundle & { type?: string; data?: unknown };
    if (Array.isArray(b.messages)) {
      for (const m of b.messages) {
        if (m && typeof m === 'object' && typeof m.type === 'string') this.deps.sink.message(m.type, m.data);
      }
      return;
    }
    // bundleEvents=false のときの単発形。
    if (typeof b.type === 'string') this.deps.sink.message(b.type, b.data);
  }
}
