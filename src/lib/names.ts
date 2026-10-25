/**
 * 表示名の決め方。
 *
 * 実配信ではニックネームが空で届くことは無い(PC 版 DB 2,953 人中 0 人)が、
 * 「画面に描けない文字だけ」の名前は 9 人いた(同 DB、2026-10 調査)。
 *   - 変異セレクタ単独(U+FE0F)、未割当の文字(U+FFF4)、土台の無い結合記号(U+0651 / U+0F80 U+0F72)
 *   - 端末の絵文字フォントが知らない新しい絵文字(Unicode 15/16)
 * こういう名前は `nickname || uniqueId` も `.trim()` も通過して空欄に見えるので、
 * 「描ける文字が 1 つも無い」ニックネームは無いものとして @ハンドル / ID に落とす。
 * 絵文字 1 文字だけの名前(🎁 など)は正当なので、そのまま出す。
 */

/** 描ける文字: 文字・数字・記号・句読点。結合記号(Mn)は土台の字が描けるので数えない。 */
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;
/** 文字カテゴリ上は「文字」だが何も描かれない字: ハングル詰め物(U+115F/U+1160/U+3164/U+FFA0)、点字の空白(U+2800)。 */
const BLANK_GLYPHS = /[\u115F\u1160\u3164\uFFA0\u2800]/gu;

/** 画面に描ける文字が 1 つでもあるか。 */
export function hasVisibleChar(s: string | undefined | null): boolean {
  if (!s) return false;
  return VISIBLE.test(s.replace(BLANK_GLYPHS, ''));
}

/** 描けない名前は undefined にする(`||` の連鎖で次の候補へ落とすため)。 */
export function visibleName(s: string | undefined | null): string | undefined {
  return hasVisibleChar(s) ? (s as string) : undefined;
}

export interface Named {
  userId: string;
  nickname?: string;
  uniqueId?: string;
}

/**
 * TikTok の既定ニックネーム(未設定のまま = `user` + 数字)。
 * 実配信ではニックネームが空で届くことは無く、未設定の人はこの形で届く(PC 版 DB 2,953 人中 25 人)。
 */
const DEFAULT_NICKNAME = /^user\d{6,}$/i;

/** 自分でニックネームを付けている人(描ける名前があり、既定名 `user12345678…` のままではない)。 */
export function hasOwnNickname(v: Pick<Named, 'nickname'>): boolean {
  const nick = visibleName(v.nickname);
  return !!nick && !DEFAULT_NICKNAME.test(nick.trim());
}

/**
 * 表示名: 描けるニックネーム → メモに残したニックネーム → @ハンドル(素のまま)→ ユーザー ID。
 * フィード・ランキング・一覧・シートで共通。固定枠の `@` / `ID` 付きは dockLabel。
 */
export function displayName(v: Named, memo?: { nickname?: string; uniqueId?: string } | null): string {
  return visibleName(v.nickname) || visibleName(memo?.nickname) || v.uniqueId || memo?.uniqueId || v.userId;
}

/** 名前の横に添える @ハンドル。名前そのものがハンドルなら二重に出さない。 */
export function handleOf(v: Named, name: string, memo?: { uniqueId?: string } | null): string {
  const h = v.uniqueId || memo?.uniqueId;
  return h && h !== name ? `@${h}` : '';
}

/** アバター代替の 1 文字。絵文字(サロゲートペア)を割らないよう code point で切る。 */
export function initialOf(name: string | undefined): string {
  const first = Array.from(name || '')[0];
  return first || '?';
}
