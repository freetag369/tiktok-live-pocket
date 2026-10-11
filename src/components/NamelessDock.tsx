import { useLayoutEffect, useRef } from 'react';
import type { FeedRow } from '../lib/feed';
import { hhmm } from '../lib/format';
import type { MemoRecord } from '../lib/memos';
import { Avatar } from './Avatar';
import { GradeBadge, VisitBadge } from './Badges';

/** 枠の見た目の行数(CSS の --dock-rows と合わせる)。 */
export const DOCK_ROWS = 3;

type JoinRow = Extract<FeedRow, { k: 'join' }>;

interface Props {
  /** ニックネームの無い入室(古い順)。feed.ts の namelessJoins で絞ったもの。 */
  rows: JoinRow[];
  showAvatars: boolean;
  memos: ReadonlyMap<string, MemoRecord>;
  onTapRow?: (row: FeedRow) => void;
}

/** 固定枠の表示名: 既定名(user + 数字)ならそのまま、空なら @ハンドル、それも無ければユーザー ID。 */
export function namelessLabel(v: JoinRow['viewer']): string {
  const nick = v.nickname?.trim();
  if (nick) return nick;
  return v.uniqueId ? `@${v.uniqueId}` : `ID ${v.userId}`;
}

/**
 * 画面の一番下に固定する「ニックネームなしの入室」の枠。
 * 上のフィードとは別の固定カテゴリで、高さは入室 3 行ぶん。新着は下に積まれ、古い分は枠の中を上へスクロールして見る。
 * 行はコンパクト(1 行)にして、メモ・前回入室の文は出さない(タップでメモのシートが開く)。
 */
export function NamelessDock({ rows, showAvatars, memos, onTapRow }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // 枠が小さいので追従の ON/OFF は持たず、行が変わるたびに最下部へ寄せる。
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);

  return (
    <section className="dock" aria-label="ニックネームなしの入室">
      <div className="dock-title">
        ニックネームなしの入室
        {rows.length > 0 ? <span className="n">{rows.length}</span> : null}
      </div>
      <div ref={ref} className="dock-list">
        <div className="dock-inner">
          {rows.length === 0 ? <div className="dock-empty">ニックネーム未設定(user + 数字)の入室者はここに出ます</div> : null}
          {rows.map((r) => {
            const v = r.viewer;
            const label = namelessLabel(v);
            const m = memos.get(v.userId);
            const cls = `row join dock-row${r.firstEver ? ' first' : ''}${m?.note || m?.previousNote ? ' has-memo' : ''}${onTapRow ? ' tappable' : ''}`;
            return (
              <div key={r.id} className={cls} data-id={r.id} onClick={onTapRow ? () => onTapRow(r) : undefined}>
                <Avatar url={v.avatarUrl} name={v.nickname?.trim() || v.uniqueId || v.userId} enabled={showAvatars} />
                <div className="body">
                  <div className="head">
                    <GradeBadge v={v} />
                    <span className="who">{label}</span>
                    <span>が入室</span>
                    <VisitBadge visits={r.visits} firstEver={r.firstEver} />
                    <span className="time">{hhmm(r.tsMs)}</span>
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
