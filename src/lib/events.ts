/** 正規化済みイベント。UI とストアはこの型だけを見る。 */

export interface Viewer {
  /** User.userId(v2) / User.idStr(v3)。配信をまたいで安定するキー。 */
  userId: string;
  /** @ハンドル。変更され得る。 */
  uniqueId?: string;
  /** 表示名。 */
  nickname?: string;
  avatarUrl?: string;
  isModerator?: boolean;
  isSubscriber?: boolean;
  isFollower?: boolean;
}

interface Base {
  msgId: string;
  tsMs: number;
}

export type JoinEvent = Base & { kind: 'join'; viewer: Viewer; action: number };
export type CommentEvent = Base & { kind: 'comment'; viewer: Viewer; content: string };
export type LikeEvent = Base & { kind: 'like'; viewer: Viewer; count: number; roomTotal?: number };
export type GiftEvent = Base & {
  kind: 'gift';
  viewer: Viewer;
  giftId: string;
  giftName: string;
  giftType?: number;
  iconUrl?: string;
  repeatCount: number;
  /** 連打の途中(まだ確定していない)なら true。 */
  streaking: boolean;
  diamondEach: number;
  groupId?: string;
};
export type SocialEvent = Base & { kind: 'social'; viewer: Viewer; sub: 'follow' | 'share' | 'other' };
export type RoomStatsEvent = Base & { kind: 'roomStats'; viewerCount?: number };
export type RoomControlEvent = Base & { kind: 'roomControl'; action: 'paused' | 'unpaused' | 'ended' | 'suspended' };
export type RoomInfoEvent = Base & { kind: 'roomInfo'; roomId: string; hostNickname?: string; hostUniqueId?: string };

export type NormalizedEvent =
  | JoinEvent
  | CommentEvent
  | LikeEvent
  | GiftEvent
  | SocialEvent
  | RoomStatsEvent
  | RoomControlEvent
  | RoomInfoEvent;

export function viewerOf(e: NormalizedEvent): Viewer | null {
  return 'viewer' in e ? e.viewer : null;
}
