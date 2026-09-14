#!/usr/bin/env node
/**
 * public/icons/ の PNG を生成する(依存なし: 自前の最小 PNG エンコーダ)。
 * 角丸の濃紺地に金のダイヤと吹き出し、というシンプルな図形。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url));
mkdirSync(dir, { recursive: true });

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const BG = [15, 17, 22];
const BG2 = [35, 40, 54];
const TEAL = [41, 214, 196];
const GOLD = [255, 197, 66];
const PINK = [255, 92, 138];

function draw(size, { rounded, pad }) {
  const s = size;
  const r = rounded ? s * 0.22 : 0;
  const inside = (x, y) => {
    if (!rounded) return true;
    const cx = Math.min(Math.max(x, r), s - r);
    const cy = Math.min(Math.max(y, r), s - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  return png(s, (x, y) => {
    if (!inside(x + 0.5, y + 0.5)) return [0, 0, 0, 0];
    const u = (x + 0.5) / s;
    const v = (y + 0.5) / s;
    let c = mix(BG, BG2, v);
    // 吹き出し(角丸の四角 + 尻尾)
    const p = pad;
    const bx0 = p, by0 = p + 0.02, bx1 = 1 - p, by1 = 0.66 - p * 0.3;
    const rr = 0.09;
    const cx = Math.min(Math.max(u, bx0 + rr), bx1 - rr);
    const cy = Math.min(Math.max(v, by0 + rr), by1 - rr);
    const inBubble = (u - cx) ** 2 + (v - cy) ** 2 <= rr * rr;
    const tail = v >= by1 - 0.01 && v <= by1 + 0.12 && u >= 0.28 && u <= 0.28 + (by1 + 0.12 - v) * 1.4;
    if (inBubble || tail) c = TEAL;
    // ダイヤ(吹き出しの中央、金色)
    const dx = Math.abs(u - 0.5);
    const dyc = v - 0.36;
    const top = dyc >= -0.13 && dyc < -0.05 && dx <= 0.15 * (1 - (-0.13 - dyc) / 0.08 * 0);
    const bottom = dyc >= -0.05 && dyc <= 0.19 && dx <= 0.15 * (1 - (dyc + 0.05) / 0.24);
    if ((top && dx <= 0.15) || bottom) c = GOLD;
    // 右上に小さなピンクの点(初見バッジのイメージ)
    if ((u - 0.8) ** 2 + (v - 0.78) ** 2 <= 0.05 ** 2) c = PINK;
    return [...c, 255];
  });
}

writeFileSync(`${dir}icon-192.png`, draw(192, { rounded: true, pad: 0.14 }));
writeFileSync(`${dir}icon-512.png`, draw(512, { rounded: false, pad: 0.2 }));
writeFileSync(`${dir}apple-touch-icon.png`, draw(180, { rounded: false, pad: 0.14 }));
console.log('icons written to', dir);
