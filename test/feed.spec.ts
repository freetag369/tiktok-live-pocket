import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applyEvent,
  clearRows,
  countAfter,
  createFeedState,
  dataRows,
  enterRoom,
  FEED_KEEP_JOINS,
  filterRows,
  JOIN_DEDUPE_MS,
  reconcileWindow,
  restoreFeed,
  tailWindow,
  toScreenMeta,
  type FeedItem,
  type FeedState,
  type ScreenItem,
  type ScreenMeta,
} from '../src/lib/feed';
import { normalize } from '../src/lib/normalize';
import { LIKE_BURST_MS, rankLikes } from '../src/lib/likes';
import type { NormalizedEvent } from '../src/lib/events';

const NOW = 1_785_240_000_000;
const meta = { visits: 1, firstEver: true };

function fixtureEvents(name: string): NormalizedEvent[] {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((r) => typeof r.type === 'string')
    .map((r) => normalize(r.type, r.data, NOW)!)
    .filter(Boolean);
}

function comment(id: string, text: string, userId = 'u1'): NormalizedEvent {
  return { kind: 'comment', msgId: id, tsMs: NOW, viewer: { userId, nickname: 'n' }, content: text };
}

describe('feed reducer', () => {
  it('コメントは 1 行、同じ msgId の再送は捨てる', () => {
    let s = createFeedState();
    s = applyEvent(s, comment('a', 'hi'), meta);
    const s2 = applyEvent(s, comment('a', 'hi'), meta);
    expect(s2).toBe(s);
    expect(s.rows).toHaveLength(1);
    expect(s.commentCount).toBe(1);
  });

  it('入室は action 1 だけ', () => {
    let s = createFeedState();
    s = applyEvent(s, { kind: 'join', msgId: 'j1', tsMs: NOW, viewer: { userId: 'u1' }, action: 1 }, meta);
    s = applyEvent(s, { kind: 'join', msgId: 'j2', tsMs: NOW, viewer: { userId: 'u1' }, action: 3 }, meta);
    expect(s.rows.map((r) => r.k)).toEqual(['join']);
    expect(s.joinCount).toBe(1);
  });

  it('同じ人の入室が 10 秒以内に重なったら 1 行(MemberMessage + Barrage の保険)', () => {
    let s = createFeedState();
    s = applyEvent(s, { kind: 'join', msgId: 'j1', tsMs: NOW, viewer: { userId: 'u1', gifterLevel: 32 }, action: 1 }, meta);
    s = applyEvent(s, { kind: 'join', msgId: 'j2', tsMs: NOW + 500, viewer: { userId: 'u1' }, action: 1 }, meta);
    s = applyEvent(s, { kind: 'join', msgId: 'j3', tsMs: NOW + 700, viewer: { userId: 'u2' }, action: 1 }, meta);
    expect(dataRows(s.rows).map((r) => r.viewer.userId)).toEqual(['u1', 'u2']);
    expect(s.joinCount).toBe(2);
    s = applyEvent(s, { kind: 'join', msgId: 'j4', tsMs: NOW + JOIN_DEDUPE_MS + 1, viewer: { userId: 'u1' }, action: 1 }, meta);
    expect(dataRows(s.rows).map((r) => r.viewer.userId)).toEqual(['u1', 'u2', 'u1']);
    expect(s.joinCount).toBe(3);
  });

  it('grade-entrance: Barrage の入室 + 同じ人の MemberMessage で入室 1 行、サブスク帯は出ない', () => {
    let s = createFeedState();
    for (const e of fixtureEvents('synth-grade-entrance.ndjson')) s = applyEvent(s, e, meta);
    expect(s.rows.map((r) => r.k)).toEqual(['join', 'comment']);
    expect(s.rows[0]).toMatchObject({ k: 'join', viewer: { userId: '9001', nickname: 'ビッグ', gifterLevel: 32 } });
    expect(s.joinCount).toBe(1);
  });

  it('連打ギフト: 同じ行を更新し、累計💎は差分で積む', () => {
    let s: FeedState = createFeedState();
    for (const e of fixtureEvents('synth-rose-combo.ndjson')) s = applyEvent(s, e, meta);
    expect(s.rows).toHaveLength(1);
    const row = s.rows[0]!;
    expect(row).toMatchObject({ k: 'gift', giftName: 'Rose', count: 17, diamonds: 17, streaking: false });
    expect(s.diamonds).toBe(17);
    expect(s.giftCount).toBe(1);
    expect(s.streaks.size).toBe(0);
  });

  it('連打の最後(repeatEnd=1)が欠けても、途中までの💎は残る', () => {
    let s = createFeedState();
    const evs = fixtureEvents('synth-rose-combo.ndjson').slice(0, 3);
    for (const e of evs) s = applyEvent(s, e, meta);
    expect(s.rows[0]).toMatchObject({ k: 'gift', count: 11, streaking: true });
    expect(s.diamonds).toBe(11);
  });

  it('画像が無い tick はカタログの画像で補う', () => {
    let s = createFeedState();
    s = applyEvent(
      s,
      { kind: 'gift', msgId: 'g1', tsMs: NOW, viewer: { userId: 'u1' }, giftId: '5655', giftName: 'Rose', giftType: 1, repeatCount: 1, streaking: true, diamondEach: 1, groupId: 'x' },
      meta,
      'https://p16.tiktokcdn.com/rose.png'
    );
    expect(s.rows[0]).toMatchObject({ k: 'gift', iconUrl: 'https://p16.tiktokcdn.com/rose.png' });
  });

  it('非連打ギフトは 1 通 1 行', () => {
    let s = createFeedState();
    const g = (id: string): NormalizedEvent => ({ kind: 'gift', msgId: id, tsMs: NOW, viewer: { userId: 'u1' }, giftId: '5897', giftName: 'Swan', giftType: 2, repeatCount: 1, streaking: false, diamondEach: 699 });
    s = applyEvent(s, g('a'), meta);
    s = applyEvent(s, g('b'), meta);
    expect(s.rows).toHaveLength(2);
    expect(s.diamonds).toBe(1398);
  });

  it('コメントとギフトは落とさず、入室・フォローだけ直近 FEED_KEEP_JOINS 件にする', () => {
    let s = createFeedState();
    const total = FEED_KEEP_JOINS + 100;
    for (let i = 0; i < total; i++) {
      s = applyEvent(s, comment(`c${i}`, 't', `cu${i}`), meta);
      s = applyEvent(s, { kind: 'join', msgId: `j${i}`, tsMs: NOW + i * (JOIN_DEDUPE_MS + 1), viewer: { userId: `ju${i}` }, action: 1 }, meta);
    }
    s = applyEvent(s, { kind: 'social', msgId: 's1', tsMs: NOW, viewer: { userId: 'su' }, sub: 'follow' }, meta);
    s = applyEvent(s, { kind: 'gift', msgId: 'g1', tsMs: NOW, viewer: { userId: 'gu' }, giftId: '1', giftName: 'Rose', giftType: 2, repeatCount: 1, streaking: false, diamondEach: 1 }, meta);

    const rows = dataRows(s.rows);
    expect(rows.filter((r) => r.k === 'comment')).toHaveLength(total);
    expect(rows.filter((r) => r.k === 'gift')).toHaveLength(1);
    const joins = rows.filter((r) => r.k === 'join' || r.k === 'social');
    expect(joins).toHaveLength(FEED_KEEP_JOINS);
    expect(s.joinRows).toBe(FEED_KEEP_JOINS);
    // 落ちるのは古い入室から。コメントとギフトは残る。
    expect(joins[0]!.id).toBe(`j${total - FEED_KEEP_JOINS + 1}`);
    expect(joins[joins.length - 1]!.id).toBe('s1');
    expect(rows[0]!.id).toBe('c0');
  });

  it('lastTouched: 新規行と連打の更新行を指す。重複は state ごと変わらない', () => {
    let s = createFeedState();
    expect(s.lastTouched).toBeNull();
    s = applyEvent(s, comment('a', 'hi'), meta);
    expect(s.lastTouched?.id).toBe('a');
    const dup = applyEvent(s, comment('a', 'hi'), meta);
    expect(dup).toBe(s);
    let g = createFeedState();
    for (const e of fixtureEvents('synth-rose-combo.ndjson')) {
      g = applyEvent(g, e, meta);
      expect(g.lastTouched?.id).toBe(g.rows[0]!.id);
    }
    expect(g.lastTouched).toMatchObject({ k: 'gift', count: 17, streaking: false });
  });

  it('follow / share は行になる、other は出さない', () => {
    let s = createFeedState();
    s = applyEvent(s, { kind: 'social', msgId: 's1', tsMs: NOW, viewer: { userId: 'u1' }, sub: 'follow' }, meta);
    s = applyEvent(s, { kind: 'social', msgId: 's2', tsMs: NOW, viewer: { userId: 'u1' }, sub: 'other' }, meta);
    expect(s.rows.map((r) => r.k)).toEqual(['social']);
  });

  it('joinRows は rows の入室・フォロー数と常に一致する', () => {
    let s = createFeedState();
    const joins = () => dataRows(s.rows).filter((r) => r.k === 'join' || r.k === 'social').length;
    for (let i = 0; i < FEED_KEEP_JOINS + 50; i++) {
      s = applyEvent(s, { kind: 'join', msgId: `x${i}`, tsMs: NOW + i * (JOIN_DEDUPE_MS + 1), viewer: { userId: `xu${i}` }, action: 1 }, meta);
      if (i % 97 === 0) s = applyEvent(s, comment(`xc${i}`, 't', `xcu${i}`), meta);
    }
    expect(s.joinRows).toBe(joins());
    s = enterRoom(s, 'r9', { now: NOW });
    expect(s.joinRows).toBe(joins());
    s = clearRows(s);
    expect(s.joinRows).toBe(joins());
    s = applyEvent(s, { kind: 'join', msgId: 'z1', tsMs: NOW, viewer: { userId: 'z' }, action: 1 }, meta);
    expect(s.joinRows).toBe(joins());
  });
});

