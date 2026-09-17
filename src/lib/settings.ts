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
  /** 詳細: 接続先。LAN のモックサーバーで結線確認するときだけ変える。 */
  wsUrl: string;
}

export const DEFAULT_WS_URL = 'wss://ws.eulerstream.com';

export const DEFAULT_SETTINGS: Settings = {
  hostUniqueId: '',
  eulerApiKey: '',
  showAvatars: true,
  fontSize: 'medium',
  bigGiftDiamonds: 100,
  wakeLock: true,
  followPopup: true,
  wsUrl: DEFAULT_WS_URL,
};

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
    wsUrl: /^wss?:\/\//.test((s.wsUrl ?? '').trim()) ? s.wsUrl.trim() : DEFAULT_WS_URL,
  };
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
