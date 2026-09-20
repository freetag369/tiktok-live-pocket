import { useRef, useState } from 'react';
import { applyBackupSettings, buildBackup, feedToCsv, feedToJson, parseBackup, stamp } from '../lib/backup';
import type { LiveSession } from '../lib/session';
import type { Settings } from '../lib/settings';
import { readTextFile, saveTextFile } from '../lib/save-file';

interface Props {
  session: LiveSession;
  settings: Settings;
  onSettings: (next: Settings) => void;
  knownViewers: number;
  rowCount: number;
}

type Msg = { kind: 'ok' | 'err'; text: string } | null;

export function BackupSection({ session, settings, onSettings, knownViewers, rowCount }: Props) {
  const [includeKey, setIncludeKey] = useState(false);
  const [includeArchive, setIncludeArchive] = useState(false);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ kind: 'ok', text });
    } catch (e) {
      setMsg({ kind: 'err', text: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  const exportBackup = () =>
    run(async () => {
      const data = await session.exportData({ includeArchive });
      const b = buildBackup({ settings, visits: data.visits, gifts: data.gifts, memos: data.memos, includeApiKey: includeKey, appVersion: __APP_VERSION__, archive: data.archive });
      const r = await saveTextFile(`live-pocket-backup-${stamp()}.json`, JSON.stringify(b, null, 1), 'application/json');
      const arch = data.archive ? `・配信 ${data.archive.streams.length} 件` : '';
      return r === 'cancelled' ? '' : `${data.visits.length.toLocaleString('ja-JP')} 人分・メモ ${data.memos.length.toLocaleString('ja-JP')} 件${arch}を書き出しました`;
    });

  const importBackup = (file: File) =>
    run(async () => {
      const parsed = parseBackup(await readTextFile(file));
      const r = await session.importData({ visits: parsed.visits, gifts: parsed.gifts, memos: parsed.memos, archive: parsed.archive, mode });
      if (parsed.settings) onSettings(applyBackupSettings(settings, parsed.settings));
      const when = parsed.exportedAt ? `(${parsed.exportedAt.slice(0, 10)} のバックアップ)` : '';
      const arch = r.streams > 0 ? `・配信 ${r.streams} 件` : '';
      return mode === 'replace'
        ? `${parsed.visits.length.toLocaleString('ja-JP')} 人分・メモ ${parsed.memos.length.toLocaleString('ja-JP')} 件${arch}で置き換えました${when}`
        : `追加 ${r.added} 人・更新 ${r.updated} 人・メモ ${r.memos} 件${arch}${when}`;
    });

  const exportLog = (fmt: 'csv' | 'json') =>
    run(async () => {
      const rows = session.rows;
      if (rows.length === 0) throw new Error('書き出す行がありません');
      const room = session.roomInfo;
      const name = `live-log-${room.hostUniqueId || settings.hostUniqueId || 'live'}-${stamp()}.${fmt}`;
      const r =
        fmt === 'csv'
          ? await saveTextFile(name, feedToCsv(rows), 'text/csv;charset=utf-8')
          : await saveTextFile(name, feedToJson(rows, { roomId: room.roomId, host: room.hostUniqueId ?? settings.hostUniqueId }), 'application/json');
      return r === 'cancelled' ? '' : `${rows.length} 行を書き出しました`;
    });

  return (
    <>
      <div className="section">
        <h2>バックアップ</h2>
        <p className="note">
          来店履歴({knownViewers.toLocaleString('ja-JP')} 人)・リスナーメモ・ギフト画像のキャッシュ・設定を 1 つの JSON ファイルにします。iPhone では共有シートから「ファイルに保存」や AirDrop を選べます。機種変更や Safari のデータ消去に備えて、ときどき書き出してください。
        </p>
        <div className="field">
          <label>
            API キーも含める
            <small>ファイルを人に渡すときは OFF に</small>
          </label>
          <input className="switch" type="checkbox" checked={includeKey} onChange={(e) => setIncludeKey(e.target.checked)} />
        </div>
        <div className="field">
          <label>
            アーカイブも含める
            <small>過去の配信のコメント・ギフトも入る。ファイルが大きくなります</small>
          </label>
          <input className="switch" type="checkbox" checked={includeArchive} onChange={(e) => setIncludeArchive(e.target.checked)} />
        </div>
        <button className="btn primary" disabled={busy} onClick={exportBackup}>
          ⬆ バックアップを書き出す
        </button>
        <div className="field">
          <label>
            読み込み方法
            <small>統合: 回数の多い方・新しいメモを残す / 置き換え: 今の履歴とメモを捨てる</small>
          </label>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}>
            <option value="merge">統合</option>
            <option value="replace">置き換え</option>
          </select>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importBackup(f);
          }}
        />
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          ⬇ バックアップを読み込む
        </button>
      </div>

      <div className="section">
        <h2>配信ログの書き出し</h2>
        <p className="note">いま画面にある {rowCount} 行(🧹 でリセットするまでの分。配信をまたぐこともあります)を書き出します。CSV は Excel / Numbers でそのまま開けます。</p>
        <button className="btn" disabled={busy || rowCount === 0} onClick={() => exportLog('csv')}>
          📄 CSV で書き出す
        </button>
        <button className="btn" disabled={busy || rowCount === 0} onClick={() => exportLog('json')}>
          🧾 JSON で書き出す
        </button>
      </div>
      {msg ? <p className={msg.kind === 'err' ? 'err' : 'note'} style={msg.kind === 'ok' ? { color: 'var(--green)' } : undefined}>{msg.text}</p> : null}
    </>
  );
}
