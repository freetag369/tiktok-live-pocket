import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalize } from '../src/lib/normalize';

const NOW = 1_785_240_000_000; // fixtures の createTime(秒)と同じ日

function fixture(name: string): Array<{ type: string; data: unknown }> {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((r) => typeof r.type === 'string');
}

/** Euler Cloud WebSocket(v2 スキーマ)の実物に近い形。 */
const v2User = {
  userId: '7000000000000000001',
  uniqueId: 'hanako_live',
  nickname: 'はなこ',
  profilePicture: { url: ['https://p16-sign.tiktokcdn-us.com/a.webp?x-expires=1', 'https://p19.tiktokcdn.com/a.jpeg'] },
};

describe('normalize (v2 = Euler Cloud WebSocket)', () => {
  it('chat: comment / uniqueId / profilePicture.url を読む', () => {
    const e = normalize('WebcastChatMessage', { common: { msgId: '11', createTime: '1785240000' }, user: v2User, comment: 'こんばんは' }, NOW);
    expect(e).toMatchObject({
      kind: 'comment',
      msgId: '11',
      content: 'こんばんは',
      viewer: { userId: '7000000000000000001', uniqueId: 'hanako_live', nickname: 'はなこ', avatarUrl: 'https://p16-sign.tiktokcdn-us.com/a.webp?x-expires=1' },
    });
    expect(e!.tsMs).toBe(1785240000 * 1000);
  });

  it('member: action 1 = 入室、3 = サブスク(入室ではない)', () => {
    const j = normalize('WebcastMemberMessage', { common: { msgId: '12' }, user: v2User, action: 1 }, NOW);
    expect(j).toMatchObject({ kind: 'join', action: 1 });
    const s = normalize('WebcastMemberMessage', { common: { msgId: '13' }, user: v2User, action: 3 }, NOW);
    expect(s).toMatchObject({ kind: 'join', action: 3 });
  });

  it('barrage: レベル持ちの入室通知(msgType 9)は入室、レベルを viewer に付ける', () => {
    const e = normalize(
      'WebcastBarrageMessage',
      { common: { msgId: '30', createTime: '1785240000' }, msgType: 9, userGradeParam: { currentGrade: 32, userId: v2User.userId, user: v2User }, content: { key: 'pm_mt_grade_user_entrance' } },
      NOW
    );
    expect(e).toMatchObject({ kind: 'join', action: 1, msgId: '30', viewer: { userId: '7000000000000000001', nickname: 'はなこ', gifterLevel: 32 } });
  });

  it('barrage: msgType が enum 名の文字列でも入室', () => {
    const e = normalize('WebcastBarrageMessage', { common: { msgId: '31' }, msgType: 'BARRAGE_TYPE_GRADE_USER_ENTRANCE_NOTIFICATION', userGradeParam: { currentGrade: 5, user: v2User } }, NOW);
    expect(e).toMatchObject({ kind: 'join', action: 1, viewer: { gifterLevel: 5 } });
  });

  it('barrage: ファンクラブレベル入室(11)と本文中のユーザー片からも入室者を取る', () => {
    const fans = normalize('WebcastBarrageMessage', { common: { msgId: '32' }, msgType: 11, fansLevelParam: { currentGrade: 3, user: v2User } }, NOW);
    expect(fans).toMatchObject({ kind: 'join', viewer: { userId: '7000000000000000001' } });
    expect((fans as { viewer: { gifterLevel?: number } }).viewer.gifterLevel).toBeUndefined();
    const pieces = normalize(
      'WebcastBarrageMessage',
      { common: { msgId: '33' }, content: { key: 'ttlive_superfan_commentnotif_superfanjoined', piecesList: [{ type: 11, userValue: { user: v2User } }] } },
      NOW
    );
    expect(pieces).toMatchObject({ kind: 'join', viewer: { userId: '7000000000000000001' } });
  });

  it('barrage: 入室でない帯(サブスク 4・ギャラリー 13)や user 無しは null', () => {
    expect(normalize('WebcastBarrageMessage', { common: { msgId: '34' }, msgType: 4, user: v2User, content: { key: 'pm_mt_subscribe' } }, NOW)).toBeNull();
    expect(normalize('WebcastBarrageMessage', { common: { msgId: '35' }, msgType: 13, user: v2User }, NOW)).toBeNull();
    expect(normalize('WebcastBarrageMessage', { common: { msgId: '36' }, msgType: 9 }, NOW)).toBeNull();
  });

  it('gift: giftDetails / giftImage / repeatEnd は数値', () => {
    const data = {
      common: { msgId: '14', createTime: '1785240001' },
      user: v2User,
      giftId: 5655,
      repeatCount: 3,
      repeatEnd: 0,
      groupId: '1785240001000',
      giftDetails: { id: '5655', giftName: 'Rose', giftType: 1, diamondCount: 1, giftImage: { url: ['https://p16.tiktokcdn.com/rose.png'] } },
    };
    const mid = normalize('WebcastGiftMessage', data, NOW);
    expect(mid).toMatchObject({ kind: 'gift', giftId: '5655', giftName: 'Rose', giftType: 1, repeatCount: 3, streaking: true, diamondEach: 1, iconUrl: 'https://p16.tiktokcdn.com/rose.png', groupId: '1785240001000' });
    const end = normalize('WebcastGiftMessage', { ...data, common: { msgId: '15' }, repeatCount: 7, repeatEnd: 1 }, NOW);
    expect(end).toMatchObject({ kind: 'gift', repeatCount: 7, streaking: false });
  });

  it('gift: 非連打(type 2)は repeatEnd=0 でも確定扱い', () => {
    const e = normalize(
      'WebcastGiftMessage',
      { common: { msgId: '16' }, user: v2User, giftId: 5897, repeatCount: 1, repeatEnd: 0, giftDetails: { id: '5897', giftName: 'Swan', giftType: 2, diamondCount: 699, icon: { url: ['https://p16.tiktokcdn.com/swan.png'] } } },
      NOW
    );
    expect(e).toMatchObject({ kind: 'gift', streaking: false, diamondEach: 699, iconUrl: 'https://p16.tiktokcdn.com/swan.png' });
  });

  it('social: displayText.key で follow / share を判定', () => {
    const f = normalize('WebcastSocialMessage', { common: { msgId: '17', displayText: { key: 'pm_main_follow_message_viewer_2' } }, user: v2User }, NOW);
    expect(f).toMatchObject({ kind: 'social', sub: 'follow' });
    const s = normalize('WebcastSocialMessage', { common: { msgId: '18', displayText: { key: 'pm_mt_guidance_share' } }, user: v2User }, NOW);
    expect(s).toMatchObject({ kind: 'social', sub: 'share' });
  });

  it('roomInfo: id_str と owner を読む', () => {
    const e = normalize('roomInfo', { data: { id_str: '7450000000000000000', owner: { nickname: 'ようくん', display_id: 'metafact8' } } }, NOW);
    expect(e).toMatchObject({ kind: 'roomInfo', roomId: '7450000000000000000', hostNickname: 'ようくん', hostUniqueId: 'metafact8' });
  });

  it('roomUser: total が同接、totalUser(累計)は使わない', () => {
    const e = normalize('WebcastRoomUserSeqMessage', { common: { msgId: '19' }, total: '500', totalUser: '12000' }, NOW);
    expect(e).toMatchObject({ kind: 'roomStats', viewerCount: 500 });
  });

  it('control: 3 = ended', () => {
    expect(normalize('WebcastControlMessage', { common: { msgId: '20' }, action: 3 }, NOW)).toMatchObject({ kind: 'roomControl', action: 'ended' });
  });

  it('msgId が無いときは決定的な合成キー(同じ入力なら同じ)', () => {
    const a = normalize('WebcastChatMessage', { common: { createTime: '1785240000' }, user: v2User, comment: 'x' }, NOW);
    const b = normalize('WebcastChatMessage', { common: { createTime: '1785240000' }, user: v2User, comment: 'x' }, NOW);
    expect(a!.msgId).toBe(b!.msgId);
    expect(a!.msgId.startsWith('syn:')).toBe(true);
  });

  it('未知の type / user 無しは null', () => {
    expect(normalize('WebcastFooMessage', { common: {} }, NOW)).toBeNull();
    expect(normalize('WebcastChatMessage', { common: { msgId: '1' }, comment: 'x' }, NOW)).toBeNull();
  });
});

