import { memo } from 'react';
import type { FeedRow as Row } from '../lib/feed';
import { hhmm, num } from '../lib/format';
import { Avatar, GiftIcon } from './Avatar';
import { GradeBadge, RoleBadges, VisitBadge } from './Badges';

export interface RowProps {
  row: Row;
  showAvatars: boolean;
  bigGiftDiamonds: number;
}

export const FeedRowView = memo(function FeedRowView({ row, showAvatars, bigGiftDiamonds }: RowProps) {
  const v = row.viewer;
  const name = v.nickname || v.uniqueId || v.userId;
  const handle = v.uniqueId && v.uniqueId !== v.nickname ? `@${v.uniqueId}` : '';
  const firstCls = row.firstEver ? ' first' : '';

  switch (row.k) {
    case 'comment':
      return (
        <div className={`row comment${firstCls}`}>
          <Avatar url={v.avatarUrl} name={name} enabled={showAvatars} />
          <div className="body">
            <div className="head">
              <span className="who">{name}</span>
              {handle ? <span className="handle">{handle}</span> : null}
              <VisitBadge visits={row.visits} firstEver={row.firstEver} />
              <RoleBadges v={v} />
              <span className="time">{hhmm(row.tsMs)}</span>
            </div>
            <div className="text">{row.text}</div>
          </div>
        </div>
      );

    case 'join':
      return (
        <div className={`row join${firstCls}`}>
          <Avatar url={v.avatarUrl} name={name} enabled={showAvatars} />
          <div className="body">
            <div className="head">
              <GradeBadge v={v} />
              <span className="who">{name}</span>
              <span>が入室</span>
              <VisitBadge visits={row.visits} firstEver={row.firstEver} />
              <span className="time">{hhmm(row.tsMs)}</span>
            </div>
          </div>
        </div>
      );

    case 'social':
      return (
        <div className={`row social`}>
          <Avatar url={v.avatarUrl} name={name} enabled={showAvatars} />
          <div className="body">
            <div className="head">
              <span className="who">{name}</span>
              <span>{row.sub === 'follow' ? 'がフォローしました' : 'がシェアしました'}</span>
              <VisitBadge visits={row.visits} firstEver={row.firstEver} />
              <span className="time">{hhmm(row.tsMs)}</span>
            </div>
          </div>
        </div>
      );

    case 'gift': {
      const big = bigGiftDiamonds > 0 && row.diamonds >= bigGiftDiamonds;
      return (
        <div className={`row gift${big ? ' big' : ''}${firstCls}`}>
          <GiftIcon url={row.iconUrl} />
          <div className="body">
            <div className="head">
              <span className="who">{name}</span>
              {handle ? <span className="handle">{handle}</span> : null}
              <VisitBadge visits={row.visits} firstEver={row.firstEver} />
              <GradeBadge v={v} />
              <span className="time">{hhmm(row.tsMs)}</span>
            </div>
            <div className="gift-line">
              <span className="gift-name">{row.giftName}</span>
              {row.count > 1 || row.streaking ? (
                <span key={row.count} className={`gift-cnt${row.streaking ? ' streak' : ''}`}>
                  ×{row.count}
                </span>
              ) : null}
              <span className="gift-dia">{num(row.diamonds)}💎</span>
            </div>
          </div>
        </div>
      );
    }
  }
});
