import { memo } from 'react';
import { MemoLines } from './MemoLines';
import type { FeedRow as Row } from '../lib/feed';
import { hhmm, num, lastJoined } from '../lib/format';
import { japaneseGiftName } from '../lib/gift-names';
import { displayName } from '../lib/names';
import { Avatar, GiftIcon } from './Avatar';
import { GradeBadge, RoleBadges, VisitBadge } from './Badges';

export interface RowProps {
  row: Row;
  showAvatars: boolean;
  bigGiftDiamonds: number;
  /** この人のリスナーメモ(あれば)。描画時に引くので、配信中に直してもすぐ反映される。 */
  note?: string;
  /** 「前回」メモ。フィードでは配信ごとにその人の最初の行にだけ渡される(FeedList 側で絞る)。 */
  previousNote?: string;
  kana?: string;
  /** お気に入りの人。行の背景を青にする。 */
  favorite?: boolean;
  showPreviousJoined?: boolean;
  previousJoinedMs?: number;
  /** 行をタップしたとき(メモを書く)。 */
  onTap?: (row: Row) => void;
}

export const FeedRowView = memo(function FeedRowView({ row, showAvatars, bigGiftDiamonds, note, previousNote, kana, favorite, onTap, showPreviousJoined, previousJoinedMs }: RowProps) {
  const v = row.viewer;
  const name = displayName(v);
  const extra = `${row.firstEver ? ' first' : ''}${favorite ? ' fav' : ''}${note || previousNote ? ' has-memo' : ''}${onTap ? ' tappable' : ''}`;
  const click = onTap ? () => onTap(row) : undefined;
  const kanaEl = kana ? <span className="kana">({kana})</span> : null;
  const memoEl = <MemoLines note={note} previousNote={previousNote} />;

  const joinedEl = showPreviousJoined ? <div className="last-joined">前回入室：{lastJoined(previousJoinedMs)}</div> : null;

  switch (row.k) {
    case 'comment':
      return (
        <div className={`row comment${extra}`} data-id={row.id} onClick={click}>
          <Avatar url={v.avatarUrl} name={name} enabled={showAvatars} />
          <div className="body">
            <div className="head">
              <span className="who">{name}</span>
              {kanaEl}
              <VisitBadge visits={row.visits} firstEver={row.firstEver} />
              <RoleBadges v={v} />
              <span className="time">{hhmm(row.tsMs)}</span>
            </div>
            {joinedEl}
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
            {joinedEl}
            {memoEl}
          </div>
        </div>
      );

    case 'like':
      // いいね(1 分ごとにまとめた行)。アーカイブの「すべて」にだけ出る(画面のフィードには流さない)。
      return (
        <div className={`row social like${extra}`} data-id={row.id} onClick={click}>
          <Avatar url={v.avatarUrl} name={name} enabled={showAvatars} />
          <div className="body">
            <div className="head">
              <span className="who">{name}</span>
              {kanaEl}
              <span>がいいね ❤️ ×{num(row.count)}</span>
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
            {joinedEl}
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
              <VisitBadge visits={row.visits} firstEver={row.firstEver} />
              <GradeBadge v={v} />
              <span className="time">{hhmm(row.tsMs)}</span>
            </div>
            {joinedEl}
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
