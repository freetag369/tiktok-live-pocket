import official from './gift-names-ja.json';

/**
 * 表示用の日本語名。受信データ(英語名)は保持し、表示のときだけ直す。
 * 公式の表は TikTok LIVE のギフト一覧(日本語)そのもので、`npm run gift-names` で作り直す。
 */
const norm = (name: string): string => name.trim().toLowerCase().replace(/[\s_-]+/g, ' ');

const byId = new Map<string, string>();
const byName = new Map<string, string>();
for (const [id, en, ja] of official as [string, string, string][]) {
  byId.set(id, ja);
  // 同じ英語名で別のギフトがあるときは giftId の若い方(先に出たギフト)を名前引きに使う。
  const key = norm(en);
  if (key && !byName.has(key)) byName.set(key, ja);
}

/** 公式の一覧に無いギフト(終了したもの・地域限定など)のための手書きの訳。 */
const fallbackNames = new Map<string, string>([
  ['ice cream', 'アイスクリーム'],
  ['music note', '音符'],
  ['donut', 'ドーナッツ'],
  ['hand hearts', 'ハンドハート'],
  ['butterfly', '蝶'],
  ['dancing cactus', '踊るサボテン'],
  ['yacht', 'ヨット'],
  ['universe', 'ユニバース'],
  ['trophy', 'トロフィー'],
  ['crown', '王冠'],
  ['popular vote', '人気投票'],
  ['nice to meet u', 'はじめまして'],
  ['spidey pin', 'スパイディのピン'],
]);

export function japaneseGiftName(name: string, giftId = ''): string {
  const trimmed = name.trim();
  const key = norm(trimmed);
  return (
    byId.get(giftId) ??
    byName.get(key) ??
    fallbackNames.get(key) ??
    (trimmed || (giftId ? `ギフト ${giftId}` : 'ギフト'))
  );
}
