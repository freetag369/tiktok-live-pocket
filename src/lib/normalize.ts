import type { GiftEvent, NormalizedEvent, Viewer } from './events';
import { idStr, numOr, pickUrl, str, toMs } from './ids';

/**
 * Euler Stream の Cloud WebSocket(v2 スキーマ)と tiktok-live-connector(v3 スキーマ)は
 * 同じメッセージを別のフィールド名で持つ。両方読むことで、既存 PC アプリの fixtures を
 * そのままテスト素材にできる。名前の対応:
 *
 *   ユーザーID   v2 user.userId            v3 user.idStr / user.id
 *   @ハンドル    v2 user.uniqueId          v3 user.displayId
 *   アバター     v2 user.profilePicture.url[]   v3 user.avatarThumb.urlList[]
 *   コメント     v2 data.comment           v3 data.content
 *   ギフト詳細   v2 data.giftDetails.{giftName,giftType,giftImage}   v3 data.gift.{name,type,icon}
 *   repeatEnd    どちらも「数値」(0/1)。boolean 比較は常に偽になる罠。
 *
 * ギフターレベル(バッジ)持ちの入室は MemberMessage ではなく WebcastBarrageMessage(帯メッセージ)で届く。
 *   種別   msgType 9 = GRADE_USER_ENTRANCE_NOTIFICATION / 11 = FANS_LEVEL_ENTRANCE / 15 = ENIGMA_ENTRANCE
 *   入室者 userGradeParam.user(+ currentGrade = レベル)/ fansLevelParam.user / user(v3)
 */

type Any = Record<string, any>;

export function viewerOf(u: Any | undefined | null, identity?: Any): Viewer | null {
  if (!u) return null;
  const userId = idStr(u.userId) || idStr(u.idStr) || idStr(u.id);
  if (!userId) return null;
  const v: Viewer = { userId };
  const handle = str(u.uniqueId) || str(u.displayId);
  if (handle) v.uniqueId = handle;
  const nick = str(u.nickname);
  if (nick) v.nickname = nick;
  const avatar =
    pickUrl(u.profilePicture) || pickUrl(u.avatarThumb) || pickUrl(u.profilePictureMedium) || pickUrl(u.avatarMedium);
  if (avatar) v.avatarUrl = avatar;
  if (identity) {
    if (identity.isModeratorOfAnchor === true) v.isModerator = true;
    if (identity.isSubscriberOfAnchor === true) v.isSubscriber = true;
    if (identity.isFollowerOfAnchor === true) v.isFollower = true;
  }
  return v;
}

function msgIdOf(data: Any, type: string, userId: string, tsMs: number, extra: string): string {
  const given = str(data?.common?.msgId);
  if (given && given !== '0') return given;
  return `syn:${type}:${userId}:${tsMs}:${extra}`;
}

function tsOf(data: Any, now: number): number {
  return toMs(data?.common?.createTime ?? data?.common?.clientSendTime, now);
}

/** Barrage の種別のうち「入室」を表すもの(BarrageMessageBarrageType)。 */
const BARRAGE_ENTRANCE_TYPES = new Set([9, 11, 15]);

function isEntranceBarrage(data: Any): boolean {
  const t = data.msgType;
  if (typeof t === 'number' || (typeof t === 'string' && /^\d+$/.test(t))) return BARRAGE_ENTRANCE_TYPES.has(Number(t));
  if (typeof t === 'string' && t.toUpperCase().includes('ENTRANCE')) return true;
  const keys = [data.content?.key, data.commonBarrageContent?.key, data.content?.displayType, data.commonBarrageContent?.displayType]
    .filter((k): k is string => typeof k === 'string' && k.length > 0)
    .map((k) => k.toLowerCase());
  return keys.some((k) => k.includes('entrance') || k.includes('enter') || k.includes('superfanjoined'));
}

/** Barrage の入室者。パラメータ → user → 本文中のユーザー片の順に探す。 */
function barrageUser(data: Any): Any | null {
  const direct = data.userGradeParam?.user ?? data.fansLevelParam?.user ?? data.user;
  if (direct) return direct;
  for (const text of [data.content, data.commonBarrageContent]) {
    const pieces = (text?.piecesList ?? text?.pieces) as Any[] | undefined;
    if (!Array.isArray(pieces)) continue;
    for (const p of pieces) if (p?.userValue?.user) return p.userValue.user;
  }
  return null;
}

/**
 * 1 メッセージ → 0 or 1 イベント。情報が無いものは null(呼び出し側は skip)。
 * `type` は Euler の封筒の type("WebcastChatMessage" 等)または既存 fixtures の type。
 */
