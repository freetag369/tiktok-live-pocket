import { useEffect, useMemo, useState } from 'react';
import { MemoLines } from './MemoLines';
import type { ArchivedRow } from '../lib/archive';
import { num } from '../lib/format';
import { japaneseGiftName } from '../lib/gift-names';
import { actionKey, highlightMembers, japanDay, japanDayLabel, japanTime, pickHighlightDay, watchJapanDay } from '../lib/highlights';
import type { MemoRecord } from '../lib/memos';
import { displayName, handleOf } from '../lib/names';
import { HIGHLIGHT_MEMORY_MAX, type LiveSession } from '../lib/session';
import { Avatar } from './Avatar';
import { MemoSheet, type MemoTarget } from './MemoSheet';

/**
 * ハイライト。日付(日本時間)を選ぶと、その日にコメント・いいね・フォロー・ギフトをした人を
 * 最後にアクションした順に並べる(同じ日の配信はまとめる)。押すとメモの下にその日の履歴が出る。
 *
 * 保存済みの行(IndexedDB)は日付を変えたときと、アーカイブを書き換えたとき(取り込み・削除・全消去)だけ読む
 * (タブを行き来しただけなら、セッションが取っておいた 1 日分を使う)。
 * 受信中の行はセッションがその場で重ねるので、描き直しは 1 秒に 1 回まで。
 */

interface Props {
  session: LiveSession;
  /** アーカイブを受信以外で書き換えた回数(SessionSnapshot.archiveGeneration)。変わったら読み直す。 */
  generation: number;
  /** デモ再生中。デモの行だけを出し、終わったら本物に戻す。 */
  demo: boolean;
  /** ハイライト用のメモ(SessionSnapshot.highlightMemos)。行と同じく、デモ再生中だけデモの帳。 */
  memos: ReadonlyMap<string, MemoRecord>;
  /** 自分で選んだ日。null なら今日(0 時を過ぎたら次の日へ付いていく)。タブを切り替えても残るよう App が持つ。 */
  picked: string | null;
  onPick: (day: string | null) => void;
  showAvatars: boolean;
  archiveEnabled: boolean;
}

/** 一度に出す人数・履歴の件数。 */
const PAGE = 100;
/** 受信が続いても、一覧の描き直しはこの間隔より詰めない。 */
const HIGHLIGHT_REFRESH_MS = 1000;

const EMPTY: ArchivedRow[] = [];

interface Shown {
  /** どの日・どの読み込みの行か(切り替えた直後に前の日の行を出さない)。 */
  key: string;
  rows: ArchivedRow[];
  failed: boolean;
}

/** 日本時間の「今日」。0 時をまたいだら変わる。 */
function useJapanToday(): string {
  const [today, setToday] = useState(() => japanDay());
  useEffect(() => watchJapanDay(setToday), []);
  return today;
}

