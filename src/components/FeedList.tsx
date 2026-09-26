import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { countAfter, filterRows, reconcileWindow, tailWindow, type FeedItem, type FeedRow, type Tab } from '../lib/feed';
import { dateRange, num } from '../lib/format';
import type { MemoRecord } from '../lib/memos';
import { FeedRowView } from './FeedRow';

export { filterRows, type Tab };
/** 画面のタブ全体。いいねはランキング、やり取りは人物一覧なので行を流さない。 */
export type ScreenTab = Tab | 'like' | 'people';

/** 一度に描く行数。これより前は「↑ さらに前」で足す(行が何万あっても DOM は軽いまま)。 */
export const WINDOW = 300;
/** 最下部に戻ったとみなす余白。 */
const BOTTOM_SLACK = 40;

interface Props {
  rows: FeedItem[];
  tab: Tab;
  showAvatars: boolean;
  bigGiftDiamonds: number;
  empty: React.ReactNode;
  /** リスナーメモ(userId → メモ)。行ごとに値で渡すので、メモが変わった人の行だけ再描画される。 */
  memos: ReadonlyMap<string, MemoRecord>;
  onTapRow?: (row: FeedRow) => void;
}

/** 追従を止めている間の窓。止めた時の行をそのまま保ち、新着は下に少しだけ足す。 */
interface Frozen {
  items: FeedItem[];
  appendLeft: number;
  tail: { id: string; tsMs: number } | null;
}

function lastRowOf(items: FeedItem[]): { id: string; tsMs: number } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.k !== 'room') return { id: it.id, tsMs: it.tsMs };
  }
  return null;
}

function rowNode(el: HTMLElement, id: string): HTMLElement | null {
  const inner = el.firstElementChild;
  if (!inner) return null;
  for (const kid of Array.from(inner.children)) {
    if ((kid as HTMLElement).dataset?.id === id) return kid as HTMLElement;
  }
  return null;
}

/** いま画面の上端にある行(二分探索)。「さらに前」で上に足したあとの位置合わせに使う。 */
function topRow(el: HTMLElement): { id: string; top: number } | null {
  const inner = el.firstElementChild;
  if (!inner) return null;
  const kids = inner.children;
  const y = el.scrollTop;
  let lo = 0;
  let hi = kids.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const k = kids[mid] as HTMLElement;
    if (k.offsetTop + k.offsetHeight > y) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  for (let i = found; i < kids.length; i++) {
    const k = kids[i] as HTMLElement;
    const id = k.dataset?.id;
    if (id) return { id, top: k.offsetTop };
  }
  return null;
}

/**
 * 新着は下に積まれ、最下部にいる間は自動で追従する。上へスクロールしたら追従を止め、
 * 「↓ 新着 N 件」で戻る(既存 PC アプリの見逃し防止と同じ思想)。
 * 追従を止めている間は表示中の行を動かさない(上限で落ちた入室も消さない)ので、画面が跳ねない。
 */
export function FeedList({ rows, tab, showAvatars, bigGiftDiamonds, empty, memos, onTapRow }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(true);
  const frozen = useRef<Frozen | null>(null);
  const shownRef = useRef<FeedItem[]>([]);
  /** 「さらに前」で上に行が増えたときだけ使うスクロール補正。 */
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const [, bump] = useState(0);

  const items = useMemo(() => filterRows(rows, tab), [rows, tab]);

  let shown: FeedItem[];
  let hiddenBefore: number;
  let appended = 0;
  const win = pinned ? null : frozen.current;
  if (win) {
    const w = reconcileWindow(win.items, items, win.appendLeft);
    if (w.stale) {
      shown = tailWindow(items, WINDOW);
      hiddenBefore = items.length - shown.length;
    } else {
      shown = w.items;
      hiddenBefore = w.hiddenBefore;
      appended = w.appended;
    }
  } else {
    shown = tailWindow(items, WINDOW);
    hiddenBefore = items.length - shown.length;
  }
  const unseen = pinned ? 0 : countAfter(items, frozen.current?.tail ?? null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    shownRef.current = shown;
    if (frozen.current) {
      frozen.current.items = shown;
      frozen.current.appendLeft = Math.max(0, frozen.current.appendLeft - appended);
    }
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const node = rowNode(el, a.id);
    if (!node) return;
    const d = node.offsetTop - a.top;
    if (Math.abs(d) >= 1) el.scrollTop += d;
  });

  // バナーの開閉・文字サイズ・回転で高さが変わっても、追従中は下に張り付く。
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK;
    if (bottom === pinnedRef.current) return;
    pinnedRef.current = bottom;
    if (bottom) frozen.current = null;
    else frozen.current = { items: shownRef.current, appendLeft: WINDOW, tail: lastRowOf(shownRef.current) };
    setPinned(bottom);
  }, []);

  const jump = () => {
    frozen.current = null;
    pinnedRef.current = true;
    setPinned(true);
  };

  const showEarlier = () => {
    const el = ref.current;
    if (!el || hiddenBefore <= 0) return;
    const cur = frozen.current ?? { items: shownRef.current, appendLeft: WINDOW, tail: lastRowOf(shownRef.current) };
    anchor.current = topRow(el);
    const older = items.slice(Math.max(0, hiddenBefore - WINDOW), hiddenBefore);
    if (older.length === 0) return;
    frozen.current = { items: older.concat(cur.items), appendLeft: cur.appendLeft, tail: cur.tail };
    pinnedRef.current = false;
    setPinned(false);
    bump((n) => n + 1);
  };

  return (
    <div ref={ref} className={`feed${tab === 'gift' ? ' gifts-only' : ''}`} onScroll={onScroll}>
      <div className="feed-inner">
        {items.length === 0 ? <div className="empty">{empty}</div> : null}
        {hiddenBefore > 0 ? (
          <button className="btn more" onClick={showEarlier}>
            ↑ さらに前の {num(Math.min(WINDOW, hiddenBefore))} 件を表示(残り {num(hiddenBefore)} 件)
          </button>
        ) : null}
        {shown.map((r) => {
          if (r.k === 'room') {
            return (
              <div key={r.id} className="room-sep" data-id={r.id}>
                <span>
                  新しい配信 · {dateRange(r.tsMs, r.tsMs)}
                  {r.hostNickname ? ` · ${r.hostNickname}` : ''}
                </span>
              </div>
            );
          }
          const m = memos.get(r.viewer.userId);
          return <FeedRowView key={r.id} row={r} showAvatars={showAvatars} bigGiftDiamonds={bigGiftDiamonds} note={m?.note} kana={m?.kana || undefined} onTap={onTapRow} />;
        })}
      </div>
      {!pinned && unseen > 0 ? (
        <button className="newer" onClick={jump}>
          ↓ 新着 {num(unseen)} 件
        </button>
      ) : null}
    </div>
  );
}
