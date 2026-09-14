import { describe, expect, it } from 'vitest';
import { backoff, CLOSE, decideOnClose, EulerSocket, type SocketState, type WebSocketLike } from '../src/lib/euler-socket';
import { buildEulerUrl, redactUrl } from '../src/lib/euler-url';

describe('decideOnClose', () => {
  it('切断コード → 次の行動', () => {
    expect(decideOnClose(CLOSE.STREAM_END, 1, true).action).toBe('stopEnded');
    expect(decideOnClose(CLOSE.NOT_LIVE, 1, false)).toEqual({ action: 'waitLive', delayMs: 60_000 });
    expect(decideOnClose(CLOSE.TOO_MANY_CONNECTIONS, 1, false)).toMatchObject({ action: 'retry', delayMs: 60_000 });
    expect(decideOnClose(CLOSE.INVALID_AUTH, 1, false).action).toBe('fatal');
    expect(decideOnClose(CLOSE.INVALID_OPTIONS, 1, false).action).toBe('fatal');
    expect(decideOnClose(CLOSE.NO_PERMISSION, 1, false).action).toBe('fatal');
    expect(decideOnClose(CLOSE.MAX_LIFETIME, 1, true)).toMatchObject({ action: 'retry', delayMs: 2_000 });
    expect(decideOnClose(CLOSE.TIKTOK_CLOSED, 3, true)).toMatchObject({ action: 'retry', delayMs: 8_000 });
    expect(decideOnClose(1006, 10, false)).toMatchObject({ action: 'retry', delayMs: 30_000 });
  });

  it('backoff は 2s から倍々で 30s 上限', () => {
    expect([1, 2, 3, 4, 5, 9].map(backoff)).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);
  });
});

describe('buildEulerUrl', () => {
  it('uniqueId / apiKey / feature flags を付ける', () => {
    const u = new URL(buildEulerUrl({ baseUrl: 'wss://ws.eulerstream.com', uniqueId: 'metafact8', apiKey: 'k', closeInactiveAfterSec: 120 }));
    expect(u.searchParams.get('uniqueId')).toBe('metafact8');
    expect(u.searchParams.get('apiKey')).toBe('k');
    expect(u.searchParams.get('bundleEvents')).toBe('true');
    expect(u.searchParams.get('closeInactiveWebSocketAfter')).toBe('120');
    expect(redactUrl(u.toString())).toContain('apiKey=***');
  });
});

/** setTimeout を手で進めるフェイクと、開閉を手で起こすフェイク WebSocket。 */
function harness() {
  const timers: Array<{ fn: () => void; ms: number; id: number }> = [];
  let nextId = 1;
  let now = 1_000_000;
  const sockets: Array<WebSocketLike & { url: string }> = [];
  const states: SocketState[] = [];
  const messages: Array<{ type: string; data: unknown }> = [];
  const sock = new EulerSocket({
    makeUrl: () => 'wss://example/?uniqueId=x',
    sink: { state: (s) => states.push(s), message: (type, data) => messages.push({ type, data }) },
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ fn, ms, id });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    makeSocket: (url) => {
      const ws = { url, readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null, close() { this.readyState = 3; } } as WebSocketLike & { url: string };
      sockets.push(ws);
      return ws;
    },
  });
  const fire = () => {
    const t = timers.shift();
    if (!t) throw new Error('no timer');
    now += t.ms;
    t.fn();
    return t.ms;
  };
  return { sock, sockets, states, messages, timers, fire, tick: (ms: number) => (now += ms) };
}

describe('EulerSocket', () => {
  it('open → live、bundle を分解して message を流す', () => {
    const h = harness();
    h.sock.start();
    const ws = h.sockets[0]!;
    ws.readyState = 1;
    ws.onopen!({});
    expect(h.states.at(-1)).toMatchObject({ s: 'live' });
    ws.onmessage!({ data: JSON.stringify({ timestamp: 1, messages: [{ type: 'roomInfo', data: { id_str: '1' } }, { type: 'WebcastChatMessage', data: { comment: 'x' } }] }) });
    expect(h.messages.map((m) => m.type)).toEqual(['roomInfo', 'WebcastChatMessage']);
  });

  it('NOT_LIVE → 配信待ちで 60 秒後に再試行(attempt は増えない)', () => {
    const h = harness();
    h.sock.start();
    h.sockets[0]!.onclose!({ code: CLOSE.NOT_LIVE, reason: '' });
    expect(h.states.at(-1)).toMatchObject({ s: 'waitingLive' });
    expect(h.fire()).toBe(60_000);
    expect(h.sockets).toHaveLength(2);
    expect(h.states.at(-1)).toMatchObject({ s: 'connecting', attempt: 1 });
  });

  it('STREAM_END → ended で止まり、タイマーは残らない', () => {
    const h = harness();
    h.sock.start();
    h.sockets[0]!.onclose!({ code: CLOSE.STREAM_END, reason: '' });
    expect(h.states.at(-1)).toMatchObject({ s: 'ended' });
    expect(h.timers).toHaveLength(0);
    expect(h.sock.isRunning).toBe(false);
  });

  it('INVALID_AUTH → fatal error', () => {
    const h = harness();
    h.sock.start();
    h.sockets[0]!.onclose!({ code: CLOSE.INVALID_AUTH, reason: '' });
    expect(h.states.at(-1)).toMatchObject({ s: 'error', fatal: true });
  });

  it('不明な切断はバックオフで再接続、wake() で即時に前倒し', () => {
    const h = harness();
    h.sock.start();
    h.sockets[0]!.onclose!({ code: 1006, reason: '' });
    expect(h.states.at(-1)).toMatchObject({ s: 'reconnecting', attempt: 1 });
    expect(h.timers[0]!.ms).toBe(2000);
    h.sock.wake();
    expect(h.timers).toHaveLength(0);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.onclose!({ code: 1006, reason: '' });
    expect(h.timers[0]!.ms).toBe(4000);
  });

  it('live 中の wake() は何もしない', () => {
    const h = harness();
    h.sock.start();
    const ws = h.sockets[0]!;
    ws.readyState = 1;
    ws.onopen!({});
    h.sock.wake();
    expect(h.sockets).toHaveLength(1);
  });

  it('stop() 後は onclose が来ても再接続しない', () => {
    const h = harness();
    h.sock.start();
    const ws = h.sockets[0]!;
    h.sock.stop();
    ws.onclose?.({ code: 1006, reason: '' });
    expect(h.sockets).toHaveLength(1);
    expect(h.states.at(-1)).toEqual({ s: 'idle' });
  });

  it('捨てた古いソケットからの onclose は無視される', () => {
    const h = harness();
    h.sock.start();
    const old = h.sockets[0]!;
    old.onclose!({ code: 1006, reason: '' });
    h.fire();
    const cur = h.sockets[1]!;
    cur.readyState = 1;
    cur.onopen!({});
    old.onclose!({ code: 1006, reason: '' });
    expect(h.states.at(-1)).toMatchObject({ s: 'live' });
  });
});