// 以降は「画面の履歴」(🧹 まで残す・配信の区切り・復元・窓描画)のためのロジック。

const rose = (id: string, repeatCount: number, streaking: boolean): NormalizedEvent => ({
  kind: 'gift',
  msgId: id,
  tsMs: NOW,
  viewer: { userId: 'gifter' },
  giftId: '5655',
  giftName: 'Rose',
  giftType: 1,
  repeatCount,
  streaking,
  diamondEach: 1,
  groupId: 'grp',
});

function commentRow(id: string, tsMs = NOW): FeedItem {
  return { k: 'comment', id, tsMs, viewer: { userId: `u-${id}` }, text: id, visits: 1, firstEver: false };
}
function joinRow(id: string, tsMs = NOW): FeedItem {
  return { k: 'join', id, tsMs, viewer: { userId: `u-${id}` }, visits: 1, firstEver: false };
}
function screenItem(seq: number, roomId: string, item: FeedItem): ScreenItem {
  return { ...item, roomId, seq } as ScreenItem;
}

describe('配信の切り替え(enterRoom)', () => {
  it('まだ配信が決まっていない / 同じ配信なら、区切りも集計のリセットも無い', () => {
    let s = createFeedState();
    s = applyEvent(s, comment('c1', 'hi'), meta);
    s = enterRoom(s, 'r1', { now: NOW });
    expect(s.roomId).toBe('r1');
    expect(s.rows.some((r) => r.k === 'room')).toBe(false);
    expect(s.commentCount).toBe(1);
    expect(enterRoom(s, 'r1', { now: NOW + 1 })).toBe(s);
  });

  it('別の配信なら区切りを積み、集計・重複表・連打をリセットする', () => {
    let s = createFeedState();
    s = enterRoom(s, 'r1', { now: NOW });
    s = applyEvent(s, comment('c1', 'hi'), meta);
    s = applyEvent(s, rose('g1', 5, true), meta);
    s = enterRoom(s, 'r2', { hostNickname: 'ほし', now: NOW + 1000 });
    expect(s.rows[s.rows.length - 1]).toMatchObject({ k: 'room', roomId: 'r2', hostNickname: 'ほし', tsMs: NOW + 1000 });
    expect(s).toMatchObject({ roomId: 'r2', commentCount: 0, giftCount: 0, diamonds: 0 });
    expect(s.seen.size).toBe(0);
    expect(s.streaks.size).toBe(0);
    // 打ち切った連打の ×N は光らせたままにしない
    expect(dataRows(s.rows).find((r) => r.id === 'g1')).toMatchObject({ k: 'gift', streaking: false });
  });

  it('行が無いうちは区切りを積まず、区切りが続くときは後ろで差し替える', () => {
    let s = createFeedState();
    s = enterRoom(s, 'r1', { now: NOW });
    s = enterRoom(s, 'r2', { now: NOW + 1 });
    expect(s.rows).toHaveLength(0);
    s = applyEvent(s, comment('c1', 'hi'), meta);
    s = enterRoom(s, 'r3', { now: NOW + 2 });
    s = enterRoom(s, 'r4', { now: NOW + 3 });
    expect(s.rows.filter((r) => r.k === 'room')).toHaveLength(1);
    expect(s.rows[s.rows.length - 1]).toMatchObject({ k: 'room', roomId: 'r4' });
  });
});

