#!/usr/bin/env node
/**
 * src/lib/gift-names-ja.json を作り直す。
 * TikTok LIVE のギフト一覧を日本語と英語で取り、[giftId, 英語名, 日本語名] の表にする。
 * 配信から届く名前は英語なので、アプリはこの表で TikTok LIVE と同じ日本語名に直す。
 * 新しいギフトが英語のまま出るようになったら `npm run gift-names` で更新する。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../src/lib/gift-names-ja.json', import.meta.url));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
/** 地域で並ぶギフトが少し違うので、いくつかの地域を足し合わせる。 */
const REGIONS = ['JP', '', 'US'];

async function list(lang, region) {
  const q = new URLSearchParams({
    aid: '1988',
    app_name: 'tiktok_web',
    device_platform: 'web',
    app_language: lang,
    webcast_language: lang,
    browser_language: lang,
  });
  if (region) {
    q.set('region', region);
    q.set('priority_region', region);
  }
  const res = await fetch(`https://webcast.tiktok.com/webcast/gift/list/?${q}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': lang },
  });
  if (!res.ok) throw new Error(`gift list ${lang}/${region || '-'}: HTTP ${res.status}`);
  const gifts = (await res.json())?.data?.gifts;
  if (!Array.isArray(gifts) || !gifts.length) throw new Error(`gift list ${lang}/${region || '-'}: 空でした`);
  return gifts;
}

const clean = (s) => (typeof s === 'string' ? s.trim() : '');
const en = new Map();
const ja = new Map();
for (const region of REGIONS) {
  for (const g of await list('en', region)) if (clean(g.name)) en.set(String(g.id), clean(g.name));
  for (const g of await list('ja-JP', region)) if (clean(g.name)) ja.set(String(g.id), clean(g.name));
}

// 前回の表にあって今回の一覧から消えたギフト(終了したイベントなど)も残す。過去の配信ログに出てくる。
const rows = new Map();
try {
  for (const r of JSON.parse(readFileSync(out, 'utf8'))) rows.set(r[0], r);
} catch {
  // 初回は表が無い
}
for (const [id, name] of ja) rows.set(id, [id, en.get(id) ?? '', name]);

const sorted = [...rows.values()].sort((a, b) => Number(a[0]) - Number(b[0]));
writeFileSync(out, `[\n${sorted.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`);
console.log(`${sorted.length} 件を書き出しました(今回の一覧 ${ja.size} 件) → ${out}`);
