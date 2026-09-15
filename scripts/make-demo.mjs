#!/usr/bin/env node
/**
 * デモ再生用 fixture を生成する(src/fixtures/demo.ndjson)。
 * 既存 PC アプリの fixtures 形式 `{o, type, data}`(v3 スキーマ)で書く —
 * normalize は v2/v3 両対応なので、そのまま再生できる。
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../src/fixtures/demo.ndjson', import.meta.url));

const users = [
  { id: '1', displayId: 'sakura_03', nickname: 'さくら🌸' },
  { id: '2', displayId: 'kenji_ks', nickname: 'けんじ' },
  { id: '3', displayId: 'mii_mii', nickname: 'みぃ' },
  { id: '4', displayId: 'taro.t', nickname: 'たろう', mod: true },
  { id: '5', displayId: 'yuna_yy', nickname: 'ゆな' },
  { id: '6', displayId: 'daichi88', nickname: 'だいち' },
  { id: '7', displayId: 'ao_ao', nickname: 'あお' },
];
const user = (u) => ({
  id: u.id,
  idStr: u.id,
  displayId: u.displayId,
  nickname: u.nickname,
  avatarThumb: { urlList: [] },
  badgeList: [],
});
const identity = (u) => (u.mod ? { isModeratorOfAnchor: true } : undefined);

const gifts = {
  rose: { id: '5655', name: 'Rose', type: 1, diamondCount: 1, icon: { urlList: ['https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/eba3a9bb85c33e017f3648eaf88d7189~tplv-obj.png'] } },
  finger: { id: '5487', name: 'Finger Heart', type: 1, diamondCount: 5, icon: { urlList: ['https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/a4c4dc437fd3a6632aba149769491f49.png~tplv-obj.png'] } },
  swan: { id: '5897', name: 'Swan', type: 2, diamondCount: 699, icon: { urlList: ['https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/97a26919dbf6afe262c97e22a83f4bf1~tplv-obj.png'] } },
  galaxy: { id: '11046', name: 'Galaxy', type: 2, diamondCount: 1000, icon: { urlList: ['https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/resource/79a02148079526539f7599150da9fd28.png~tplv-obj.png'] } },
};

let seq = 0;
const base = 1785240000;
const common = (o) => ({ msgId: `demo${++seq}`, createTime: String(base + Math.floor(o / 1000)) });
const lines = [{ o: -1, meta: { note: 'デモ再生用の見本' } }];
const at = (o, type, data) => lines.push({ o, type, data });

at(0, 'WebcastRoomUserSeqMessage', { common: common(0), total: '42', totalUser: '120' });
at(300, 'WebcastMemberMessage', { common: common(300), user: user(users[0]), action: 1 });
at(900, 'WebcastChatMessage', { common: common(900), user: user(users[0]), content: 'こんばんは〜！今日も来ました' });
at(1600, 'WebcastMemberMessage', { common: common(1600), user: user(users[1]), action: 1 });
at(2200, 'WebcastChatMessage', { common: common(2200), user: user(users[3]), userIdentity: identity(users[3]), content: '初見さんいらっしゃい👋' });
at(2800, 'WebcastSocialMessage', { common: { ...common(2800), displayText: { key: 'pm_main_follow_message_viewer_2' } }, user: user(users[1]) });
at(3300, 'WebcastChatMessage', { common: common(3300), user: user(users[1]), content: 'はじめまして！声きれい' });
// バラ 8 連打
for (const [i, n] of [1, 3, 5, 8].entries()) {
  at(4000 + i * 350, 'WebcastGiftMessage', { common: common(4000 + i * 350), user: user(users[2]), giftId: '5655', repeatCount: n, repeatEnd: i === 3 ? 1 : 0, groupId: 'grp-rose-1', gift: gifts.rose });
}
at(5600, 'WebcastMemberMessage', { common: common(5600), user: user(users[4]), action: 1 });
at(6100, 'WebcastChatMessage', { common: common(6100), user: user(users[2]), content: 'バラ送ったよ〜🌹' });
at(6800, 'WebcastGiftMessage', { common: common(6800), user: user(users[4]), giftId: '5487', repeatCount: 1, repeatEnd: 0, groupId: 'grp-fh-1', gift: gifts.finger });
at(7200, 'WebcastGiftMessage', { common: common(7200), user: user(users[4]), giftId: '5487', repeatCount: 2, repeatEnd: 1, groupId: 'grp-fh-1', gift: gifts.finger });
at(7900, 'WebcastChatMessage', { common: common(7900), user: user(users[5]), content: 'この曲なんて曲ですか？' });
at(8600, 'WebcastRoomUserSeqMessage', { common: common(8600), total: '58', totalUser: '150' });
at(9200, 'WebcastGiftMessage', { common: common(9200), user: user(users[0]), giftId: '5897', repeatCount: 1, repeatEnd: 0, gift: gifts.swan });
at(9800, 'WebcastChatMessage', { common: common(9800), user: user(users[3]), userIdentity: identity(users[3]), content: '白鳥ありがとうございます！！' });
// レベル持ち(バッジ付き)の入室は MemberMessage ではなく Barrage(帯)で届く
at(10500, 'WebcastBarrageMessage', {
  common: common(10500),
  msgType: 9,
  userGradeParam: { currentGrade: 32, userId: users[6].id, user: user(users[6]) },
  content: { key: 'pm_mt_grade_user_entrance', defaultPattern: '{0:user} joined' },
});
at(11200, 'WebcastChatMessage', { common: common(11200), user: user(users[6]), content: 'おつかれさまです' });
at(12000, 'WebcastGiftMessage', { common: common(12000), user: user(users[1]), giftId: '11046', repeatCount: 1, repeatEnd: 0, gift: gifts.galaxy });
at(12700, 'WebcastChatMessage', { common: common(12700), user: user(users[0]), content: 'えっギャラクシー！？すごい' });
at(13300, 'WebcastSocialMessage', { common: { ...common(13300), displayText: { key: 'pm_mt_guidance_share' } }, user: user(users[5]) });
at(14000, 'WebcastChatMessage', { common: common(14000), user: user(users[4]), content: 'また来ます〜👋' });

writeFileSync(out, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
console.log(`wrote ${lines.length - 1} events -> ${out}`);
