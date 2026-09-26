import { useEffect, useMemo, useState } from 'react';
import type { FeedItem, FeedRow } from '../lib/feed';
import { hhmm, num } from '../lib/format';
import { buildInteractions, currentRoomRows, filterInteractions, mergeRows, sortInteractions, type Interaction, type InteractionSort } from '../lib/interactions';
import type { LikeEntry } from '../lib/likes';
import type { MemoRecord } from '../lib/memos';
import type { LiveSession } from '../lib/session';
import { Avatar } from './Avatar';
import { VisitBadge } from './Badges';
import { FeedRowView } from './FeedRow';
import type { MemoTarget } from './MemoSheet';

/**
 * 「やり取り」タブ。受信中の配信でコメント・ギフト・いいねをくれた人を並べ、
 * タップでその人の履歴(入室・フォローも含む)を開き、そこからメモを書く。
 *
 *  - 行は 画面の履歴(最後の区切り以降)+ アーカイブ(🧹 で消えた分の補い)。いいねは FeedState.likes。
 *  - アーカイブはタブを開いたとき・🧹 のとき(screenEpoch)・配信が変わったときに読み直す。
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

  if (person) {
    return <PersonSheet it={person} memo={memos.get(person.userId)} showAvatars={showAvatars} bigGiftDiamonds={bigGiftDiamonds} onMemo={onMemo} onBack={() => setOpen(null)} />;
  }

  return (
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
            <input type="search" inputMode="search" placeholder="名前・@・メモで絞り込み" value={query} autoCapitalize="none" autoCorrect="off" onChange={(e) => setQuery(e.target.value)} />
          </div>
          <p className="note people-count">
            {num(all.length)} 人{list.length !== all.length ? ` · 絞り込み ${num(list.length)} 人` : ''}。タップすると履歴とメモ。
          </p>
          <div className="people-list">
            {list.length === 0 ? <div className="empty">該当する人がいません。</div> : null}
            {list.map((it) => (
              <PersonRow key={it.userId} it={it} memo={memos.get(it.userId)} showAvatars={showAvatars} onPick={() => setOpen(it.userId)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function nameOf(it: Interaction, memo?: MemoRecord): { name: string; handle: string } {
  const v = it.viewer;
  const name = v.nickname || memo?.nickname || v.uniqueId || memo?.uniqueId || it.userId;
  const h = v.uniqueId || memo?.uniqueId;
  return { name, handle: h && h !== name ? `@${h}` : '' };
}

function Counts({ it }: { it: Interaction }) {
  return (
    <div className="prow-counts">
      {it.comments > 0 ? <span>💬 {num(it.comments)}</span> : null}
      {it.gifts > 0 ? (
        <span>
          🎁 {num(it.gifts)} · <b className="dia">💎 {num(it.diamonds)}</b>
        </span>
      ) : null}
      {it.likes > 0 ? <span className="likes">❤️ {num(it.likes)}</span> : null}
      {it.joins > 0 ? <span className="faint">🚪 {num(it.joins)}</span> : null}
      {it.follows > 0 ? <span className="faint">➕ フォロー</span> : null}
    </div>
  );
}

function PersonRow({ it, memo, showAvatars, onPick }: { it: Interaction; memo?: MemoRecord; showAvatars: boolean; onPick: () => void }) {
  const { name, handle } = nameOf(it, memo);
  return (
    <button className={`vrow prow${memo ? ' has-memo' : ''}`} onClick={onPick}>
      <Avatar url={it.viewer.avatarUrl} name={name} enabled={showAvatars} />
      <div className="body">
        <div className="head">
          <span className="who">{name}</span>
          {memo?.kana ? <span className="kana">({memo.kana})</span> : null}
          {handle ? <span className="handle">{handle}</span> : null}
          <VisitBadge visits={it.visits} firstEver={it.firstEver} />
          <span className="time">{hhmm(it.lastMs)}</span>
        </div>
        <Counts it={it} />
        {memo?.note ? <div className="memo-line">📝 {memo.note}</div> : null}
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
}

/** 1 人の履歴(全画面)。行は本画面と同じ FeedRowView。行タップ・📝・下のボタンのどれでもメモが開く。 */
function PersonSheet({ it, memo, showAvatars, bigGiftDiamonds, onMemo, onBack }: PersonProps) {
  const { name, handle } = nameOf(it, memo);
  const openMemo = () => onMemo(targetOf(it));
  return (
    <div className="sheet person">
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
            <span className="sub">
              {handle}
              {handle ? ' · ' : ''}
              <VisitBadge visits={it.visits} firstEver={it.firstEver} />
            </span>
          </div>
        </div>
        <button className="iconbtn" onClick={openMemo} aria-label="メモを書く">
          📝
        </button>
      </header>
      <div className="person-head">
        <Counts it={it} />
        {it.likes > 0 ? (
          <div className="person-likes">
            ❤️ いいね <b>{num(it.likes)}</b> 回{it.likeLastMs ? ` · 最後 ${hhmm(it.likeLastMs)}` : ''}
            <small>(いいねは回数だけで、時刻ごとの履歴は残りません)</small>
          </div>
        ) : null}
        <button className={`memo-line${memo?.note ? '' : ' faint'}`} onClick={openMemo}>
          {memo?.note ? `📝 ${memo.note}` : '📝 メモなし — タップして書く'}
        </button>
      </div>
      <div className="feed archive">
        <div className="feed-inner">
          {it.rows.length === 0 ? (
            <div className="empty">この配信ではいいねだけです。</div>
          ) : (
            it.rows.map((r) => <FeedRowView key={r.id} row={r} showAvatars={showAvatars} bigGiftDiamonds={bigGiftDiamonds} note={memo?.note} kana={memo?.kana || undefined} onTap={openMemo} />)
          )}
        </div>
      </div>
      <div className="archive-actions">
        <button className="btn primary" onClick={openMemo}>
          {memo ? '📝 メモを直す' : '📝 メモを書く'}
        </button>
      </div>
    </div>
  );
}
