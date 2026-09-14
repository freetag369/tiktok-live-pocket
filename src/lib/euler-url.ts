/**
 * Euler Stream Cloud WebSocket の接続 URL。
 * SDK(@eulerstream/euler-websocket-sdk)の createWebSocketUrl と同じクエリを組む。
 * 依存を増やさないために自前(数十行)。
 */
export interface EulerUrlOptions {
  baseUrl: string;
  uniqueId: string;
  apiKey?: string;
  jwtKey?: string;
  /** TikTok から何秒メッセージが無ければ切るか(30〜3600・既定 60)。 */
  closeInactiveAfterSec?: number;
}

export function buildEulerUrl(o: EulerUrlOptions): string {
  const u = new URL(o.baseUrl);
  u.searchParams.set('uniqueId', o.uniqueId);
  if (o.apiKey) u.searchParams.set('apiKey', o.apiKey);
  if (o.jwtKey) u.searchParams.set('jwtKey', o.jwtKey);
  // 複数イベントを 1 通にまとめる(既定 true だが明示)。
  u.searchParams.set('bundleEvents', 'true');
  u.searchParams.set('normalizeUniqueId', 'true');
  u.searchParams.set('schemaVersion', 'v2');
  if (o.closeInactiveAfterSec) {
    const sec = Math.min(3600, Math.max(30, Math.floor(o.closeInactiveAfterSec)));
    u.searchParams.set('closeInactiveWebSocketAfter', String(sec));
  }
  return u.toString();
}

/** ログ・画面表示用: apiKey を伏せた URL。 */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has('apiKey')) u.searchParams.set('apiKey', '***');
    if (u.searchParams.has('jwtKey')) u.searchParams.set('jwtKey', '***');
    return u.toString();
  } catch {
    return url;
  }
}
