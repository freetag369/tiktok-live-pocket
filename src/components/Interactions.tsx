import { useEffect, useMemo, useRef, useState } from 'react';
import { MemoLines } from './MemoLines';
import type { FeedItem, FeedRow } from '../lib/feed';
import { hhmm, num, lastJoined } from '../lib/format';
import { buildInteractions, currentRoomRows, filterInteractions, mergeRows, sortInteractions, type Interaction, type InteractionSort } from '../lib/interactions';
import type { LikeEntry } from '../lib/likes';
import { hasMemoContent, type MemoRecord } from '../lib/memos';
import { displayName, handleOf } from '../lib/names';
import type { LiveSession } from '../lib/session';
import { judgeSwipe } from '../lib/swipe';
import { Avatar } from './Avatar';
import { RoleBadges, VisitBadge } from './Badges';
import { FeedRowView } from './FeedRow';
import type { MemoTarget } from './MemoSheet';

/**
 * 「やり取り」タブ。受信中の配信でコメント・ギフト・いいねをくれた人を並べ、
 * タップでその人の履歴(入室・フォローも含む)を開き、そこからメモを書く。
 *
 *  - 行は 画面の履歴(最後の区切り以降)+ アーカイブ(🧹 で消えた分の補い)。いいねは FeedState.likes。
 *  - アーカイブはタブを開いたとき・🧹 のとき(screenEpoch)・配信が変わったときに読み直す。
 *  - 人物シートは一覧の上に重ねて出す(一覧はアンマウントしない)。戻ったとき一覧のスクロール位置が
 *    そのまま残り、見ていた人の行だけ scrollIntoView で見える位置に寄せる。
 *  - シート上で右スワイプすると一覧順で次の人、左スワイプで前の人へ即切り替え。
 */

interface Props {
  session: LiveSession;
  /** いま行を積んでいる配信(snap.feed.roomId)。空ならまだ何も無い。 */
  roomId: string;
  rows: FeedItem[];
  likes: Map<string, LikeEntry>;
  likeCount: number;
  screenEpoch: number;
  memos: ReadonlyMap<string, MemoRecord>;
  showAvatars: boolean;
  bigGiftDiamonds: number;
  onMemo: (target: MemoTarget) => void;
  empty: React.ReactNode;
}

function targetOf(it: Interaction): MemoTarget {
  const v = it.viewer;
  return { userId: it.userId, nickname: v.nickname, uniqueId: v.uniqueId, avatarUrl: v.avatarUrl, visits: it.visits, firstEver: it.firstEver };
}

