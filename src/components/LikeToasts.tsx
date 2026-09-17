import { LIKE_BURST_MS, recentLikers, type LikeEntry } from '../lib/likes';
import { num } from '../lib/format';
import { Avatar } from './Avatar';
import { useLiveTick } from './useLiveTick';

interface Props {
  likes: Map<string, LikeEntry>;
  /** 更新の印(いいねが入るたび増える)。Map は同じ参照のままなのでこれで再計算する。 */
  likeCount: number;
  showAvatars: boolean;
}

const MAX_TOASTS = 3;

/**
 * 右下のいいね通知。直近 3 秒以内にタップした人を最大 3 人、新しい人が下に来るよう積む。
 * 同じ人の連打は同じトーストの「+N」が伸びる。触れないよう pointer-events は切ってある。
 */
export function LikeToasts({ likes, likeCount, showAvatars }: Props) {
  void likeCount;
  const now = Date.now();
  const recent = recentLikers(likes, now, LIKE_BURST_MS, MAX_TOASTS);
  const nextExpiry = recent.length ? Math.min(...recent.map((e) => e.lastMs)) + LIKE_BURST_MS : null;
  useLiveTick(nextExpiry);
  if (recent.length === 0) return null;
  return (
    <div className="like-toasts" aria-live="polite">
      {recent
        .slice()
        .reverse()
        .map((e) => {
          const v = e.viewer;
          const name = v.nickname || v.uniqueId || v.userId;
          return (
            <div key={e.userId} className="like-toast">
              <Avatar url={v.avatarUrl} name={name} enabled={showAvatars} />
              <span className="who">{name}</span>
              <span key={e.burst} className="burst">
                ❤️ +{num(e.burst)}
              </span>
              {e.taps > e.burst ? <span className="sub">累計 {num(e.taps)}</span> : null}
            </div>
          );
        })}
    </div>
  );
}
