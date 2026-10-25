import { useEffect, useRef, useState } from 'react';
import { lastJoined } from '../lib/format';
import { hasMemoContent, KANA_MAX_LEN, MEMO_MAX_LEN, type MemoPatch, type MemoRecord } from '../lib/memos';
import { displayName } from '../lib/names';
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
  target: MemoTarget;
  current?: MemoRecord;
  showAvatars: boolean;
  onSave: (patch: MemoPatch) => void;
  /** ★ を押したとき。メモの保存とは別に、押した時点ですぐ反映する。 */
  onFavorite: (on: boolean) => void;
  onClose: () => void;
  /** メモ欄の下に出すもの(ハイライトのその日の履歴)。 */
  history?: React.ReactNode;
  /** 開いたらメモ欄にカーソルを置く(既定 true)。履歴を見に来たときはキーボードで隠さない。 */
  autoFocus?: boolean;
  /** 「前回入室：」を名前の下に出す(フィードでは入室の行にしか出さないので、タップしたらここで分かるようにする)。 */
  showPreviousJoined?: boolean;
  previousJoinedMs?: number;
}

/**
 * メモ編集のボトムシート。配信中に片手で書けるよう、画面下から出して メモ・前回・よみがなを入力する。
 * 保存したメモは次回以降の配信でも残り、その人の行(入室・コメント・ギフト)に表示される。
 * 上の ★ でお気に入りにすると、その人の行の背景が青になる(★ は押した時点で保存。メモの削除では外れない)。
 */
export function MemoSheet({ target, current, showAvatars, onSave, onFavorite, onClose, history, autoFocus = true, showPreviousJoined, previousJoinedMs }: Props) {
  const [note, setNote] = useState(current?.note ?? '');
  const [previousNote, setPreviousNote] = useState(current?.previousNote ?? '');
  const [kana, setKana] = useState(current?.kana ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const name = displayName(target, current);
  const handle = target.uniqueId || current?.uniqueId;
  const has = hasMemoContent(current);
  const fav = Boolean(current?.favorite);

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => ref.current?.focus(), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    onSave({ note, previousNote, kana, nickname: target.nickname || current?.nickname, uniqueId: target.uniqueId || current?.uniqueId });
    onClose();
  };
  const remove = () => {
    onSave({ note: '', previousNote: '', kana: '' });
    onClose();
  };
  const unchanged = previousNote.trim() === (current?.previousNote ?? '') && note.trim() === (current?.note ?? '') && kana.trim() === (current?.kana ?? '');

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
            {target.visits != null || showPreviousJoined ? (
              <div className="msheet-sub">
                {target.visits != null ? <VisitBadge visits={target.visits} firstEver={Boolean(target.firstEver)} /> : null}
                {showPreviousJoined ? <span className="last-joined">前回入室：{lastJoined(previousJoinedMs)}</span> : null}
              </div>
            ) : null}
          </div>
          <button className={`favbtn${fav ? ' on' : ''}`} aria-pressed={fav} onClick={() => onFavorite(!fav)}>
            {fav ? '★' : '☆'} お気に入り
          </button>
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
          前回
          <span className="cnt">{previousNote.length}/{MEMO_MAX_LEN}</span>
        </label>
        <textarea
          aria-label="前回"
          rows={3}
          maxLength={MEMO_MAX_LEN}
          value={previousNote}
          placeholder="例: バラのお礼を伝える / 前回は旅行の話をした"
          onChange={(e) => setPreviousNote(e.target.value)}
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
          次回以降の配信でも残り、この人の各一覧の行に表示されます。
        </p>
        {history}
      </div>
    </>
  );
}
