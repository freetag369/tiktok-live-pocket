#!/usr/bin/env node
/**
 * Euler Stream Cloud WebSocket の封筒形式で fixture を再生するモックサーバー。
 * 実機やブラウザの結線確認に使う(Euler の無料枠を消費しない)。
 *
 *   node scripts/mock-ws.mjs [fixture.ndjson] [--port 8787] [--loop] [--speed 1]
 *
 * アプリの設定 →「詳細」→ 接続先 WebSocket を ws://<PCのIP>:8787 にする。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const file = args.find((a) => a.endsWith('.ndjson')) ?? fileURLToPath(new URL('../src/fixtures/demo.ndjson', import.meta.url));
const port = Number(opt('--port', 8787));
const loop = args.includes('--loop');
const speed = Number(opt('--speed', 1));

const lines = readFileSync(file, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))
  .filter((r) => typeof r.type === 'string');

const wss = new WebSocketServer({ port });
console.log(`mock Euler WS on ws://0.0.0.0:${port}  (${lines.length} events from ${file})`);

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'ws://x');
  const uniqueId = url.searchParams.get('uniqueId') ?? '';
  console.log(`client connected uniqueId=${uniqueId} apiKey=${url.searchParams.has('apiKey') ? 'yes' : 'no'}`);
  if (!uniqueId) {
    ws.close(4400, 'invalid options');
    return;
  }
  if (uniqueId === 'offline') {
    ws.close(4404, 'not live');
    return;
  }
  const roomId = `mock-${Math.floor(Date.now() / 3_600_000)}`;
  const send = (messages) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ timestamp: Date.now(), messages }));
  };
  send([
    { type: 'roomInfo', data: { data: { id_str: roomId, owner: { nickname: 'モック配信', display_id: uniqueId } } } },
    { type: 'workerInfo', data: { webSocketId: 'mock', schemaVersion: 'v2' } },
    { type: 'tiktok.connect', data: { agentId: 'mock' } },
  ]);
  let timers = [];
  const play = () => {
    timers = [];
    let last = 0;
    for (const l of lines) {
      const at = Math.max(0, l.o) / speed;
      last = Math.max(last, at);
      timers.push(setTimeout(() => send([{ type: l.type, data: l.data }]), at));
    }
    timers.push(
      setTimeout(() => {
        if (loop) play();
        else ws.close(4005, 'stream end');
      }, last + 1500)
    );
  };
  play();
  ws.on('close', () => {
    for (const t of timers) clearTimeout(t);
    console.log('client closed');
  });
});