describe('🧹 画面の行を消す(clearRows)', () => {
  it('連打中のギフト行は残り、続きの ×N は同じ行に乗る。集計は残る', () => {
    let s = createFeedState();
    s = applyEvent(s, comment('c1', 'hi'), meta);
    s = applyEvent(s, { kind: 'join', msgId: 'j1', tsMs: NOW, viewer: { userId: 'u2' }, action: 1 }, meta);
    s = applyEvent(s, rose('g1', 5, true), meta);
    expect(s.diamonds).toBe(5);

    s = clearRows(s);
    expect(dataRows(s.rows).map((r) => r.id)).toEqual(['g1']);
    expect(s).toMatchObject({ commentCount: 1, joinCount: 1, giftCount: 1, diamonds: 5, joinRows: 0 });

    s = applyEvent(s, rose('g2', 50, false), meta);
    expect(dataRows(s.rows)).toHaveLength(1);
    expect(s.rows[0]).toMatchObject({ k: 'gift', count: 50, diamonds: 50, streaking: false });
    expect(s.diamonds).toBe(50);
    // アーカイブにも ×50 が届く
    expect(s.lastTouched).toMatchObject({ id: 'g1', count: 50 });
  });

  it('連打中でなければ空になる(終わった連打・復元した過去のギフトも残さない)', () => {
    let s = createFeedState();
    s = applyEvent(s, comment('c1', 'hi'), meta);
    s = applyEvent(s, rose('g1', 5, true), meta);
    s = applyEvent(s, rose('g2', 9, false), meta); // 連打おわり
    expect(clearRows(s).rows).toHaveLength(0);

    // 復元した行(streaking は false、連打表は行のために作り直してある)も残さない
    const items = dataRows(s.rows).map((r, i) => screenItem(i + 1, 'r1', r));
    const { state } = restoreFeed(items, null);
    expect(state.streaks.size).toBe(1);
    expect(clearRows(state).rows).toHaveLength(0);
  });
});