export function Interactions({ session, roomId, rows, likes, likeCount, screenEpoch, memos, showAvatars, bigGiftDiamonds, onMemo, empty }: Props) {
  const [archived, setArchived] = useState<{ roomId: string; rows: FeedRow[] } | null>(null);
  const [sort, setSort] = useState<InteractionSort>('recent');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!roomId) return;
    let alive = true;
    void session.loadArchivedStream(roomId).then((r) => {
      if (alive) setArchived({ roomId, rows: r });
    });
    return () => {
      alive = false;
    };
  }, [session, roomId, screenEpoch]);

  const merged = useMemo(() => mergeRows(archived && archived.roomId === roomId ? archived.rows : [], currentRoomRows(rows)), [archived, roomId, rows]);
  // likes の Map はその場で更新されるので likeCount を変化の印にする。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => buildInteractions(merged, likes), [merged, likes, likeCount]);
  const list = useMemo(() => filterInteractions(sortInteractions(all, sort), query, memos), [all, sort, query, memos]);

  const person = open ? all.find((i) => i.userId === open) : undefined;
  useEffect(() => {
    if (open && !person) setOpen(null);
  }, [open, person]);

  /** 一覧(並び順・絞り込み後)での隣の人へ。端や、絞り込みで一覧に居ない人からは動かない。 */
  const step = (d: 1 | -1) => {
    const idx = list.findIndex((i) => i.userId === open);
    const next = idx >= 0 ? list[idx + d] : undefined;
    if (next) setOpen(next.userId);
  };

  /** シートを閉じる。一覧は残っているので、見ていた人の行が隠れていたら見える所まで寄せてから戻す。 */
  const close = () => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-uid=${JSON.stringify(open)}]`)?.scrollIntoView({ block: 'nearest' });
    setOpen(null);
  };

  return (
    <>
      {person ? <PersonSheet key={person.userId} it={person} memo={memos.get(person.userId)} showAvatars={showAvatars} bigGiftDiamonds={bigGiftDiamonds} onMemo={onMemo} onBack={close} onNext={() => step(1)} onPrev={() => step(-1)} /> : null}
      <div className="people">
        {all.length === 0 ? (
          <div className="empty">{empty}</div>
        ) : (
          <>
            <div className="people-tools">
              <div className="seg" role="tablist" aria-label="並び順">
                <button className={sort === 'recent' ? 'on' : ''} onClick={() => setSort('recent')}>
                  新しい順
                </button>
                <button className={sort === 'most' ? 'on' : ''} onClick={() => setSort('most')}>
                  多い順
                </button>
              </div>
              <input type="search" inputMode="search" placeholder="名前・@・メモ・前回で絞り込み" value={query} autoCapitalize="none" autoCorrect="off" onChange={(e) => setQuery(e.target.value)} />
            </div>
            <p className="note people-count">
              {num(all.length)} 人{list.length !== all.length ? ` · 絞り込み ${num(list.length)} 人` : ''}。タップすると履歴とメモ。
            </p>
            <div className="people-list" ref={listRef}>
              {list.length === 0 ? <div className="empty">該当する人がいません。</div> : null}
              {list.map((it) => (
                <PersonRow key={it.userId} previousJoinedMs={session.previousJoinedFor(it.userId)} it={it} memo={memos.get(it.userId)} showAvatars={showAvatars} onPick={() => setOpen(it.userId)} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function nameOf(it: Interaction, memo?: MemoRecord): { name: string; handle: string } {
  const v = it.viewer;
  const name = displayName(v, memo);
  return { name, handle: handleOf(v, name, memo) };
}

/** 💬 🎁💎 ❤️ 🚪 ➕ の数。likeTime を付けると ❤️ に最後のいいね時刻も添える(人物シート用)。 */
function Counts({ it, likeTime }: { it: Interaction; likeTime?: boolean }) {
  return (
    <div className="prow-counts">
      {it.comments > 0 ? <span>💬 {num(it.comments)}</span> : null}
      {it.gifts > 0 ? (
        <span>
          🎁 {num(it.gifts)} · <b className="dia">💎 {num(it.diamonds)}</b>
        </span>
      ) : null}
      {it.likes > 0 ? (
        <span className="likes">
          ❤️ {num(it.likes)}
          {likeTime && it.likeLastMs ? ` · 最後 ${hhmm(it.likeLastMs)}` : ''}
        </span>
      ) : null}
      {it.joins > 0 ? <span className="faint">🚪 {num(it.joins)}</span> : null}
      {it.follows > 0 ? <span className="faint">➕ フォロー</span> : null}
    </div>
  );
}

function PersonRow({ it, memo, showAvatars, onPick, previousJoinedMs }: { previousJoinedMs?: number; it: Interaction; memo?: MemoRecord; showAvatars: boolean; onPick: () => void }) {
  const { name, handle } = nameOf(it, memo);
  return (
    <button className={`vrow prow${hasMemoContent(memo) ? ' has-memo' : ''}${memo?.favorite ? ' fav' : ''}`} data-uid={it.userId} onClick={onPick}>
      <Avatar url={it.viewer.avatarUrl} name={name} enabled={showAvatars} />
      <div className="body">
        <div className="head">
          <span className="who">{name}</span>
          {memo?.kana ? <span className="kana">({memo.kana})</span> : null}
          {handle ? <span className="handle">{handle}</span> : null}
          <VisitBadge visits={it.visits} firstEver={it.firstEver} />
          <span className="time">{hhmm(it.lastMs)}</span>
        </div>
        <div className="last-joined">前回入室：{lastJoined(previousJoinedMs)}</div>
        <Counts it={it} />
        <MemoLines note={memo?.note} previousNote={memo?.previousNote} />
      </div>
    </button>
  );
}

interface PersonProps {
  it: Interaction;
  memo?: MemoRecord;
  showAvatars: boolean;
  bigGiftDiamonds: number;
  onMemo: (target: MemoTarget) => void;
  onBack: () => void;
  /** 右スワイプ(指が左→右)で呼ぶ。一覧順で次の人へ。 */
  onNext?: () => void;
  /** 左スワイプで呼ぶ。前の人へ。 */
  onPrev?: () => void;
}

/**
 * 1 人の履歴(全画面)。上に名前・バッジ・数・メモを 1 回だけ出し、コメントは「時刻 + 本文」だけの行、
 * ギフト・入室・フォローは本画面と同じ FeedRowView。行タップ・📝・下のボタンのどれでもメモが開く。
 * 横スワイプは指を離すのを待たず、判定が付いた瞬間に onNext / onPrev を 1 回だけ呼ぶ。
 */
export function PersonSheet({ it, memo, showAvatars, bigGiftDiamonds, onMemo, onBack, onNext, onPrev }: PersonProps) {
  const { name, handle } = nameOf(it, memo);
  const openMemo = () => onMemo(targetOf(it));

  // 1 本指の開始点と「この指ではもう発火した」印。描画には関わらないので ref。
  const touch = useRef<{ x: number; y: number; done: boolean } | null>(null);
  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    touch.current = null;
    if (e.touches.length !== 1) return;
    // バッジ行が横にスクロールする状態なら、そこから始まった指は横スクロールに譲る
    const strip = (e.target as Element | null)?.closest?.('.person-summary');
    if (strip && strip.scrollWidth > strip.clientWidth) return;
    const t = e.touches[0]!;
    touch.current = { x: t.clientX, y: t.clientY, done: false };
  };
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const s = touch.current;
    if (!s || s.done || e.touches.length !== 1) return;
    const t = e.touches[0]!;
    const dir = judgeSwipe(s, t.clientX, t.clientY);
    if (!dir) return;
    s.done = true;
    if (dir === 'right') onNext?.();
    else onPrev?.();
  };
  const onTouchEnd = () => {
    touch.current = null;
  };

  return (
    <div className="sheet person" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
      <header className="header">
        <button className="iconbtn" onClick={onBack} aria-label="戻る">
          ‹
        </button>
        <Avatar url={it.viewer.avatarUrl} name={name} enabled={showAvatars} />
        <div className="status">
          <div className="txt">
            <span className="host">
              {name}
              {memo?.kana ? <span className="kana">({memo.kana})</span> : null}
            </span>
            {handle ? <span className="sub">{handle}</span> : null}
          </div>
        </div>
        <button className="iconbtn" onClick={openMemo} aria-label="メモを書く">
          📝
        </button>
      </header>
      <div className="person-head">
        {/* バッジ・やり取りの数・いいね(最後の時刻つき)を 1 行にまとめる */}
        <div className="person-summary">
          <VisitBadge visits={it.visits} firstEver={it.firstEver} />
          <RoleBadges v={it.viewer} />
          <Counts it={it} likeTime />
        </div>
        <button className={`memo-line${memo?.note ? '' : ' faint'}`} onClick={openMemo}>
          {memo?.note ? `📝 ${memo.note}` : '📝 メモなし — タップして書く'}
        </button>
      </div>
      {memo?.previousNote ? <button className="memo-line" onClick={openMemo}>前回：{memo.previousNote}</button> : null}
      <div className="feed archive">
        <div className="feed-inner">
          {it.rows.length === 0 ? (
            <div className="empty">この配信ではいいねだけです。</div>
          ) : (
            it.rows.map((r) =>
              r.k === 'comment' ? (
                <CommentLine key={r.id} row={r} onTap={openMemo} />
              ) : (
                <FeedRowView key={r.id} row={r} showAvatars={showAvatars} bigGiftDiamonds={bigGiftDiamonds} note={memo?.note} previousNote={memo?.previousNote} kana={memo?.kana || undefined} favorite={memo?.favorite} onTap={openMemo} />
              )
            )
          )}
        </div>
      </div>
      <div className="archive-actions">
        <button className="btn primary" onClick={openMemo}>
          {hasMemoContent(memo) ? '📝 メモを直す' : '📝 メモを書く'}
        </button>
      </div>
    </div>
  );
}

/** コメントの簡易行。名前・アイコン・メモは上に出ているので、時刻と本文だけ。 */
function CommentLine({ row, onTap }: { row: Extract<FeedRow, { k: 'comment' }>; onTap: () => void }) {
  return (
    <div className="row cline tappable" data-id={row.id} onClick={onTap}>
      <time>{hhmm(row.tsMs)}</time>
      <span className="text">{row.text}</span>
    </div>
  );
}
