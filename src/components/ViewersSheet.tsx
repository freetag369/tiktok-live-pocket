import { useMemo, useState } from 'react';
import type { ViewerListItem } from '../lib/session';
import { relativeDay } from '../lib/format';
import { Avatar } from './Avatar';
import { VisitBadge } from './Badges';

interface Props {
  items: ViewerListItem[];
  showAvatars: boolean;
  onPick: (item: ViewerListItem) => void;
  onClose: () => void;
}

const PAGE = 200;

/**
 * リスナー一覧。来店履歴(保存済み全員)を最近来た順に並べ、タップでメモを書く。
 * フィードの行はアプリを閉じると消えるので、配信の翌日にメモを書く入口はここ。
 */
export function ViewersSheet({ items, showAvatars, onPick, onClose }: Props) {
  const [q, setQ] = useState('');
  const [memoOnly, setMemoOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      if (memoOnly && !it.memo) return false;
      if (!needle) return true;
      return [it.nickname, it.uniqueId, it.memo?.note, it.memo?.kana].some((s) => s && s.toLowerCase().includes(needle));
    });
  }, [items, q, memoOnly]);

  const shown = filtered.slice(0, limit);
  const memoCount = items.reduce((n, it) => n + (it.memo ? 1 : 0), 0);

  return (
    <div className="sheet viewers">
      <header className="header">
        <h1>リスナー一覧</h1>
        <button className="iconbtn" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
      </header>
      <div className="viewers-tools">
        <input type="search" inputMode="search" placeholder="名前・@ハンドル・メモで検索" value={q} autoCapitalize="none" autoCorrect="off" onChange={(e) => setQ(e.target.value)} />
        <label className="viewers-toggle">
          <input type="checkbox" checked={memoOnly} onChange={(e) => setMemoOnly(e.target.checked)} /> メモありだけ
        </label>
      </div>
      <p className="note viewers-count">
        {items.length.toLocaleString('ja-JP')} 人 · メモ {memoCount.toLocaleString('ja-JP')} 件{filtered.length !== items.length ? ` · 絞り込み ${filtered.length.toLocaleString('ja-JP')} 人` : ''}。行をタップするとメモを書けます。
      </p>
      <div className="scroll viewers-list">
        {shown.length === 0 ? <div className="empty">{items.length === 0 ? '来店履歴がまだありません。配信を受信すると、ここに来た人が並びます。' : '該当する人がいません。'}</div> : null}
        {shown.map((it) => {
          const name = it.nickname || it.memo?.nickname || it.uniqueId || it.userId;
          const handle = it.uniqueId || it.memo?.uniqueId;
          return (
            <button key={it.userId} className={`vrow${it.memo ? ' has-memo' : ''}`} onClick={() => onPick(it)}>
              <Avatar url={it.avatarUrl} name={name} enabled={showAvatars} />
              <div className="body">
                <div className="head">
                  <span className="who">{name}</span>
                  {it.memo?.kana ? <span className="kana">({it.memo.kana})</span> : null}
                  {handle && handle !== name ? <span className="handle">@{handle}</span> : null}
                  {it.visits > 0 ? <VisitBadge visits={it.visits} firstEver={false} /> : null}
                  <span className="time">{it.lastSeenMs ? relativeDay(it.lastSeenMs) : ''}</span>
                </div>
                {it.memo?.note ? <div className="memo-line">📝 {it.memo.note}</div> : <div className="memo-line faint">メモなし</div>}
              </div>
            </button>
          );
        })}
        {filtered.length > shown.length ? (
          <button className="btn" onClick={() => setLimit((n) => n + PAGE)}>
            さらに表示({(filtered.length - shown.length).toLocaleString('ja-JP')} 人)
          </button>
        ) : null}
      </div>
    </div>
  );
}
