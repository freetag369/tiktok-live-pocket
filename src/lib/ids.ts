/**
 * int64 の protobuf フィールドは JS では文字列で届く。Number にすると 19 桁の ID が
 * 精度落ちするので、ID は最後まで文字列のまま扱う(既存 PC アプリと同じ規約)。
 */
export function idStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return String(v);
}

export function numOr(v: unknown, fallback = 0): number {
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/**
 * 画像モデル → 最初に使える URL。
 * v2(Euler WS)は `Image.url[]`、v3(tiktok-live-connector)は `ImageModel.urlList[]`。
 */
export function pickUrl(img: unknown): string {
  const m = img as { url?: unknown; urlList?: unknown } | null | undefined;
  for (const list of [m?.url, m?.urlList]) {
    if (Array.isArray(list)) {
      for (const u of list) if (typeof u === 'string' && /^https?:\/\//.test(u)) return u;
    }
  }
  return '';
}

/**
 * 秒 / ミリ秒 / 文字列のどれで来ても ms に揃える。未来すぎる・古すぎる値は捨てて now を使う。
 */
export function toMs(raw: unknown, now: number): number {
  const n = numOr(raw, NaN);
  if (!Number.isFinite(n) || n <= 0) return now;
  const ms = n < 1e11 ? n * 1000 : n;
  const oneDay = 24 * 3600 * 1000;
  if (ms > now + oneDay || ms < now - 30 * oneDay) return now;
  return ms;
}