describe('タブと配信の区切り(filterRows)', () => {
  it('区切りは各タブに残り、続いた区切りは後ろだけ、行が無いタブは空', () => {
    let s = createFeedState();
    s = enterRoom(s, 'r1', { now: NOW });
    s = applyEvent(s, comment('c1', 'hi'), meta);
    s = enterRoom(s, 'r2', { now: NOW + 1 });
    s = applyEvent(s, { kind: 'join', msgId: 'j1', tsMs: NOW + 2, viewer: { userId: 'u9' }, action: 1 }, meta);
    expect(filterRows(s.rows, 'all').map((r) => r.k)).toEqual(['comment', 'room', 'join']);
    expect(filterRows(s.rows, 'comment').map((r) => r.k)).toEqual(['comment', 'room']);
    expect(filterRows(s.rows, 'join').map((r) => r.k)).toEqual(['room', 'join']);
    expect(filterRows(s.rows, 'gift')).toEqual([]);
  });
});

describe('画面の履歴の復元(restoreFeed)', () => {
  it('seq の順に並べ、入室は直近 FEED_KEEP_JOINS 件、落とした分は dropIds', () => {
    const items: ScreenItem[] = [];
    let seq = 1;
    items.push(screenItem(seq++, 'r1', commentRow('c1')));
    for (let i = 0; i < FEED_KEEP_JOINS + 30; i++) items.push(screenItem(seq++, 'r1', joinRow(`j${i}`)));
    items.push(screenItem(seq++, 'r1', commentRow('c2')));

    // 保存から返る順番はバラバラでも、seq で並び直す。
    const { state, dropIds } = restoreFeed([...items].reverse(), null);
    const rows = dataRows(state.rows);
    expect(dropIds).toHaveLength(30);
    expect(dropIds[0]).toBe('j0');
    expect(state.joinRows).toBe(FEED_KEEP_JOINS);
    expect(rows[0]!.id).toBe('c1');
    expect(rows[rows.length - 1]!.id).toBe('c2');
    // meta が無ければ最後の配信の行から数える(落ちた入室も配信の合計には入れる)
    expect(state).toMatchObject({ roomId: 'r1', commentCount: 2, joinCount: FEED_KEEP_JOINS + 30 });
    // 落とした入室も「見た」ことにして、再接続のバックログで戻ってこないようにする
    expect(state.seen.has('j0')).toBe(true);
    expect(applyEvent(state, { kind: 'join', msgId: 'j0', tsMs: NOW, viewer: { userId: 'u-j0' }, action: 1 }, meta)).toBe(state);
  });

  it('meta があれば集計・💎・連打・seen を引き継ぎ、再送でも二重にならない', () => {
    let live = createFeedState();
    live = enterRoom(live, 'r1', { now: NOW });
    live = applyEvent(live, comment('c1', 'hi'), meta);
    live = applyEvent(live, rose('g1', 5, true), meta);
    const saved = toScreenMeta(live);
    const items = dataRows(live.rows).map((r, i) => screenItem(i + 1, 'r1', r));

    const { state } = restoreFeed(items, saved);
    expect(state).toMatchObject({ roomId: 'r1', commentCount: 1, giftCount: 1, diamonds: 5 });
    expect(dataRows(state.rows).find((r) => r.id === 'g1')).toMatchObject({ streaking: false });

    // 再接続のバックログ再送(同じ msgId)は弾く
    expect(applyEvent(state, comment('c1', 'hi'), meta)).toBe(state);
    // 連打の続きは同じ行に乗り、💎 も差分だけ
    const next = applyEvent(state, rose('g2', 17, false), meta);
    expect(dataRows(next.rows).filter((r) => r.k === 'gift')).toHaveLength(1);
    expect(next.diamonds).toBe(17);
    expect(next.rows.find((r) => r.id === 'g1')).toMatchObject({ count: 17 });
  });

  it('終わった連打の tick が再送されても、行も 💎 も増えない', () => {
    let live = createFeedState();
    live = enterRoom(live, 'r1', { now: NOW });
    for (const e of fixtureEvents('synth-rose-combo.ndjson')) live = applyEvent(live, e, meta);
    expect(live.diamonds).toBe(17);
    // 保存 → 再起動(seen は直近のぶんしか残らない前提で空にしておく)
    const items = dataRows(live.rows).map((r, i) => screenItem(i + 1, 'r1', r));
    const saved: ScreenMeta = { ...toScreenMeta(live), seen: [] };
    const { state } = restoreFeed(items, saved);

    let after = state;
    for (const e of fixtureEvents('synth-rose-combo.ndjson')) after = applyEvent(after, e, meta);
    expect(dataRows(after.rows).filter((r) => r.k === 'gift')).toHaveLength(1);
    expect(after.diamonds).toBe(17);
    expect(after.giftCount).toBe(state.giftCount);
  });

  it('区切りも保存してあるので、配信の境目がそのまま戻る', () => {
    const items = [
      screenItem(1, 'r1', commentRow('c1')),
      screenItem(2, 'r2', { k: 'room', id: 'room:r2:1', tsMs: NOW + 1, roomId: 'r2', hostNickname: 'ほし' }),
      screenItem(3, 'r2', commentRow('c2')),
    ];
    const { state } = restoreFeed(items, null);
    expect(state.rows.map((r) => r.k)).toEqual(['comment', 'room', 'comment']);
    expect(state.rows[1]).toMatchObject({ roomId: 'r2', hostNickname: 'ほし' });
    expect(state.roomId).toBe('r2');
    expect(state.commentCount).toBe(1);
  });
});

