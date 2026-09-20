import { memo, useMemo } from 'react';
import { LIKE_BURST_MS, rankLikes, recentLikers, type LikeEntry } from '../lib/likes';
import { num } from '../lib/format';
import { Avatar } from './Avatar';
import { VisitBadge } from './Badges';
import { useLiveTick } from './useLiveTick';

interface Props {
  likes: Map<string, LikeEntry>;
  likeCount: number;
  likeRoomTotal?: number;
  showAvatars: boolean;
  empty: React.ReactNode;
}

const RANK_LIMIT = 100;
const NOW_LIMIT = 5;

/**
 * いいねランキング。タップ数の多い順に最大 100 人。直近 3 秒にタップした人は行が光り、
 * 順位圏外でも上の「いま:」帯に名前が出る。
 */
export function LikeRanking({ likes, likeCount, likeRoomTotal, showAvatars, empty }: Props) {
  const now = Date.now();
  const ranked = useMemo(() => rankLikes(likes, RANK_LIMIT), [likes, likeCount]);
  const live = recentLikers(likes, now, LIKE_BURST_MS, NOW_LIMIT);
  const nextExpiry = live.length ? Math.min(...live.map((e) => e.lastMs)) + LIKE_BURST_MS : null;
  useLiveTick(nextExpiry);

  return (
    <div className="rank">
      {ranked.length === 0 ? (
        <div className="empty">{empty}</div>
      ) : (
        <>
          <div className="rank-head">
            <span>
              ❤️ <b>{num(likeCount)}</b>
            </span>
            <span>{num(likes.size)} 人</span>
            {likeRoomTotal != null && likeRoomTotal > 0 ? <span className="room">配信全体 {num(likeRoomTotal)}</span> : null}
          </div>
          {live.length ? (
            <div className="rank-now">
              いま:{' '}
              {live.map((e, i) => (
                <span key={e.userId}>
                  {i > 0 ? '・' : ''}
                  <span className="who">{e.viewer.nickname || e.viewer.uniqueId || e.userId}</span>
                </span>
              ))}
            </div>
          ) : null}
          {ranked.map((e, i) => (
            <LikeRankRow key={e.userId} entry={e} pos={i + 1} live={now - e.lastMs < LIKE_BURST_MS} showAvatars={showAvatars} />
          ))}
        </>
      )}
    </div>
  );
}

const LikeRankRow = memo(function LikeRankRow({ entry, pos, live, showAvatars }: { entry: LikeEntry; pos: number; live: boolean; showAvatars: boolean }) {
  const v = entry.viewer;
  const name = v.nickname || v.uniqueId || v.userId;
  const handle = v.uniqueId && v.uniqueId !== v.nickname ? `@${v.uniqueId}` : '';
  return (
    <div className={`rank-row${pos <= 3 ? ' top3' : ''}${live ? ' live' : ''}`}>
      <span className="pos">{pos}</span>
      <Avatar url={v.avatarUrl} name={name} enabled={showAvatars} />
      <div className="body">
        <div className="head">
          <span className="who">{name}</span>
          {handle ? <span className="handle">{handle}</span> : null}
          <VisitBadge visits={entry.visits} firstEver={entry.firstEver} />
          {live ? (
            <span key={entry.burst} className="burst">
              +{num(entry.burst)}
            </span>
          ) : null}
        </div>
      </div>
      <span className="taps">
        ❤️ {num(entry.taps)}
      </span>
    </div>
  );
});
