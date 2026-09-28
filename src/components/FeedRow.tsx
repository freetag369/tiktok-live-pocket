import { memo } from 'react';
import type { FeedRow as Row } from '../lib/feed';
import { hhmm, num } from '../lib/format';
import { japaneseGiftName } from '../lib/gift-names';
import { Avatar, GiftIcon } from './Avatar';
import { GradeBadge, RoleBadges, VisitBadge } from './Badges';

export interface RowProps {
  row: Row;
  showAvatars: boolean;
  bigGiftDiamonds: number;
  /** この人のリスナーメモ(あれば)。描画時に引くので、配信中に直してもすぐ反映される。 */
  note?: string;
  kana?: string;
  /** 行をタップしたとき(メモを書く)。 */
  onTap?: (row: Row) => void;
}

export const FeedRowView = memo(function FeedRowView({ row, showAvatars, bigGiftDiamonds, note, kana, onTap }: RowProps) {
  const v = row.viewer;
  const name = v.nickname || v.uniqueId || v.userId;
  const handle = v.uniqueId && v.uniqueId !== v.nickname ? `@${v.uniqueId}` : '';
  const extra = `${row.firstEver ? ' first' : ''}${note ? ' has-memo' : ''}${onTap ? ' tappable' : ''}`;
  const click = onTap ? () => onTap(row) : undefined;
  const kanaEl = kana ? <span className="kana">({kana})</span> : null;
  const memoEl = note ? <div className="memo-line">📝 {note}</div> : null;

  switch (row.k) {
    case 'comment':
      return (
        <div className={`row comment${extra}`} data-id={row.id} onClick={click}>
          <Avatar url={v.avatarUrl} name={name} enabled={showAvatars} />
          <div className="body">
            <div className="head">
              <span className="who">{name}</span>
              {kanaEl}
              {handle ? <span className="handle">{handle}</span> : null}
              <VisitBadge visits={row.visits} firstEver={row.firstEver} />
              <RoleBadges v={v} />
              <span className="time">{hhmm(row.tsMs)}</span>
            </div>
            {memoEl}
            <div className="text">{row.text}</div>
          </div>
        </div>
      );

    case 'join':
      return (
        <div className={`row join${extra}`} data-id={row.id} onClick={click}>
          <Avatar url={v.avatarUrl} name={name} enabled={showAvatars} />
          <div className="body">
            <div className="head">
              <GradeBadge v={v} />
              <span className="who">{name}</span>
              {kanaEl}
              <span>が入室</span>
              <VisitBadge visits={row.visits} firstEver={row.firstEver} />
              <span className="time">{hhmm(row.tsMs)}</span>
            </div>
            {memoEl}
          </div>
        </div>
      );

    case 'social':
      return (
        <div className={`row social${extra}`} data-id={row.id} onClick={click}>
          <Avatar url={v.avatarUrl} name={name} enabled={showAvatars} />
          <div className="body">
            <div className="head">
              <span className="who">{name}</span>
              {kanaEl}
              <span>{row.sub === 'follow' ? 'がフォローしました' : 'がシェアしました'}</span>
              <VisitBadge visits={row.visits} firstEver={row.firstEver} />
              <span className="time">{hhmm(row.tsMs)}</span>
            </div>
            {memoEl}
          </div>
        </div>
      );

    case 'gift': {
      const big = bigGiftDiamonds > 0 && row.diamonds >= bigGiftDiamonds;
      return (
        <div className={`row gift${big ? ' big' : ''}${extra}`} data-id={row.id} onClick={click}>
          <GiftIcon url={row.iconUrl} />
          <div className="body">
            <div className="head">
              <span className="who">{name}</span>
              {kanaEl}
              {handle ? <span className="handle">{handle}</span> : null}
              <VisitBadge visits={row.visits} firstEver={row.firstEver} />
              <GradeBadge v={v} />
              <span className="time">{hhmm(row.tsMs)}</span>
            </div>
            {memoEl}
            <div className="gift-line">
              <span className="gift-name">{japaneseGiftName(row.giftName, row.giftId)}</span>
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
