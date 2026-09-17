import { useState } from 'react';
import { DEFAULT_WS_URL, type FontSize, type Settings } from '../lib/settings';
import { wakeLockSupported } from '../lib/wake-lock';
import type { LiveSession } from '../lib/session';
import { BackupSection } from './BackupSection';

interface Props {
  value: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
  onDemo: () => void;
  onResetHistory: () => Promise<void>;
  onOpenViewers: () => void;
  knownViewers: number;
  memoCount: number;
  connected: boolean;
  session: LiveSession;
  rowCount: number;
}

export function SettingsSheet({ value, onChange, onClose, onDemo, onResetHistory, onOpenViewers, knownViewers, memoCount, connected, session, rowCount }: Props) {
  const [showKey, setShowKey] = useState(false);
  const [advanced, setAdvanced] = useState(value.wsUrl !== DEFAULT_WS_URL);
  const [confirmReset, setConfirmReset] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...value, [k]: v });

  return (
    <div className="sheet">
      <header className="header">
        <h1>設定</h1>
        <button className="iconbtn" onClick={onClose} aria-label="閉じる">
          ✕
        </button>
      </header>
      <div className="scroll">
        <div className="section">
          <h2>接続</h2>
          <div className="field">
            <label>
              配信者名
              <small>TikTok の @ の後ろ。URL を貼っても可</small>
            </label>
            <input type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="例: metafact8" value={value.hostUniqueId} onChange={(e) => set('hostUniqueId', e.target.value)} disabled={connected} />
          </div>
          <div className="field">
            <label>
              Euler Stream API キー
              <small>
                <a href="https://www.eulerstream.com/" target="_blank" rel="noreferrer">
                  eulerstream.com
                </a>{' '}
                の無料 Community アカウントで発行。PC アプリと同じキーで OK
              </small>
            </label>
            <div className="col">
              <input type={showKey ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="API キー" value={value.eulerApiKey} onChange={(e) => set('eulerApiKey', e.target.value)} disabled={connected} />
              <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-faint)' }}>
                <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} /> キーを表示
              </label>
            </div>
          </div>
          {connected ? <p className="note">接続中は変更できません。先に切断してください。</p> : null}
        </div>

        <div className="section">
          <h2>表示</h2>
          <div className="field">
            <label>アイコン画像を表示</label>
            <input className="switch" type="checkbox" checked={value.showAvatars} onChange={(e) => set('showAvatars', e.target.checked)} />
          </div>
          <div className="field">
            <label>文字サイズ</label>
            <select value={value.fontSize} onChange={(e) => set('fontSize', e.target.value as FontSize)}>
              <option value="small">小</option>
              <option value="medium">標準</option>
              <option value="large">大</option>
            </select>
          </div>
          <div className="field">
            <label>
              ギフト強調のしきい値
              <small>この💎以上のギフトを大きく表示(0 で無効)</small>
            </label>
            <input type="number" inputMode="numeric" min={0} value={value.bigGiftDiamonds} onChange={(e) => set('bigGiftDiamonds', Number(e.target.value))} />
          </div>
          <div className="field">
            <label>
              フォロー通知
              <small>フォローされたら画面の上にポップアップを出します</small>
            </label>
            <input className="switch" type="checkbox" checked={value.followPopup} onChange={(e) => set('followPopup', e.target.checked)} />
          </div>
          <div className="field">
            <label>
              画面を暗くしない
              <small>{wakeLockSupported() ? '受信中はスリープしません(iOS 16.4 以降)' : 'このブラウザでは使えません'}</small>
            </label>
            <input className="switch" type="checkbox" checked={value.wakeLock} onChange={(e) => set('wakeLock', e.target.checked)} disabled={!wakeLockSupported()} />
          </div>
        </div>

        <div className="section">
          <h2>来店履歴とメモ</h2>
          <p className="note">
            この iPhone に <b>{knownViewers.toLocaleString('ja-JP')}</b> 人分の来店回数と <b>{memoCount.toLocaleString('ja-JP')}</b> 件のリスナーメモを保存しています。ブラウザのデータを消すと失われます。
          </p>
          <button className="btn" onClick={onOpenViewers}>
            👥 リスナー一覧・メモ
          </button>
          <p className="note">来た人を最近来た順に並べます。タップしてメモ・よみがなを書くと、次の配信からその人の行に表示されます。配信中はフィードの行をタップしても書けます。</p>
          {confirmReset ? (
            <>
              <p className="err">本当に消しますか? 全員が「初見」に戻ります(メモは残ります)。</p>
              <button
                className="btn danger"
                onClick={async () => {
                  await onResetHistory();
                  setConfirmReset(false);
                }}
              >
                消去する
              </button>
              <button className="btn" onClick={() => setConfirmReset(false)}>
                やめる
              </button>
            </>
          ) : (
            <button className="btn danger" onClick={() => setConfirmReset(true)}>
              来店履歴をリセット
            </button>
          )}
        </div>

        <BackupSection session={session} settings={value} onSettings={onChange} knownViewers={knownViewers} rowCount={rowCount} />

        <div className="section">
          <h2>動作確認</h2>
          <button className="btn" onClick={onDemo}>
            ▶ デモ再生(通信なし)
          </button>
          <p className="note">見本のコメント・入室・ギフトを流して画面の見え方を確認できます。</p>
        </div>

        <div className="section">
          <h2>ホーム画面に追加</h2>
          <div className="note">
            <ol>
              <li>Safari の下の「共有」ボタン(□に↑)をタップ</li>
              <li>「ホーム画面に追加」を選ぶ</li>
              <li>追加したアイコンから起動すると全画面で使えます</li>
            </ol>
            バックグラウンドに回すと受信が止まります。戻ると自動でつなぎ直します。
          </div>
        </div>

        <div className="section">
          <h2>
            <button style={{ background: 'none', border: 'none', color: 'inherit', padding: 0, font: 'inherit' }} onClick={() => setAdvanced((a) => !a)}>
              {advanced ? '▾' : '▸'} 詳細
            </button>
          </h2>
          {advanced ? (
            <div className="field">
              <label>
                接続先 WebSocket
                <small>通常は変更不要。LAN のモックサーバーで試すときだけ</small>
              </label>
              <input type="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value.wsUrl} onChange={(e) => set('wsUrl', e.target.value)} disabled={connected} />
            </div>
          ) : null}
        </div>
        <p className="note" style={{ textAlign: 'center', color: 'var(--fg-faint)' }}>
          TikTok LIVE ポケット v{__APP_VERSION__} · AGPL-3.0
        </p>
      </div>
    </div>
  );
}
