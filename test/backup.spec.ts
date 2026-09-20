import { describe, expect, it } from 'vitest';
import { applyBackupSettings, buildBackup, csvCell, feedToCsv, feedToJson, parseBackup, LOG_CSV_HEADER } from '../src/lib/backup';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { VisitCounter, sanitizeRecord, type VisitRecord } from '../src/lib/visits';
import { GiftCatalog } from '../src/lib/gift-catalog';
import type { FeedRow } from '../src/lib/feed';

const T = 1_785_240_000_000;
const settings = { ...DEFAULT_SETTINGS, hostUniqueId: 'metafact8', eulerApiKey: 'secret-key' };
const visits: VisitRecord[] = [
  { userId: 'u1', visits: 3, lastRoomId: 'r1', nickname: 'A', uniqueId: 'a', firstSeenMs: T, lastSeenMs: T + 10 },
  { userId: 'u2', visits: 1, lastRoomId: 'r1', nickname: 'B', firstSeenMs: T, lastSeenMs: T },
];
const gifts = [{ giftId: '5655', name: 'Rose', diamonds: 1, iconUrl: 'https://p16.tiktokcdn.com/rose.png', updatedMs: T }];
const memos = [{ userId: 'u1', note: '誕生日 3/4', kana: 'えー', updatedMs: T, nickname: 'A', uniqueId: 'a' }];

describe('backup round trip', () => {
  it('書き出し → 読み込みで来店履歴・ギフト・メモが戻る。API キーは既定で含めない', () => {
    const b = buildBackup({ settings, visits, gifts, memos, includeApiKey: false, appVersion: '0.1.0', now: new Date(T) });
    const text = JSON.stringify(b);
    expect(text).not.toContain('secret-key');
    const p = parseBackup(text);
    expect(p.visits).toEqual(visits);
    expect(p.gifts).toEqual(gifts);
    expect(p.memos).toEqual(memos);
    expect(p.settings?.hostUniqueId).toBe('metafact8');
    expect(p.settings?.eulerApiKey).toBeUndefined();
    expect(p.exportedAt).toBe(new Date(T).toISOString());
  });

  it('memos の無い旧バックアップも読め、memos は空になる', () => {
    const p = parseBackup(JSON.stringify({ format: 'tiktok-live-pocket-backup', version: 1, visits, gifts }));
    expect(p.visits).toEqual(visits);
    expect(p.memos).toEqual([]);
    // 壊れたメモ行は捨てる
    const q = parseBackup(JSON.stringify({ format: 'tiktok-live-pocket-backup', version: 1, memos: [{ userId: 'x', note: 'ok' }, { note: 'no id' }, 3] }));
    expect(q.memos).toEqual([{ userId: 'x', note: 'ok', kana: '', updatedMs: 0 }]);
  });

  it('アーカイブは含めたときだけ入り、読み込みで戻る。壊れた行は捨てる', () => {
    const plain = buildBackup({ settings, visits, gifts, includeApiKey: false, appVersion: '0.1.0' });
    expect(plain).not.toHaveProperty('archive');
    expect(parseBackup(JSON.stringify(plain)).archive).toBeNull();

    const archive = {
      streams: [{ roomId: 'r1', hostUniqueId: 'metafact8', startedMs: T, endedMs: T + 1000, rows: 2, comments: 1, joins: 0, gifts: 1, diamonds: 8 }],
      rows: [
        { k: 'comment' as const, id: 'c1', roomId: 'r1', tsMs: T, viewer: { userId: 'u1', nickname: 'A' }, text: 'hi', visits: 1, firstEver: true },
        { k: 'gift' as const, id: 'g1', roomId: 'r1', tsMs: T + 1000, viewer: { userId: 'u2' }, giftId: '5655', giftName: 'Rose', count: 8, diamondEach: 1, diamonds: 8, streaking: false, visits: 1, firstEver: true },
      ],
    };
    const b = buildBackup({ settings, visits, gifts, includeApiKey: false, appVersion: '0.1.0', archive });
    const text = JSON.stringify(b).replace('"rows":[', '"rows":[{"k":"comment","id":"broken"},');
    const p = parseBackup(text);
    expect(p.archive?.streams).toEqual(archive.streams);
    expect(p.archive?.rows).toEqual(archive.rows);
  });

  it('includeApiKey=true ならキーも入る', () => {
    const b = buildBackup({ settings, visits: [], gifts: [], includeApiKey: true, appVersion: '0.1.0' });
    expect(b.settings.eulerApiKey).toBe('secret-key');
  });

  it('形式違い・壊れた JSON は Error', () => {
    expect(() => parseBackup('{')).toThrow();
    expect(() => parseBackup('{"format":"other"}')).toThrow(/このアプリ/);
    expect(() => parseBackup('{"format":"tiktok-live-pocket-backup","version":99}')).toThrow(/新しい/);
  });

  it('壊れた行は捨て、数値は正規化する', () => {
    const p = parseBackup(JSON.stringify({ format: 'tiktok-live-pocket-backup', version: 1, visits: [{ userId: 'x', visits: '7', lastSeenMs: 'nope' }, { visits: 3 }, null] }));
    expect(p.visits).toHaveLength(1);
    expect(p.visits[0]).toMatchObject({ userId: 'x', visits: 7, lastRoomId: '' });
    expect(sanitizeRecord({ userId: 9, visits: -2 })).toMatchObject({ userId: '9', visits: 0 });
  });

  it('設定の適用: 入っている項目だけ上書き、キーが無ければ現状維持', () => {
    const next = applyBackupSettings(settings, { hostUniqueId: '@newhost', fontSize: 'large', archiveEnabled: false, archiveKeepStreams: 7 });
    expect(next.hostUniqueId).toBe('newhost');
    expect(next.fontSize).toBe('large');
    expect(next.archiveEnabled).toBe(false);
    expect(next.archiveKeepStreams).toBe(7);
    expect(next.eulerApiKey).toBe('secret-key');
    expect(applyBackupSettings(settings, null)).toEqual(settings);
    expect(applyBackupSettings(settings, { followPopup: false }).followPopup).toBe(false);
    expect(applyBackupSettings(settings, { likePopup: false }).likePopup).toBe(false);
    expect(applyBackupSettings(settings, {}).likePopup).toBe(true);
    expect(buildBackup({ settings, visits: [], gifts: [], includeApiKey: false, appVersion: '0.1.0' }).settings.likePopup).toBe(true);
  });
});

