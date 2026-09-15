import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyEvent, createFeedState, FEED_MAX_ROWS, JOIN_DEDUPE_MS, type FeedState } from '../src/lib/feed';
import { normalize } from '../src/lib/normalize';
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
    expect(s.rows.map((r) => r.viewer.userId)).toEqual(['u1', 'u2']);
    expect(s.joinCount).toBe(2);
    s = applyEvent(s, { kind: 'join', msgId: 'j4', tsMs: NOW + JOIN_DEDUPE_MS + 1, viewer: { userId: 'u1' }, action: 1 }, meta);
    expect(s.rows.map((r) => r.viewer.userId)).toEqual(['u1', 'u2', 'u1']);
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

  it('行数の上限を超えたら古い行から落ちる', () => {
    let s = createFeedState();
    for (let i = 0; i < FEED_MAX_ROWS + 20; i++) s = applyEvent(s, comment(`c${i}`, 't'), meta);
    expect(s.rows).toHaveLength(FEED_MAX_ROWS);
    expect(s.rows[0]!.id).toBe('c20');
  });

  it('follow / share は行になる、other は出さない', () => {
    let s = createFeedState();
    s = applyEvent(s, { kind: 'social', msgId: 's1', tsMs: NOW, viewer: { userId: 'u1' }, sub: 'follow' }, meta);
    s = applyEvent(s, { kind: 'social', msgId: 's2', tsMs: NOW, viewer: { userId: 'u1' }, sub: 'other' }, meta);
    expect(s.rows.map((r) => r.k)).toEqual(['social']);
  });
});
