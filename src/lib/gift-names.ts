/** 表示用の日本語名。受信データは保持し、未登録の名前は原名を残す。 */
const japaneseNames = new Map<string, string>([
  ['rose', 'バラ'],
  ['finger heart', '指ハート'],
  ['swan', '白鳥'],
  ['galaxy', '銀河'],
  ['heart me', 'ハートミー'],
  ['heart', 'ハート'],
  ['tiktok', 'ティックトック'],
  ['gg', 'グッドゲーム'],
  ['ice cream cone', 'ソフトクリーム'],
  ['ice cream', 'アイスクリーム'],
  ['love you', '大好き'],
  ['music note', '音符'],
  ['perfume', '香水'],
  ['doughnut', 'ドーナツ'],
  ['donut', 'ドーナツ'],
  ['paper crane', '折り鶴'],
  ['cap', 'キャップ'],
  ['hat and mustache', '帽子とひげ'],
  ['hand hearts', 'ハンドハート'],
  ['confetti', '紙吹雪'],
  ['love balloon', 'ハートの風船'],
  ['butterfly', '蝶'],
  ['sunglasses', 'サングラス'],
  ['corgi', 'コーギー'],
  ['dancing cactus', '踊るサボテン'],
  ['money gun', 'マネーガン'],
  ['fireworks', '花火'],
  ['sports car', 'スポーツカー'],
  ['motorcycle', 'オートバイ'],
  ['private jet', 'プライベートジェット'],
  ['yacht', 'ヨット'],
  ['lion', 'ライオン'],
  ['tiktok universe', 'ティックトックユニバース'],
  ['universe', 'ユニバース'],
  ['trophy', 'トロフィー'],
  ['crown', '王冠'],
]);

export function japaneseGiftName(name: string, giftId = ''): string {
  const trimmed = name.trim();
  const key = trimmed.toLowerCase().replace(/[\s_-]+/g, ' ');
  return japaneseNames.get(key) ?? (trimmed || (giftId ? `ギフト ${giftId}` : 'ギフト'));
}