describe('VisitCounter.import', () => {
  it('merge: 回数は多い方、名前は新しい方、無い人は追加', () => {
    const c = new VisitCounter([{ userId: 'u1', visits: 5, lastRoomId: 'rX', nickname: 'Old', firstSeenMs: T - 100, lastSeenMs: T + 5 }]);
    const r = c.import(visits, 'merge');
    expect(r).toEqual({ added: 1, updated: 1 });
    const u1 = c.all().find((x) => x.userId === 'u1')!;
    expect(u1.visits).toBe(5); // 多い方
    expect(u1.nickname).toBe('A'); // 取り込む方が新しい(lastSeenMs T+10 > T+5)
    expect(u1.lastRoomId).toBe('r1');
    expect(u1.firstSeenMs).toBe(T - 100);
    expect(u1.lastSeenMs).toBe(T + 10);
    expect(c.drainDirty()).toHaveLength(2);
    // 何も変わらない取り込みは updated 0
    expect(c.import(visits, 'merge')).toEqual({ added: 0, updated: 0 });
  });

  it('replace: 既存を捨てて置き換える', () => {
    const c = new VisitCounter([{ userId: 'zz', visits: 9, lastRoomId: '', firstSeenMs: T, lastSeenMs: T }]);
    c.import(visits, 'replace');
    expect(c.all().map((x) => x.userId).sort()).toEqual(['u1', 'u2']);
  });

  it('取り込み後もラッチ中の判定は変わらない(merge)', () => {
    const c = new VisitCounter();
    c.setRoom('r9');
    expect(c.touch({ userId: 'u1' }, T)).toEqual({ visits: 1, firstEver: true });
    c.import(visits, 'merge');
    expect(c.touch({ userId: 'u1' }, T + 1)).toEqual({ visits: 1, firstEver: true });
    expect(c.all().find((x) => x.userId === 'u1')!.visits).toBe(3);
  });
});

describe('GiftCatalog.import', () => {
  it('新しい updatedMs だけ採用', () => {
    const g = new GiftCatalog([{ giftId: '5655', name: 'Rose', diamonds: 1, iconUrl: '', updatedMs: T + 5 }]);
    expect(g.import(gifts)).toBe(0);
    expect(g.import([{ ...gifts[0]!, updatedMs: T + 10 }])).toBe(1);
    expect(g.iconOf('5655')).toBe('https://p16.tiktokcdn.com/rose.png');
  });
});

describe('配信ログ', () => {
  const rows: FeedRow[] = [
    { k: 'comment', id: 'c1', tsMs: T, viewer: { userId: 'u1', nickname: 'A, "B"', uniqueId: 'a' }, text: '=SUM(1)\n改行', visits: 2, firstEver: false },
    { k: 'gift', id: 'g1', tsMs: T + 1000, viewer: { userId: 'u2', nickname: 'ゆな' }, giftId: '5655', giftName: 'Rose', count: 8, diamondEach: 1, diamonds: 8, streaking: false, visits: 1, firstEver: true },
    { k: 'join', id: 'j1', tsMs: T + 2000, viewer: { userId: 'u3' }, visits: 1, firstEver: true },
    { k: 'social', id: 's1', tsMs: T + 3000, viewer: { userId: 'u3' }, sub: 'follow', visits: 1, firstEver: true },
  ];

  it('csvCell: カンマ・引用符・改行は引用、数式の先頭文字は無害化', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('plain')).toBe('plain');
  });

  it('CSV: BOM + ヘッダ + 行数、種別と💎が入る', () => {
    const csv = feedToCsv(rows);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines[0]).toBe(LOG_CSV_HEADER.join(','));
    // 本文の改行(LF)は引用の中なので CRLF 分割では増えない
    expect(lines.length).toBe(1 + rows.length);
    expect(csv).toContain('"\'=SUM(1)\n改行"');
    expect(csv).toContain(',ギフト,ゆな,,バラ,5655,8,8,1,1');
    expect(csv).toContain(',フォロー,');
  });

  it('JSON: 形式と件数', () => {
    const j = JSON.parse(feedToJson(rows, { roomId: 'r1', host: 'metafact8', exportedAt: new Date(T) }));
    expect(j).toMatchObject({ format: 'tiktok-live-pocket-log', roomId: 'r1', host: 'metafact8', count: 4 });
    expect(j.items[1]).toMatchObject({ kind: 'gift', giftName: 'Rose', count: 8, diamonds: 8, firstEver: true });
    expect(j.items[3].kind).toBe('follow');
  });
});
