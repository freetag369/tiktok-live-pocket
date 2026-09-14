import { useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './components/Header';
import { FeedList, type Tab } from './components/FeedList';
import { SettingsSheet } from './components/Settings';
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
  const [tab, setTab] = useState<Tab>('all');
  const [showSettings, setShowSettings] = useState(() => !settings.hostUniqueId || !settings.eulerApiKey);

  useEffect(() => session.subscribe(setSnap), [session]);

  useEffect(() => {
    document.documentElement.dataset.fs = settings.fontSize;
  }, [settings.fontSize]);

  useEffect(() => {
    installWakeLockRefresh();
  }, []);

  const running = snap.socket.s !== 'idle' && snap.socket.s !== 'ended' && !(snap.socket.s === 'error' && snap.socket.fatal);
  useEffect(() => {
    void setWakeLock(settings.wakeLock && running);
  }, [settings.wakeLock, running]);

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

  const f = snap.feed;
  const tabs: Array<[Tab, string, number | null]> = [
    ['all', 'すべて', null],
    ['comment', 'コメント', f.commentCount],
    ['join', '入室', f.joinCount],
    ['gift', 'ギフト', f.giftCount],
  ];

  return (
    <div className="app">
      <Header socket={snap.socket} room={snap.room} hostUniqueId={settings.hostUniqueId} diamonds={f.diamonds} demo={snap.demo} onSettings={() => setShowSettings(true)} />
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
            {n != null && n > 0 ? <span className="n">{n}</span> : null}
          </button>
        ))}
      </nav>
      <FeedList
        rows={f.rows}
        tab={tab}
        showAvatars={settings.showAvatars}
        bigGiftDiamonds={settings.bigGiftDiamonds}
        empty={
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
          )
        }
      />
      <div style={{ flex: 'none', padding: '8px 12px calc(var(--safe-bottom) + 8px)', background: 'var(--bg-1)', borderTop: '1px solid var(--line)' }}>
        <button className={`btn ${connected ? '' : 'primary'}`} style={{ margin: 0 }} disabled={!connected && !canConnect} onClick={toggleConnect}>
          {connected ? '切断' : snap.demo ? 'デモを止めて接続' : '接続'}
        </button>
      </div>
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
          knownViewers={snap.knownViewers}
          connected={connected}
          session={session}
          rowCount={f.rows.length}
        />
      ) : null}
    </div>
  );
}
