export type FontSize = 'small' | 'medium' | 'large';

export interface Settings {
  /** 配信者の @ハンドル(@ なし)。 */
  hostUniqueId: string;
  /** Euler Stream API キー。iPhone のこのブラウザにだけ保存される。 */
  eulerApiKey: string;
  showAvatars: boolean;
  fontSize: FontSize;
  /** この💎以上のギフトを大きく強調する。 */
  bigGiftDiamonds: number;
  wakeLock: boolean;
  /** フォローされたら画面上部にポップアップを出す。 */
  followPopup: boolean;
  /** いいねを右下のポップアップで知らせる。 */
  likePopup: boolean;
  /** 常連さん(来店 5 回以上・メモのある人)の入室を画面上部のポップアップで知らせる(前回のメモ付き)。 */
  regularPopup: boolean;
  /** 詳細: 接続先。LAN のモックサーバーで結線確認するときだけ変える。 */
  wsUrl: string;
  /** 受信した行を配信ごとに IndexedDB に残す(アーカイブ)。 */
  archiveEnabled: boolean;
  /** 残す配信の数。古い配信から自動で消える。 */
  archiveKeepStreams: number;
  /** メモ編集の「メモ」欄の上に出す定型文ボタン(TEMPLATE_SLOTS 枠。空の枠はボタンを出さない)。 */
  memoTemplates: string[];
  /** 同じく「前回」欄の上の定型文ボタン。 */
  previousTemplates: string[];
}

export const DEFAULT_WS_URL = 'wss://ws.eulerstream.com';

/** 定型文ボタンの枠数と、1 つの定型文の最大文字数。 */
export const TEMPLATE_SLOTS = 4;
export const TEMPLATE_MAX_LEN = 50;

export const DEFAULT_SETTINGS: Settings = {
  hostUniqueId: '',
  eulerApiKey: '',
  showAvatars: true,
  fontSize: 'medium',
  bigGiftDiamonds: 100,
  wakeLock: true,
  followPopup: true,
  likePopup: true,
  regularPopup: true,
  wsUrl: DEFAULT_WS_URL,
  archiveEnabled: true,
  archiveKeepStreams: 30,
  memoTemplates: ['初見', '常連', '誕生日', 'ギフト'],
  previousTemplates: ['ギフトのお礼', '前回の話の続き', 'フォローのお礼', 'バトル参加のお礼'],
};

export const ARCHIVE_KEEP_MIN = 1;
export const ARCHIVE_KEEP_MAX = 500;

const KEY = 'tiktok-live-pocket:settings:v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return sanitize({ ...DEFAULT_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(sanitize(s)));
  } catch {
    /* ストレージ不可(プライベートブラウズ等) */
  }
}

export function sanitize(s: Settings): Settings {
  return {
    ...s,
    hostUniqueId: normalizeUniqueId(s.hostUniqueId),
    eulerApiKey: (s.eulerApiKey ?? '').trim(),
    fontSize: (['small', 'medium', 'large'] as const).includes(s.fontSize) ? s.fontSize : 'medium',
    bigGiftDiamonds: Number.isFinite(Number(s.bigGiftDiamonds)) && Number(s.bigGiftDiamonds) >= 0 ? Number(s.bigGiftDiamonds) : 100,
    followPopup: s.followPopup !== false,
    likePopup: typeof s.likePopup === 'boolean' ? s.likePopup : true,
    regularPopup: typeof s.regularPopup === 'boolean' ? s.regularPopup : true,
    wsUrl: /^wss?:\/\//.test((s.wsUrl ?? '').trim()) ? s.wsUrl.trim() : DEFAULT_WS_URL,
    archiveEnabled: s.archiveEnabled !== false,
    archiveKeepStreams: clampKeep(s.archiveKeepStreams),
    memoTemplates: templates(s.memoTemplates, DEFAULT_SETTINGS.memoTemplates),
    previousTemplates: templates(s.previousTemplates, DEFAULT_SETTINGS.previousTemplates),
  };
}

/** 定型文の枠を TEMPLATE_SLOTS 個に揃える。配列でなければ既定。各枠は trim して TEMPLATE_MAX_LEN に切り詰め、空の枠は '' のまま残す。 */
function templates(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return [...fallback];
  const out: string[] = [];
  for (let i = 0; i < TEMPLATE_SLOTS; i++) {
    const t = v[i];
    out.push(typeof t === 'string' ? t.trim().slice(0, TEMPLATE_MAX_LEN) : '');
  }
  return out;
}

function clampKeep(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.archiveKeepStreams;
  return Math.min(ARCHIVE_KEEP_MAX, Math.max(ARCHIVE_KEEP_MIN, n));
}

/**
 * 「@name」「https://www.tiktok.com/@name/live」「name」→ 「name」。
 */
export function normalizeUniqueId(input: string): string {
  let s = (input ?? '').trim();
  const m = s.match(/tiktok\.com\/@([^/?#\s]+)/i);
  if (m?.[1]) s = m[1];
  s = s.replace(/^@+/, '');
  s = s.replace(/[/?#].*$/, '');
  return s.trim();
}