describe('画面に描く窓', () => {
  const list = (n: number): FeedItem[] => Array.from({ length: n }, (_, i) => commentRow(`w${i}`, NOW + i));

  it('tailWindow は末尾だけ返す', () => {
    const items = list(10);
    expect(tailWindow(items, 3).map((r) => r.id)).toEqual(['w7', 'w8', 'w9']);
    expect(tailWindow(items, 20)).toBe(items);
  });

  it('reconcileWindow: 表示中の行は消えず、新着は上限まで下に足す', () => {
    const items = list(10);
    const frozen = items.slice(2, 6);
    // 上限で w2(窓の先頭)が落ちても、画面からは消さない
    const after = [...items.slice(0, 2), ...items.slice(3)];
    const w = reconcileWindow(frozen, after, 2);
    expect(w.items.map((r) => r.id)).toEqual(['w2', 'w3', 'w4', 'w5', 'w6', 'w7']);
    expect(w).toMatchObject({ appended: 2, hiddenBefore: 2, stale: false });
  });

  it('reconcileWindow: 固定していた行が全部消えたら stale', () => {
    const w = reconcileWindow(list(3), list(3).map((r) => commentRow(`${r.id}-new`)), 5);
    expect(w.stale).toBe(true);
  });

  it('countAfter: 基準より後の行を数え、基準が落ちていたら時刻で数える', () => {
    const items = list(3);
    expect(countAfter(items, { id: 'w0', tsMs: NOW })).toBe(2);
    expect(countAfter(items, { id: 'w2', tsMs: NOW + 2 })).toBe(0);
    expect(countAfter(items, { id: 'gone', tsMs: NOW + 1 })).toBe(1);
    expect(countAfter(items, null)).toBe(0);
  });
});