export function Highlights({ session, generation, demo, memos, picked, onPick, showAvatars, archiveEnabled }: Props) {
  const today = useJapanToday();
  const day = picked ?? today;
  const key = `${day}|${generation}|${demo ? 'demo' : 'live'}`;
  const [shown, setShown] = useState<Shown>({ key: '', rows: EMPTY, failed: false });
  const [limit, setLimit] = useState(PAGE);
  const [target, setTarget] = useState<MemoTarget | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    const stop = session.watchHighlightDay(day, (view) => {
      if (timer) return;
      // 最初は すぐ、そのあとは前の描き直しから HIGHLIGHT_REFRESH_MS 空ける。
      timer = setTimeout(
        () => {
          timer = null;
          last = Date.now();
          setShown({ key, rows: view.list(), failed: view.failed });
        },
        Math.max(0, last + HIGHLIGHT_REFRESH_MS - Date.now())
      );
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [session, day, key]);

  // デモの出入りで行が本物⇔見本に入れ替わるので、開いていたメモは閉じる(別の人の履歴を出さない)。
  useEffect(() => setTarget(null), [demo]);

  const ready = shown.key === key;
  const rows = ready ? shown.rows : EMPTY;
  const members = useMemo(() => highlightMembers(rows), [rows]);
  const history = useMemo(() => (target ? rows.filter((r) => r.viewer.userId === target.userId) : EMPTY), [rows, target]);

  const choose = (next: string | null) => {
    if (next === picked) return;
    onPick(next);
    setLimit(PAGE);
    setTarget(null);
  };

  return (
    <div className="hl">
      <div className="hl-tools">
        <label className="hl-date">
          日付
          <input type="date" aria-label="ハイライトの日付" value={day} max={today} onChange={(e) => choose(pickHighlightDay(e.target.value, today, picked))} />
        </label>
        {picked ? (
          <button className="hl-today" onClick={() => choose(null)}>
            今日へ
          </button>
        ) : null}
        <span className="hl-sum">{ready ? `${num(members.length)} 人` : ''} · 日本時間</span>
      </div>
      {demo ? (
        <div className="hl-demo" role="status">
          <b>デモ</b> 再生中の見本です(保存されません)。デモが終わると本物の履歴に戻ります。
        </div>
      ) : null}
      {!demo && !archiveEnabled ? (
        <p className="note hl-note">アーカイブの保存が OFF です。この間の記録はメモリにだけ置き、アプリを閉じると消えます(新しい {num(HIGHLIGHT_MEMORY_MAX)} 件まで。いいねは 1 人 1 分で 1 件)。</p>
      ) : null}
      {!demo && session.highlightMemoryTrimmed ? <p className="note hl-note">メモリの上限を超えたので、保存していない古い記録の一部を消しました。</p> : null}
      {ready && shown.failed ? <p className="note hl-note">保存済みの履歴を読み込めませんでした。受信中の記録だけを表示しています。</p> : null}
      <div className="hl-list">
        {!ready ? (
          <div className="empty">読み込み中…</div>
        ) : members.length === 0 ? (
          <div className="empty">
            {japanDayLabel(day)} のコメント・いいね・フォロー・ギフトはまだありません。
          </div>
        ) : (
          members.slice(0, limit).map(({ row, comments, likes, follows, gifts }) => {
            const v = row.viewer;
            const memo = memos.get(v.userId);
            const name = displayName(v, memo);
            const handle = handleOf(v, name);
            return (
              <button
                key={v.userId}
                className={`vrow hl-row${memo?.note || memo?.previousNote ? ' has-memo' : ''}${memo?.favorite ? ' fav' : ''}`}
                onClick={() => setTarget({ userId: v.userId, nickname: v.nickname, uniqueId: v.uniqueId, avatarUrl: v.avatarUrl, visits: row.visits, firstEver: row.firstEver })}
              >
                <Avatar url={v.avatarUrl} name={name} enabled={showAvatars} />
                <div className="body">
                  <div className="head">
                    <span className="who">{name}</span>
                    {memo?.kana ? <span className="kana">({memo.kana})</span> : null}
                    {handle ? <span className="handle">{handle}</span> : null}
                    <span className="time">{japanTime(row.tsMs).slice(0, 5)}</span>
                  </div>
                  <div className="hl-counts">
                    {comments ? <span>💬 {num(comments)}</span> : null}
                    {likes ? <span>❤️ {num(likes)}</span> : null}
                    {follows ? <span>➕ フォロー</span> : null}
                    {gifts ? <span>🎁 {num(gifts)}</span> : null}
                  </div>
                  <MemoLines note={memo?.note} previousNote={memo?.previousNote} />
                </div>
              </button>
            );
          })
        )}
        {members.length > limit ? (
          <button className="btn more" onClick={() => setLimit((n) => n + PAGE)}>
            さらに {num(Math.min(PAGE, members.length - limit))} 人を表示(残り {num(members.length - limit)} 人)
          </button>
        ) : null}
      </div>
      {target ? (
        <MemoSheet
          key={target.userId}
          target={target}
          current={memos.get(target.userId)}
          showAvatars={showAvatars}
          autoFocus={false}
          showPreviousJoined
          previousJoinedMs={session.previousJoinedFor(target.userId)}
          onSave={(patch) => session.setMemo(target.userId, patch, Date.now(), { real: !demo })}
          onFavorite={(favorite) => session.setMemo(target.userId, { favorite, nickname: target.nickname, uniqueId: target.uniqueId }, Date.now(), { real: !demo })}
          onClose={() => setTarget(null)}
          history={<ActionHistory day={day} rows={history} />}
        />
      ) : null}
    </div>
  );
}

function describe(r: ArchivedRow): string {
  switch (r.k) {
    case 'comment':
      return `💬 ${r.text}`;
    case 'like':
      return `❤️ いいね ×${num(r.count)}`;
    case 'gift':
      return `🎁 ${japaneseGiftName(r.giftName, r.giftId)} ×${num(r.count)}(${num(r.diamonds)}💎)`;
    case 'social':
      return r.sub === 'follow' ? '➕ フォローしました' : '';
    default:
      return '';
  }
}

/** その人のその日の履歴(新しい順・日本時間)。 */
export function ActionHistory({ day, rows }: { day: string; rows: ArchivedRow[] }) {
  const [limit, setLimit] = useState(PAGE);
  return (
    <section className="hl-history" aria-label="この日の履歴">
      <h2>
        {japanDayLabel(day)} の履歴 <small>日本時間</small>
      </h2>
      {rows.length === 0 ? <p className="note">この日のアクションはありません。</p> : null}
      {rows.slice(0, limit).map((r) => (
        <div className="hl-entry" key={actionKey(r)}>
          <time>{japanTime(r.tsMs)}</time>
          <span>{describe(r)}</span>
        </div>
      ))}
      {rows.length > limit ? (
        <button className="btn more" onClick={() => setLimit((n) => n + PAGE)}>
          さらに表示(残り {num(rows.length - limit)} 件)
        </button>
      ) : null}
    </section>
  );
}
