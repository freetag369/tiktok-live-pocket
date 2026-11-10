import { useEffect, useState } from 'react';
import { lastJoined, lastJoinedShort } from '../lib/format';
import { REGULAR_POPUP_MS, type RegularQueue } from '../lib/regular-popup';
import { Avatar } from './Avatar';

interface Props {
  queue: RegularQueue;
  showAvatars: boolean;
  /** 今の 1 人を閉じ終えた(次の人へ進める)。 */
  onDone: () => void;
}

const LEAVE_MS = 220;

/**
 * 常連さんの入室ポップアップ。画面上部(配信者名・タブ・先頭の行の上)に重ねて出す。
 * 前回のメモ(前回・📝)と前回入室日を読めるよう、フォロー通知より大きく長めに出す。タップで閉じて次の人へ。
 */
export function RegularToast({ queue, showAvatars, onDone }: Props) {
  const [leaving, setLeaving] = useState(false);
  const p = queue.current;

  useEffect(() => {
    setLeaving(false);
    const t = setTimeout(() => setLeaving(true), Math.max(0, queue.untilMs - Date.now()));
    return () => clearTimeout(t);
  }, [p.id, queue.untilMs]);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onDone, LEAVE_MS);
    return () => clearTimeout(t);
  }, [leaving, onDone]);

  return (
    <div key={p.id} className={`regular-toast${p.favorite ? ' fav' : ''}${leaving ? ' leaving' : ''}`} role="status" aria-live="polite" onClick={() => setLeaving(true)}>
      <Avatar url={p.avatarUrl} name={p.name} enabled={showAvatars} />
      <div className="body">
        {/* 1 行目: ★回数・名前(呼び方)・前回入室日。2 行目から前回(2 行まで)・📝(1 行) */}
        <div className="name">
          <span className="badge visits regular">★{p.visits}回目</span>
          {p.gifterLevel ? <span className="badge grade">Lv.{p.gifterLevel}</span> : null}
          <span className="who">{p.name}</span>
          {p.kana ? <span className="kana">({p.kana})</span> : null}
          <span className="last-joined" title={`前回入室：${lastJoined(p.previousJoinedMs)}`}>
            前回 {lastJoinedShort(p.previousJoinedMs)}
          </span>
          {queue.waiting.length > 0 ? <span className="more">+{queue.waiting.length}</span> : null}
        </div>
        {p.previousNote ? <div className="memo prev">前回：{p.previousNote}</div> : null}
        {p.note ? <div className="memo note">📝 {p.note}</div> : null}
      </div>
      {/* 残り時間の細い線(表示時間は毎回 REGULAR_POPUP_MS から数える) */}
      <div className="timer" style={{ animationDuration: `${REGULAR_POPUP_MS}ms` }} />
    </div>
  );
}
