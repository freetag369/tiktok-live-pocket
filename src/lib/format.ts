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

/** 残り秒(切り上げ)。過去なら 0。 */
export function secondsUntil(ms: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((ms - now) / 1000));
}
