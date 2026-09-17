import { useEffect, useMemo, useState } from 'react';
import { filterArchiveRows, streamFileStem, streamHost, type StreamRecord } from '../lib/archive';
import { feedToCsv, feedToJson } from '../lib/backup';
import type { FeedRow, Tab } from '../lib/feed';
import { dateRange, num } from '../lib/format';
import { saveTextFile } from '../lib/save-file';
import type { LiveSession } from '../lib/session';
import type { Settings } from '../lib/settings';
import { FeedRowView } from './FeedRow';

/**
 * アーカイブ画面。配信の一覧 → 1 配信の全行(タブ・検索)。
 * 行の描画は本画面と同じ FeedRowView を使い回す。
 */

interface Props {
  session: LiveSession;
  settings: Settings;
  /** 受信中の roomId(「受信中」バッジ用)。デモ中は空。 */
  currentRoomId: string;
  onClose: () => void;
}

const PAGE = 300;

export function ArchiveSheet({ session, settings, currentRoomId, onClose }: Props) {
  const [streams, setStreams] = useState<StreamRecord[] | null>(null);
  const [open, setOpen] = useState<StreamRecord | null>(null);

  const reload = async () => setStreams(await session.listArchive());
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (open) {
    return (
      <StreamView
        session={session}
        settings={settings}
        stream={open}
        live={open.roomId === currentRoomId}
        onBack={() => {
          setOpen(null);
          void reload();
        }}
      />
    );
  }

  const fallbackHost = settings.hostUniqueId ? `@${settings.hostUniqueId}` : '';

  return (
    <div className="sheet">
      <header className="header">
        <h1>アーカイブ</h1>
        <button className="iconbtn" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
      </header>
      <div className="scroll">
        {streams == null ? (
          <p className="note">読み込み中…</p>
        ) : streams.length === 0 ? (
          <div className="empty">
            まだアーカイブはありません。
            <br />
            接続して受信すると、配信ごとにここに残ります。
          </div>
        ) : (
          streams.map((s) => (
            <button key={s.roomId} className="stream" onClick={() => setOpen(s)}>
              <div className="when">
                {dateRange(s.startedMs, s.endedMs)}
                {s.roomId === currentRoomId ? <span className="badge live">受信中</span> : null}
              </div>
              <div className="host">{streamHost(s, fallbackHost)}</div>
              <div className="counts">
                <span>
                  💬<b>{num(s.comments)}</b>
                </span>
                <span>
                  🚪<b>{num(s.joins)}</b>
                </span>
                <span>
                  🎁<b>{num(s.gifts)}</b>
                </span>
                <span className="dia">
                  💎<b>{num(s.diamonds)}</b>
                </span>
              </div>
            </button>
          ))
        )}
        {streams && streams.length > 0 ? (
          <p className="note" style={{ color: 'var(--fg-faint)' }}>
            {settings.archiveEnabled ? `新しい ${settings.archiveKeepStreams} 配信まで残し、古い配信から自動で消えます(設定で変更できます)。` : 'アーカイブの保存は設定で OFF になっています。'}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const TABS: Array<[Tab, string]> = [
  ['all', 'すべて'],
  ['comment', 'コメント'],
  ['join', '入室'],
  ['gift', 'ギフト'],
];

interface StreamProps {
  session: LiveSession;
  settings: Settings;
  stream: StreamRecord;
  live: boolean;
  onBack: () => void;
}

function StreamView({ session, settings, stream, live, onBack }: StreamProps) {
  const [rows, setRows] = useState<FeedRow[] | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => setRows(await session.loadArchivedStream(stream.roomId));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, stream.roomId]);

  const filtered = useMemo(() => filterArchiveRows(rows ?? [], tab, query), [rows, tab, query]);
  const shown = filtered.slice(0, limit);
  const counts = useMemo(() => {
    const all = rows ?? [];
    return {
      all: all.length,
      comment: all.filter((r) => r.k === 'comment').length,
      // 本画面のタブと同じく、数は入室だけ(フォロー・シェアの行は入室タブに出るが数えない)
      join: all.filter((r) => r.k === 'join').length,
      gift: all.filter((r) => r.k === 'gift').length,
    };
  }, [rows]);

  const exportLog = async (fmt: 'csv' | 'json') => {
    if (!rows || rows.length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const name = `${streamFileStem(stream, settings.hostUniqueId)}.${fmt}`;
      const r =
        fmt === 'csv'
          ? await saveTextFile(name, feedToCsv(rows), 'text/csv;charset=utf-8')
          : await saveTextFile(name, feedToJson(rows, { roomId: stream.roomId, host: stream.hostUniqueId ?? settings.hostUniqueId }), 'application/json');
      if (r !== 'cancelled') setMsg(`${rows.length} 行を書き出しました`);
    } catch (e) {
      setMsg(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    await session.deleteArchivedStream(stream.roomId);
    setBusy(false);
    onBack();
  };

  const title = dateRange(stream.startedMs, stream.endedMs);
  const host = streamHost(stream, settings.hostUniqueId ? `@${settings.hostUniqueId}` : '');
  const canExport = !busy && rows != null && rows.length > 0;

  return (
    <div className="sheet">
      <header className="header">
        <button className="iconbtn" onClick={onBack} aria-label="戻る">
          ‹
        </button>
        <div className="status">
          <div className="txt">
            <span className="host">{title}</span>
            <span className="sub">
              {host}
              {live ? ' · 受信中' : ''}
            </span>
          </div>
        </div>
        {live ? (
          <button className="iconbtn" onClick={() => void load()} aria-label="最新に更新">
            ↻
          </button>
        ) : null}
      </header>
      <nav className="tabs">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            className={tab === k ? 'on' : ''}
            onClick={() => {
              setTab(k);
              setLimit(PAGE);
            }}
          >
            {label}
            {counts[k] > 0 ? <span className="n">{counts[k]}</span> : null}
          </button>
        ))}
      </nav>
      <div className="search">
        <input
          type="search"
          placeholder="名前・コメント・ギフト名で絞り込み"
          autoCapitalize="none"
          autoCorrect="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
        />
      </div>
      <div className="feed archive">
        <div className="feed-inner">
          {rows == null ? (
            <div className="empty">読み込み中…</div>
          ) : filtered.length === 0 ? (
            <div className="empty">{query ? '一致する行がありません。' : 'この種類の行はありません。'}</div>
          ) : (
            shown.map((r) => <FeedRowView key={r.id} row={r} showAvatars={settings.showAvatars} bigGiftDiamonds={settings.bigGiftDiamonds} />)
          )}
          {filtered.length > shown.length ? (
            <button className="btn more" onClick={() => setLimit((n) => n + PAGE)}>
              さらに {Math.min(PAGE, filtered.length - shown.length)} 件を表示(残り {num(filtered.length - shown.length)} 件)
            </button>
          ) : null}
        </div>
      </div>
      {msg ? (
        <p className="note" style={{ margin: 0, padding: '4px 12px', color: 'var(--green)' }}>
          {msg}
        </p>
      ) : null}
      {confirmDelete ? (
        <div className="archive-actions">
          <button className="btn danger" disabled={busy} onClick={() => void remove()}>
            この配信を削除する
          </button>
          <button className="btn" onClick={() => setConfirmDelete(false)}>
            やめる
          </button>
        </div>
      ) : (
        <div className="archive-actions">
          <button className="btn" disabled={!canExport} onClick={() => void exportLog('csv')}>
            📄 CSV
          </button>
          <button className="btn" disabled={!canExport} onClick={() => void exportLog('json')}>
            🧾 JSON
          </button>
          <button className="btn danger" disabled={busy || live} onClick={() => setConfirmDelete(true)} title={live ? '受信中の配信は消せません' : undefined}>
            🗑 削除
          </button>
        </div>
      )}
    </div>
  );
}