describe('normalize (v3 = 既存 PC アプリの fixtures)', () => {
  it('small-room: 全行が何かに正規化される', () => {
    const rows = fixture('synth-small-room.ndjson');
    const kinds = rows.map((r) => normalize(r.type, r.data, NOW)?.kind);
    expect(kinds.filter(Boolean).length).toBe(rows.length);
    expect(new Set(kinds)).toEqual(new Set(['join', 'comment', 'like', 'social', 'roomStats']));
  });

  it('v3 の displayId / avatarThumb.urlList / content を読む', () => {
    const rows = fixture('synth-small-room.ndjson');
    const chat = rows.find((r) => r.type === 'WebcastChatMessage')!;
    const e = normalize(chat.type, chat.data, NOW);
    expect(e).toMatchObject({ kind: 'comment', content: 'コメント0', viewer: { userId: '100', uniqueId: 'h_100', avatarUrl: 'https://p16.tiktokcdn.com/100.webp' } });
  });

  it('rose-combo: 中間 tick は streaking、最後の repeatEnd=1 で 17', () => {
    const rows = fixture('synth-rose-combo.ndjson');
    const evs = rows.map((r) => normalize(r.type, r.data, NOW)!);
    expect(evs.map((e) => (e.kind === 'gift' ? [e.repeatCount, e.streaking] : null))).toEqual([
      [1, true],
      [5, true],
      [11, true],
      [17, false],
    ]);
  });
});
