import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './components/Header';
import { FeedList, type ScreenTab } from './components/FeedList';
import { LikeRanking } from './components/LikeRanking';
import { LikeToasts } from './components/LikeToasts';
import { SettingsSheet } from './components/Settings';
import { MemoSheet, type MemoTarget } from './components/MemoSheet';
import { ViewersSheet } from './components/ViewersSheet';
import { countDataRows, type FeedRow } from './lib/feed';
import { FollowToast } from './components/FollowToast';
import { followerName, pushFollow, type FollowToast as FollowToastState } from './lib/follow-toast';
import { ArchiveSheet } from './components/Archive';
import { compact } from './lib/format';
import { LiveSession, type SessionSnapshot } from './lib/session';
import { loadSettings, sanitize, saveSettings, type Settings } from './lib/settings';
import { installWakeLockRefresh, setWakeLock } from './lib/wake-lock';
import demoText from './fixtures/demo.ndjson?raw';

function parseDemo(text: string): Array<{ o: number; type?: string; data?: unknown }> {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { o: number; type?: string; data?: unknown });
}

export function App() {
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const session = useMemo(() => new LiveSession(() => settingsRef.current), []);

  const [snap, setSnap] = useState<SessionSnapshot>(() => session.snapshot());
  const [tab, setTab] = useState<ScreenTab>('all');
  const [showSettings, setShowSettings] = useState(() => !settings.hostUniqueId || !settings.eulerApiKey);
  const [showViewers, setShowViewers] = useState(false);
  const [memoTarget, setMemoTarget] = useState<MemoTarget | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => session.subscribe(setSnap), [session]);

  const [toast, setToast] = useState<FollowToastState | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  useEffect(
    () =>
      session.onFollow((n) => {
        if (!settingsRef.current.followPopup) return;
        setToast((cur) => pushFollow(cur, { name: followerName(n.viewer), avatarUrl: n.viewer.avatarUrl, firstEver: n.firstEver }, Date.now()));
      }),
    [session]
  );

  useEffect(() => {
    document.documentElement.dataset.fs = settings.fontSize;
  }, [settings.fontSize]);

  // 確認バナーはタブを切り替えるか 10 秒で引っ込める(押しっぱなしにしない)。
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 10_000);
    return () => clearTimeout(t);
  }, [confirmClear, tab]);
  useEffect(() => setConfirmClear(false), [tab]);

  useEffect(() => {
    installWakeLockRefresh();
  }, []);

  const running = snap.socket.s !== 'idle' && snap.socket.s !== 'ended' && !(snap.socket.s === 'error' && snap.socket.fatal);
  useEffect(() => {
    void setWakeLock(settings.wakeLock && running);
  }, [settings.wakeLock, running]);
  useEffect(() => {
    if (!running) setToast(null);
  }, [running]);

  const updateSettings = (next: Settings) => {
    setSettingsState(next);
    saveSettings(next);
  };

  const canConnect = Boolean(settings.hostUniqueId && settings.eulerApiKey);
  const connected = session.connected;

  const toggleConnect = () => {
    if (connected) session.disconnect();
    else {
      const clean = sanitize(settings);
      if (clean.hostUniqueId !== settings.hostUniqueId || clean.eulerApiKey !== settings.eulerApiKey) updateSettings(clean);
      session.connect();
    }
  };

  // 行タップ → その人のメモを書く。FeedRowView は memo() 済みなので、参照が安定するよう useCallback。
  const onTapRow = useCallback((row: FeedRow) => {
    const v = row.viewer;
    setMemoTarget({ userId: v.userId, nickname: v.nickname, uniqueId: v.uniqueId, avatarUrl: v.avatarUrl, visits: row.visits, firstEver: row.firstEver });
  }, []);

  // リスナー一覧はシートを開いている間だけ組み立てる(メモ・来店履歴が変わったら作り直す)。
  const viewerItems = useMemo(() => (showViewers ? session.viewersForList() : []), [showViewers, session, snap.memos, snap.knownViewers]);

  const f = snap.feed;
  const hasRows = f.rows.some((r) => r.k !== 'room');
  const tabs: Array<[ScreenTab, string, number | null]> = [
    ['all', 'すべて', null],
    ['comment', 'コメント', f.commentCount],
    ['join', '入室', f.joinCount],
    ['gift', 'ギフト', f.giftCount],
    ['like', 'いいね', f.likeCount],
  ];
  const emptyText =
    connected || snap.demo ? (
      <>
        まだ何も届いていません。
        <br />
        配信が始まると、ここにコメント・入室・ギフトが流れます。
      </>
    ) : canConnect ? (
      <>
        下の <b>接続</b> を押すと受信を始めます。
      </>
    ) : (
      <>
        右上の ⚙️ から <b>配信者名</b> と <b>API キー</b> を設定してください。
      </>
    );

  return (
    <div className="app">
      <Header socket={snap.socket} room={snap.room} hostUniqueId={settings.hostUniqueId} diamonds={f.diamonds} demo={snap.demo} onSettings={() => setShowSettings(true)} onArchive={() => setShowArchive(true)} />
      {toast && settings.followPopup ? <FollowToast toast={toast} showAvatars={settings.showAvatars} onDone={dismissToast} /> : null}
      {snap.socket.s === 'error' ? (
        <div className="banner">
          <span>{snap.socket.message}</span>
          <button onClick={() => (snap.socket.s === 'error' && snap.socket.fatal ? setShowSettings(true) : session.connect())}>{snap.socket.s === 'error' && snap.socket.fatal ? '設定' : '再接続'}</button>
        </div>
      ) : snap.socket.s === 'ended' ? (
        <div className="banner warn">
          <span>{snap.socket.reason}</span>
          <button onClick={() => session.connect()}>再接続</button>
        </div>
      ) : null}
      <nav className="tabs">
        {tabs.map(([k, label, n]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
            {n != null && n > 0 ? <span className="n">{compact(n)}</span> : null}
          </button>
        ))}
        <button className="tab-reset" aria-label="画面の履歴をリセット" disabled={!hasRows} onClick={() => setConfirmClear((c) => !c)}>
          🧹
        </button>
      </nav>
      {confirmClear ? (
        <div className="banner warn">
          <span>画面の行を消しますか?(🗂 と 💎 は残ります)</span>
          <button
            onClick={() => {
              session.resetScreen();
              setConfirmClear(false);
            }}
          >
            消す
          </button>
          <button onClick={() => setConfirmClear(false)}>やめる</button>
        </div>
      ) : null}
      {tab === 'like' ? (
        <LikeRanking
          likes={f.likes}
          likeCount={f.likeCount}
          likeRoomTotal={f.likeRoomTotal}
          showAvatars={settings.showAvatars}
          empty={connected || snap.demo ? <>まだいいねが届いていません。</> : emptyText}
        />
      ) : (
        <div className="feed-wrap">
          <FeedList
            key={`${tab}:${snap.screenEpoch}`}
            rows={f.rows}
            tab={tab}
            showAvatars={settings.showAvatars}
            bigGiftDiamonds={settings.bigGiftDiamonds}
            memos={snap.memos}
            onTapRow={onTapRow}
            empty={emptyText}
          />
          {settings.likePopup ? <LikeToasts likes={f.likes} likeCount={f.likeCount} showAvatars={settings.showAvatars} /> : null}
        </div>
      )}
      <div style={{ flex: 'none', padding: '8px 12px calc(var(--safe-bottom) + 8px)', background: 'var(--bg-1)', borderTop: '1px solid var(--line)' }}>
        <button className={`btn ${connected ? '' : 'primary'}`} style={{ margin: 0 }} disabled={!connected && !canConnect} onClick={toggleConnect}>
          {connected ? '切断' : snap.demo ? 'デモを止めて接続' : '接続'}
        </button>
      </div>
      {showArchive ? <ArchiveSheet session={session} settings={settings} currentRoomId={snap.demo ? '' : snap.room.roomId} onClose={() => setShowArchive(false)} /> : null}
      {showSettings ? (
        <SettingsSheet
          value={settings}
          onChange={updateSettings}
          onClose={() => setShowSettings(false)}
          onDemo={() => {
            session.playDemo(parseDemo(demoText));
            setShowSettings(false);
            setTab('all');
          }}
          onResetHistory={() => session.resetHistory()}
          onOpenViewers={() => setShowViewers(true)}
          knownViewers={snap.knownViewers}
          memoCount={session.memoCount}
          connected={connected}
          session={session}
          rowCount={countDataRows(f.rows)}
        />
      ) : null}
      {showViewers ? (
        <ViewersSheet
          items={viewerItems}
          showAvatars={settings.showAvatars}
          onPick={(it) => setMemoTarget({ userId: it.userId, nickname: it.nickname ?? it.memo?.nickname, uniqueId: it.uniqueId ?? it.memo?.uniqueId, avatarUrl: it.avatarUrl, visits: it.visits > 0 ? it.visits : undefined })}
          onClose={() => setShowViewers(false)}
        />
      ) : null}
      {memoTarget ? (
        <MemoSheet
          key={memoTarget.userId}
          target={memoTarget}
          current={snap.memos.get(memoTarget.userId)}
          showAvatars={settings.showAvatars}
          onSave={(patch) => session.setMemo(memoTarget.userId, patch)}
          onClose={() => setMemoTarget(null)}
        />
      ) : null}
    </div>
  );
}