export function normalize(type: string, raw: unknown, now = Date.now()): NormalizedEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Any;

  switch (type) {
    case 'roomInfo': {
      // Euler は接続直後に roomInfo を 1 通送る。形は TikTok の room_info API そのもの。
      const d = (data.data ?? data) as Any;
      const roomId = idStr(d.id_str ?? d.idStr ?? d.id ?? d.roomId ?? data.roomId);
      if (!roomId) return null;
      const owner = (d.owner ?? {}) as Any;
      return {
        kind: 'roomInfo',
        msgId: `roomInfo:${roomId}`,
        tsMs: now,
        roomId,
        hostNickname: str(owner.nickname) || undefined,
        hostUniqueId: str(owner.display_id ?? owner.displayId ?? owner.uniqueId) || undefined,
      };
    }

    case 'WebcastMemberMessage': {
      const v = viewerOf(data.user);
      if (!v) return null;
      const action = numOr(data.action, 0);
      const tsMs = tsOf(data, now);
      return { kind: 'join', msgId: msgIdOf(data, 'join', v.userId, tsMs, String(action)), tsMs, viewer: v, action };
    }

    case 'WebcastBarrageMessage': {
      // レベル持ち・ファンクラブ・スーパーファンの入室通知だけを入室として扱う。サブスクや EC の帯は捨てる。
      if (!isEntranceBarrage(data)) return null;
      const v = viewerOf(barrageUser(data));
      if (!v) return null;
      const level = numOr(data.userGradeParam?.currentGrade, 0);
      if (level > 0) v.gifterLevel = level;
      const tsMs = tsOf(data, now);
      return { kind: 'join', msgId: msgIdOf(data, 'join', v.userId, tsMs, 'barrage'), tsMs, viewer: v, action: 1 };
    }

    case 'WebcastChatMessage': {
      const v = viewerOf(data.user, data.userIdentity);
      if (!v) return null;
      const content = str(data.comment ?? data.content);
      const tsMs = tsOf(data, now);
      return { kind: 'comment', msgId: msgIdOf(data, 'chat', v.userId, tsMs, content), tsMs, viewer: v, content };
    }

    case 'WebcastLikeMessage': {
      const v = viewerOf(data.user);
      if (!v) return null;
      const count = numOr(data.likeCount ?? data.count, 0);
      const total = numOr(data.totalLikeCount ?? data.total, NaN);
      const tsMs = tsOf(data, now);
      return {
        kind: 'like',
        msgId: msgIdOf(data, 'like', v.userId, tsMs, `${count}:${idStr(data.totalLikeCount ?? data.total)}:${idStr(data?.common?.clientSendTime)}`),
        tsMs,
        viewer: v,
        count,
        roomTotal: Number.isFinite(total) ? total : undefined,
      };
    }

    case 'WebcastGiftMessage': {
      const v = viewerOf(data.user, data.userIdentity);
      if (!v) return null;
      const gift = (data.giftDetails ?? data.gift ?? {}) as Any;
      const rawType = gift.giftType ?? gift.type;
      const giftType = rawType == null ? undefined : numOr(rawType, 0);
      // 連打できるギフト(type 1)は tick ごとに repeatEnd=0 で届き、最後に repeatEnd=1 が来る。
      const repeatEnd = numOr(data.repeatEnd, 0);
      const streaking = giftType === 1 && !repeatEnd;
      const repeatCount = Math.max(1, numOr(data.repeatCount, 1));
      const diamondEach = Math.max(0, numOr(gift.diamondCount, 0));
      const giftId = idStr(gift.id) || idStr(data.giftId);
      const groupId = idStr(data.groupId);
      const tsMs = tsOf(data, now);
      const e: GiftEvent = {
        kind: 'gift',
        msgId: msgIdOf(data, 'gift', v.userId, tsMs, `${giftId}:${groupId}:${repeatCount}:${repeatEnd}`),
        tsMs,
        viewer: v,
        giftId,
        giftName: str(gift.giftName ?? gift.name) || `ギフト ${giftId}`,
        giftType,
        repeatCount,
        streaking,
        diamondEach,
      };
      const icon = pickUrl(gift.giftImage) || pickUrl(gift.icon) || pickUrl(gift.image) || pickUrl(gift.previewImage);
      if (icon) e.iconUrl = icon;
      if (groupId && groupId !== '0') e.groupId = groupId;
      return e;
    }

    case 'WebcastSocialMessage': {
      const v = viewerOf(data.user);
      if (!v) return null;
      const key = str(data?.common?.displayText?.key).toLowerCase();
      const sub: 'follow' | 'share' | 'other' = key.includes('follow') ? 'follow' : key.includes('share') ? 'share' : 'other';
      const tsMs = tsOf(data, now);
      return { kind: 'social', msgId: msgIdOf(data, 'social', v.userId, tsMs, sub), tsMs, viewer: v, sub };
    }

    case 'WebcastRoomUserSeqMessage': {
      // `total`(v3)/`viewerCount`(v1) が同接。`totalUser` は累計なので使わない。
      const viewerCount = numOr(data.total ?? data.viewerCount, NaN);
      const tsMs = tsOf(data, now);
      return {
        kind: 'roomStats',
        msgId: msgIdOf(data, 'roomUser', 'room', tsMs, idStr(data.total ?? data.viewerCount)),
        tsMs,
        viewerCount: Number.isFinite(viewerCount) ? viewerCount : undefined,
      };
    }

    case 'WebcastControlMessage': {
      const map: Record<number, 'paused' | 'unpaused' | 'ended' | 'suspended'> = {
        1: 'paused',
        2: 'unpaused',
        3: 'ended',
        4: 'suspended',
      };
      const action = map[numOr(data.action, 0)];
      if (!action) return null;
      const tsMs = tsOf(data, now);
      return { kind: 'roomControl', msgId: msgIdOf(data, 'control', 'room', tsMs, action), tsMs, action };
    }

    default:
      return null;
  }
}
