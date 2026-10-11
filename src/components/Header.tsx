import { useEffect, useState } from 'react';
import type { SocketState } from '../lib/euler-socket';
import type { RoomState } from '../lib/session';
import { compact, num, secondsUntil } from '../lib/format';

interface Props {
  socket: SocketState;
  room: RoomState;
  hostUniqueId: string;
  diamonds: number;
  demo: boolean;
  /** 接続中(押すと切断)。 */
  connected: boolean;
  /** 配信者名と API キーが揃っている(揃うまで「接続」は押せない)。 */
  canConnect: boolean;
  onToggleConnect: () => void;
  onSettings: () => void;
  onArchive: () => void;
}

function statusText(s: SocketState, room: RoomState, now: number, demo: boolean): string {
  if (demo) return 'デモ再生中';
  switch (s.s) {
    case 'idle':
      return '未接続';
    case 'connecting':
      return s.attempt > 1 ? `接続中… (${s.attempt}回目)` : '接続中…';
    case 'live':
      return room.control === 'paused' ? '配信一時停止中' : room.control === 'ended' ? '配信終了' : '受信中';
    case 'waitingLive':
      return `配信待ち · ${secondsUntil(s.nextTryMs, now)}秒後に再確認`;
    case 'reconnecting':
      return `${s.reason} · ${secondsUntil(s.nextTryMs, now)}秒後に再接続`;
    case 'ended':
      return s.reason;
    case 'error':
      return s.message;
  }
}

export function Header({ socket, room, hostUniqueId, diamonds, demo, connected, canConnect, onToggleConnect, onSettings, onArchive }: Props) {
  const [now, setNow] = useState(Date.now());
  const ticking = socket.s === 'waitingLive' || socket.s === 'reconnecting';
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  const host = room.hostNickname || (hostUniqueId ? `@${hostUniqueId}` : 'TikTok LIVE ポケット');
  return (
    <header className="header">
      <div className="status">
        <span className={`dot ${socket.s}`} />
        <div className="txt">
          <span className="host">{host}</span>
          <span className="sub">{statusText(socket, room, now, demo)}</span>
        </div>
      </div>
      <div className="stats">
        {room.viewerCount != null ? (
          <span title="同時視聴者">
            👀<b>{compact(room.viewerCount)}</b>
          </span>
        ) : null}
        <span className="dia" title="この配信の累計ダイヤ">
          💎<b>{num(diamonds)}</b>
        </span>
      </div>
      {/* 接続 / 切断。下のバーから一番上へ移した(その分フィードが縦に広がる)。デモ中に押すとデモを止めて接続する */}
      <button
        className={`connbtn${connected ? '' : ' primary'}`}
        disabled={!connected && !canConnect}
        onClick={onToggleConnect}
        title={connected ? '切断' : demo ? 'デモを止めて接続' : '接続'}
        aria-label={connected ? '切断' : demo ? 'デモを止めて接続' : '接続'}
      >
        {connected ? '切断' : '接続'}
      </button>
      <button className="iconbtn" onClick={onArchive} aria-label="アーカイブ">
        🗂
      </button>
      <button className="iconbtn" onClick={onSettings} aria-label="設定">
        ⚙️
      </button>
    </header>
  );
}
