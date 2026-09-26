import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArchivedRow } from '../lib/archive';
import { highlightMembers, japanDay, japanTime } from '../lib/highlights';
import type { LiveSession } from '../lib/session';
import type { MemoRecord } from '../lib/memos';
import { japaneseGiftName } from '../lib/gift-names';
import { Avatar } from './Avatar';
import { MemoSheet, type MemoTarget } from './MemoSheet';

const PAGE = 100;

export function ActionHistory({ day, rows }: { day: string; rows: ArchivedRow[] }) {
  const [limit, setLimit] = useState(PAGE);
  return <section className="action-history" aria-label="アクション歴">
    <h2>{day} のアクション歴</h2>
    {rows.slice(0, limit).map(row => <div className="action-entry" key={JSON.stringify([row.roomId, row.id])}>
      <time>{japanTime(row.tsMs)}</time>
      <span>{row.k === 'comment' ? `💬 ${row.text}` : row.k === 'like' ? `♥ いいね ×${row.count.toLocaleString('ja-JP')}` : row.k === 'gift' ? `🎁 ${japaneseGiftName(row.giftName, row.giftId)} ×${row.count.toLocaleString('ja-JP')}` : 'フォロー'}</span>
    </div>)}
    {!rows.length && <p className="note">この日のアクションはありません</p>}
    {rows.length > limit && <button className="btn" onClick={() => setLimit(n => n + PAGE)}>さらに表示</button>}
  </section>;
}

export function Highlights({ session, revision, memos, showAvatars, archiveEnabled }: {
  session: LiveSession; revision: number; memos: ReadonlyMap<string, MemoRecord>; showAvatars: boolean; archiveEnabled: boolean;
}) {
  const [day, setDay] = useState(() => japanDay());
  const [rows, setRows] = useState<ArchivedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [target, setTarget] = useState<MemoTarget | null>(null);
  const latestRevision = useRef(revision);
  latestRevision.current = revision;
  useEffect(() => {
    let active = true;
    let busy = false;
    let loadedRevision = -1;
    const refresh = () => {
      if (busy || loadedRevision === latestRevision.current) return;
      busy = true;
      const requestedRevision = latestRevision.current;
      void session.highlightsForDay(day).then(result => {
        if (active) { setRows(result); setLoading(false); setError(''); }
      }).catch(async () => {
        const live = await session.highlightsForDay(day, true);
        if (active) { setRows(live); setLoading(false); setError('保存済みの履歴を読み込めませんでした。受信中の記録を表示しています。'); }
      }).finally(() => { busy = false; loadedRevision = requestedRevision; });
    };
    refresh();
    // Fixed polling avoids starving updates during a continuous event burst.
    const timer = setInterval(refresh, 250);
    return () => { active = false; clearInterval(timer); };
  }, [session, day]);
  const members = useMemo(() => highlightMembers(rows), [rows]);
  return <div className="highlights">
    <div className="highlight-tools">
      <label>日付 <input aria-label="ハイライトの日付" type="date" value={day} onChange={e => {
        if (!e.target.value) return;
        setDay(e.target.value); setRows([]); setLoading(true); setLimit(PAGE); setTarget(null);
      }} /></label>
      <span>{members.length.toLocaleString('ja-JP')} 人 · 日本時間</span>
    </div>
    {!archiveEnabled && <p className="note highlight-note">保存はOFFです。受信中の履歴は再起動すると消えます。</p>}
    {error && <p role="status" className="note highlight-note">{error}</p>}
    <div className="highlight-list">
      {loading ? <div className="empty">読み込み中…</div> : !members.length && <div className="empty">この日のアクションはありません</div>}
      {members.slice(0, limit).map(member => {
        const row = member.row;
        const v = row.viewer;
        const memo = memos.get(v.userId);
        const name = v.nickname || memo?.nickname || v.uniqueId || v.userId;
        return <button className="vrow" key={v.userId} onClick={() => setTarget({ ...v, visits: row.visits, firstEver: row.firstEver })}>
          <Avatar url={v.avatarUrl} name={name} enabled={showAvatars} />
          <div className="body">
            <div className="head"><span className="who">{name}</span>{memo?.kana && <span className="kana">({memo.kana})</span>}<span className="time">{japanTime(row.tsMs)}</span></div>
            {v.uniqueId && <div className="handle">@{v.uniqueId}</div>}
            <div className="highlight-counts"><span>コメント {member.comments}</span><span>いいね {member.likes}</span><span>フォロー {member.follows}</span><span>ギフト {member.gifts}</span></div>
            <div className="memo-line">{memo?.note ? `📝 ${memo.note}` : 'メモなし'}</div>
          </div>
        </button>;
      })}
      {members.length > limit && <button className="btn" onClick={() => setLimit(n => n + PAGE)}>さらに表示</button>}
    </div>
    {target && <MemoSheet key={target.userId} target={target} current={memos.get(target.userId)} showAvatars={showAvatars}
      onSave={patch => session.setMemo(target.userId, patch)} onClose={() => setTarget(null)}
      history={<ActionHistory day={day} rows={rows.filter(r => r.viewer.userId === target.userId)} />} />}
  </div>;
}
