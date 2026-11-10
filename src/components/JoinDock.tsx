import { useLayoutEffect, useRef } from 'react';
import type { FeedRow, JoinRow } from '../lib/feed';
import { lastJoined, lastJoinedShort } from '../lib/format';
import { Avatar } from './Avatar';
import { GradeBadge, VisitBadge } from './Badges';
import { visibleName } from '../lib/names';

/** 枠の見た目の行数(CSS の --dock-rows と合わせる)。 */
export const DOCK_ROWS = 5;

interface Props {
  /** 入室(古い順)。feed.ts の dockJoins で絞ったもの(メモ・前回・よみがなの無い人だけ)。 */
  rows: JoinRow[];
  showAvatars: boolean;
  previousJoinedFor?: (userId: string) => number | undefined;
  /** お気に入りの人か(行の背景を青にする)。 */
  isFavorite?: (userId: string) => boolean;
  onTapRow?: (row: FeedRow) => void;
}

/** 固定枠の表示名: ニックネーム(TikTok の既定名 user + 数字もそのまま)。描ける文字が無ければ @ハンドル、それも無ければユーザー ID。 */
export function dockLabel(v: JoinRow['viewer']): string {
  const nick = visibleName(v.nickname);
  if (nick) return nick;
  return v.uniqueId ? `@${v.uniqueId}` : `ID ${v.userId}`;
}

/**
 * 画面の一番下に固定する枠の左の列「入室」(右の列はギフト = GiftDock)。すべて・コメントタブに出す。
 * 常連さんの入室ポップアップが ON なら、常連さんの最初の入室はポップアップだけにし、それ以外の入室を全部ここに出す。
 * OFF なら、メモ・前回・よみがなのどれも書いていない人の入室だけをここに出し、書いてある人の入室は上のフィードに緑タグで流す。
 * 上のフィードとは別の固定カテゴリで、高さは入室 5 行ぶん。新着は下に積まれ、古い分は枠の中を上へスクロールして見る。
 * 列が狭いので行は 1 行で、名前・回数(初見)・前回入室日(初見は出さない)だけ出す(タップでメモのシートが開く)。
 */
export function JoinDock({ rows, showAvatars, previousJoinedFor, isFavorite, onTapRow }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // 枠が小さいので追従の ON/OFF は持たず、行が変わるたびに最下部へ寄せる。
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);

  return (
    <section className="dock-col dock-joins" aria-label="入室">
      <div className="dock-title">
        入室
        {rows.length > 0 ? <span className="n">{rows.length}</span> : null}
      </div>
      <div ref={ref} className="dock-list">
        <div className="dock-inner">
          {rows.length === 0 ? <div className="dock-empty">入室した人はここに出ます</div> : null}
          {rows.map((r) => {
            const v = r.viewer;
            const label = dockLabel(v);
            const cls = `row join dock-row${r.firstEver ? ' first' : ''}${isFavorite?.(v.userId) ? ' fav' : ''}${onTapRow ? ' tappable' : ''}`;
            return (
              <div key={r.id} className={cls} data-id={r.id} onClick={onTapRow ? () => onTapRow(r) : undefined}>
                <Avatar url={v.avatarUrl} name={label} enabled={showAvatars} />
                <div className="body">
                  <div className="head">
                    <GradeBadge v={v} />
                    <span className="who">{label}</span>
                    <VisitBadge visits={r.visits} firstEver={r.firstEver} />
                    {previousJoinedFor && !r.firstEver ? <PrevJoined ms={previousJoinedFor(v.userId)} /> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** 枠の「前回 11/4」。日時の全体(何時か)は title に入れる。 */
function PrevJoined({ ms }: { ms: number | undefined }) {
  return (
    <span className="prev" title={`前回入室：${lastJoined(ms)}`}>
      前回 {lastJoinedShort(ms)}
    </span>
  );
}
