function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function num(n: number): string {
  return new Intl.NumberFormat('ja-JP').format(Math.round(n));
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function hhmm(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function hhmmss(ms: number): string {
  const d = new Date(ms);
  return `${hhmm(ms)}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** 「今日 / 昨日 / N日前 / M/D(年が違えば YYYY/M/D)」。リスナー一覧の最終来店用。 */
export function relativeDay(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const n = new Date(now);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86_400_000);
  if (diff <= 0) return '今日';
  if (diff === 1) return '昨日';
  if (diff < 30) return `${diff}日前`;
  return d.getFullYear() === n.getFullYear() ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** `2026-09-15 01:30:05`(端末のローカル時刻)。 */
export function localIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** ファイル名用の日時 `20260915-0130`。 */
export function stamp(d = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function md(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 配信の期間 `2026/9/15 21:03〜23:40`。日をまたげば `2026/9/15 23:50〜9/16 01:10`。 */
export function dateRange(startMs: number, endMs: number): string {
  const a = new Date(startMs);
  const b = new Date(endMs);
  const sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const head = `${a.getFullYear()}/${md(a)} ${hhmm(startMs)}`;
  if (endMs <= startMs) return head;
  return `${head}〜${sameDay ? '' : md(b) + ' '}${hhmm(endMs)}`;
}

/** 残り秒(切り上げ)。過去なら 0。 */
export function secondsUntil(ms: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((ms - now) / 1000));
}
