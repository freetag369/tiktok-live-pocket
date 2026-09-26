import { useEffect, useRef, useState } from 'react';
import { KANA_MAX_LEN, MEMO_MAX_LEN, type MemoPatch, type MemoRecord } from '../lib/memos';
import { Avatar } from './Avatar';
import { VisitBadge } from './Badges';

/** メモを書く相手。フィードの行またはリスナー一覧から渡す。 */
export interface MemoTarget {
  userId: string;
  nickname?: string;
  uniqueId?: string;
  avatarUrl?: string;
  visits?: number;
  firstEver?: boolean;
}

interface Props {
  history?: React.ReactNode;
  target: MemoTarget;
  current?: MemoRecord;
  showAvatars: boolean;
  onSave: (patch: MemoPatch) => void;
  onClose: () => void;
}

/**
 * メモ編集のボトムシート。配信中に片手で書けるよう、画面下から出して 2 欄だけにする。
 * 保存したメモは次回以降の配信でも残り、その人の行(入室・コメント・ギフト)に表示される。
 */
export function MemoSheet({ target, current, showAvatars, onSave, onClose, history }: Props) {
  const [note, setNote] = useState(current?.note ?? '');
  const [kana, setKana] = useState(current?.kana ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const name = target.nickname || current?.nickname || target.uniqueId || current?.uniqueId || target.userId;
  const handle = target.uniqueId || current?.uniqueId;
  const has = Boolean(current);

  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const save = () => {
    onSave({ note, kana, nickname: target.nickname || current?.nickname, uniqueId: target.uniqueId || current?.uniqueId });
    onClose();
  };
  const remove = () => {
    onSave({ note: '', kana: '' });
    onClose();
  };
  const unchanged = note.trim() === (current?.note ?? '') && kana.trim() === (current?.kana ?? '');

  return (
    <>
      <div className="msheet-scrim" onClick={onClose} />
      <div className="msheet" role="dialog" aria-label="リスナーメモ">
        <div className="msheet-head">
          <Avatar url={target.avatarUrl} name={name} enabled={showAvatars} />
          <div className="msheet-who">
            <div className="row-name">
              <span className="who">{name}</span>
              {handle && handle !== name ? <span className="handle">@{handle}</span> : null}
            </div>
            {target.visits != null ? (
              <div className="msheet-sub">
                <VisitBadge visits={target.visits} firstEver={Boolean(target.firstEver)} />
              </div>
            ) : null}
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <label className="msheet-label">
          メモ
          <span className="cnt">
            {note.length}/{MEMO_MAX_LEN}
          </span>
        </label>
        <textarea
          ref={ref}
          rows={4}
          maxLength={MEMO_MAX_LEN}
          value={note}
          placeholder="例: 誕生日 3/4 / ゲームの話が好き / 名前は「たろう」"
          onChange={(e) => setNote(e.target.value)}
        />
        <label className="msheet-label">
          よみがな
          <small>名前を呼ぶとき用。名前の横に(かな)で出ます</small>
        </label>
        <input type="text" maxLength={KANA_MAX_LEN} value={kana} placeholder="例: たろう" autoCapitalize="none" autoCorrect="off" onChange={(e) => setKana(e.target.value)} />
        <div className="msheet-actions">
          <button className="btn primary" disabled={unchanged && has} onClick={save}>
            保存
          </button>
          {has ? (
            <button className="btn danger" onClick={remove}>
              削除
            </button>
          ) : null}
          <button className="btn" onClick={onClose}>
            キャンセル
          </button>
        </div>
        <p className="note" style={{ margin: '4px 0 0' }}>
          次回以降の配信でも残り、この人の入室・コメント・ギフトの行に表示されます。
        </p>
        {history}
      </div>
    </>
  );
}
