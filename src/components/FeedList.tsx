import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { filterRows, type FeedRow, type Tab } from '../lib/feed';
import type { MemoRecord } from '../lib/memos';
import { FeedRowView } from './FeedRow';

export { filterRows, type Tab };

interface Props {
  rows: FeedRow[];
  tab: Tab;
  showAvatars: boolean;
  bigGiftDiamonds: number;
  empty: React.ReactNode;
  /** リスナーメモ(userId → メモ)。行ごとに値で渡すので、メモが変わった人の行だけ再描画される。 */
  memos: ReadonlyMap<string, MemoRecord>;
  onTapRow?: (row: FeedRow) => void;
}

/**
 * 新着は下に積まれ、最下部にいる間は自動で追従する。上へスクロールしたら追従を止め、
 * 「↓ 新着 N 件」で戻る(既存 PC アプリの見逃し防止と同じ思想)。
 */
export function FeedList({ rows, tab, showAvatars, bigGiftDiamonds, empty, memos, onTapRow }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const lastLen = useRef(0);
  const visible = filterRows(rows, tab);

  const atBottom = (el: HTMLDivElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 40;

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const b = atBottom(el);
    setPinned(b);
    if (b) setUnseen(0);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (pinned) {
      el.scrollTop = el.scrollHeight;
      setUnseen(0);
    } else if (visible.length > lastLen.current) {
      setUnseen((n) => n + (visible.length - lastLen.current));
    }
    lastLen.current = visible.length;
  }, [visible.length, pinned, tab]);

  useEffect(() => {
    // タブ切替時は必ず最下部へ
    setPinned(true);
    setUnseen(0);
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tab]);

  const jump = () => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setPinned(true);
    setUnseen(0);
  };

  return (
    <div ref={ref} className={`feed${tab === 'gift' ? ' gifts-only' : ''}`} onScroll={onScroll}>
      <div className="feed-inner">
        {visible.length === 0 ? <div className="empty">{empty}</div> : null}
        {visible.map((r) => {
          const m = memos.get(r.viewer.userId);
          return <FeedRowView key={r.id} row={r} showAvatars={showAvatars} bigGiftDiamonds={bigGiftDiamonds} note={m?.note} kana={m?.kana || undefined} onTap={onTapRow} />;
        })}
      </div>
      {!pinned && unseen > 0 ? (
        <button className="newer" onClick={jump}>
          ↓ 新着 {unseen} 件
        </button>
      ) : null}
    </div>
  );
}