function like(id: string, userId: string, count: number, roomTotal?: number): NormalizedEvent {
  return { kind: 'like', msgId: id, tsMs: NOW, viewer: { userId, nickname: `n${userId}` }, count, roomTotal };
}

describe('feed reducer: いいね', () => {
  it('small-room: 人ごとにタップを合算し、行は増やさない', () => {
    let s = createFeedState();
    for (const e of fixtureEvents('synth-small-room.ndjson')) s = applyEvent(s, e, meta, undefined, NOW);
    expect(s.likes.size).toBe(5);
    expect(s.likeCount).toBe(43);
    expect(s.likeRoomTotal).toBe(1100);
    const rank = rankLikes(s.likes, 10);
    expect(rank.map((e) => e.userId)).toEqual(['101', '100', '104', '103', '102']);
    expect(rank.map((e) => e.taps)).toEqual([14, 11, 8, 6, 4]);
    expect(s.rows.every((r) => r.k === 'comment' || r.k === 'join' || r.k === 'social')).toBe(true);
    expect(s.commentCount).toBe(12);
  });

  it('連打: 3 秒以内は burst が伸び、空くと取り直す', () => {
    let s = createFeedState();
    s = applyEvent(s, like('a', 'u1', 3), meta, undefined, NOW);
    expect(s.likes.get('u1')).toMatchObject({ taps: 3, burst: 3, lastMs: NOW });
    s = applyEvent(s, like('b', 'u1', 4), meta, undefined, NOW + LIKE_BURST_MS - 1);
    expect(s.likes.get('u1')).toMatchObject({ taps: 7, burst: 7 });
    s = applyEvent(s, like('c', 'u1', 2), meta, undefined, NOW + LIKE_BURST_MS - 1 + LIKE_BURST_MS);
    expect(s.likes.get('u1')).toMatchObject({ taps: 9, burst: 2 });
    expect(s.likeCount).toBe(9);
  });

  it('同じ msgId の再送と count 0 は捨てる(再接続のバックログ)', () => {
    let s = createFeedState();
    s = applyEvent(s, like('a', 'u1', 5), meta);
    const again = applyEvent(s, like('a', 'u1', 5), meta);
    expect(again).toBe(s);
    expect(applyEvent(s, like('z', 'u1', 0), meta)).toBe(s);
    let r = createFeedState();
    for (const e of fixtureEvents('synth-reconnect-replay.ndjson')) r = applyEvent(r, e, meta);
    expect(r.likes.get('1')?.taps).toBe(15);
    expect(r.likeCount).toBe(15);
  });

  it('部屋全体の累計は見た中の最大、無ければ据え置き', () => {
    let s = createFeedState();
    expect(s.likeRoomTotal).toBeUndefined();
    s = applyEvent(s, like('a', 'u1', 1, 500), meta);
    s = applyEvent(s, like('b', 'u1', 1, 400), meta);
    expect(s.likeRoomTotal).toBe(500);
    s = applyEvent(s, like('c', 'u1', 1), meta);
    expect(s.likeRoomTotal).toBe(500);
  });

  it('来店情報を持ち、Map は同じ参照のままエントリだけ差し替わる', () => {
    let s = createFeedState();
    s = applyEvent(s, like('a', 'u1', 1), { visits: 7, firstEver: false });
    const m = s.likes;
    const first = m.get('u1')!;
    expect(first).toMatchObject({ visits: 7, firstEver: false });
    s = applyEvent(s, like('b', 'u1', 1), { visits: 7, firstEver: false });
    expect(s.likes).toBe(m);
    expect(s.likes.get('u1')).not.toBe(first);
  });

  it('いいねは行を作らないので lastTouched を引き継がない(アーカイブに再投入しない)', () => {
    let s = applyEvent(createFeedState(), comment('c1', 'hi'), meta);
    expect(s.lastTouched).not.toBeNull();
    s = applyEvent(s, like('a', 'u1', 4), meta, undefined, NOW);
    expect(s.likeCount).toBe(4);
    expect(s.lastTouched).toBeNull();
  });

  it('配信が変わると集計だけ消え、行は残る', () => {
    let s = createFeedState();
    s = enterRoom(s, 'r1', { now: NOW });
    s = applyEvent(s, comment('c1', 'hi'), meta);
    s = applyEvent(s, like('a', 'u1', 4, 50), meta);
    const r = enterRoom(s, 'r2', { now: NOW + 1 });
    expect(dataRows(r.rows)).toHaveLength(1);
    expect(r.likes.size).toBe(0);
    expect(r.likeCount).toBe(0);
    expect(r.likeRoomTotal).toBeUndefined();
  });
});
