import { describe, expect, it } from 'vitest';
import { KANA_MAX_LEN, MEMO_MAX_LEN, MemoBook, sanitizeMemo, type MemoRecord } from '../src/lib/memos';

const T = 1_785_240_000_000;

describe('MemoBook', () => {
  it('set は trim して保存し、dirty に載る', () => {
    const b = new MemoBook();
    const r = b.set('u1', { note: '  誕生日 3/4  ', kana: ' たろう ', nickname: 'たろう', uniqueId: 'taro' }, T);
    expect(r).toMatchObject({ userId: 'u1', note: '誕生日 3/4', kana: 'たろう', updatedMs: T, nickname: 'たろう', uniqueId: 'taro' });
    expect(b.get('u1')?.note).toBe('誕生日 3/4');
    const d = b.drainDirty();
    expect(d.put).toHaveLength(1);
    expect(d.del).toEqual([]);
    expect(b.drainDirty()).toEqual({ put: [], del: [] });
  });

  it('両方空なら削除され、削除待ち(del)に載る', () => {
    const b = new MemoBook([{ userId: 'u1', note: 'a', kana: '', updatedMs: T }]);
    expect(b.set('u1', { note: '  ', kana: '' }, T + 1)).toBeNull();
    expect(b.get('u1')).toBeUndefined();
    expect(b.size).toBe(0);
    expect(b.drainDirty()).toEqual({ put: [], del: ['u1'] });
    // 無い人を空で set しても何も起きない
    expect(b.set('zz', { note: '', kana: '' }, T)).toBeNull();
    expect(b.drainDirty()).toEqual({ put: [], del: [] });
  });

  it('変化が無ければ dirty にならず、view() の参照も変わらない', () => {
    const b = new MemoBook([{ userId: 'u1', note: 'a', kana: 'か', updatedMs: T }]);
    const v1 = b.view();
    b.set('u1', { note: 'a', kana: 'か' }, T + 5);
    expect(b.view()).toBe(v1);
    expect(b.drainDirty().put).toHaveLength(0);
    b.set('u1', { note: 'b', kana: 'か' }, T + 6);
    const v2 = b.view();
    expect(v2).not.toBe(v1);
    expect(v2.get('u1')?.note).toBe('b');
    expect(b.view()).toBe(v2);
  });

  it('よみがなだけでも保存できる', () => {
    const b = new MemoBook();
    expect(b.set('u1', { note: '', kana: 'さくら' }, T)).toMatchObject({ note: '', kana: 'さくら' });
  });

  it('長さは上限で丸める', () => {
    const b = new MemoBook();
    const r = b.set('u1', { note: 'x'.repeat(MEMO_MAX_LEN + 50), kana: 'y'.repeat(KANA_MAX_LEN + 5) }, T)!;
    expect(r.note).toHaveLength(MEMO_MAX_LEN);
    expect(r.kana).toHaveLength(KANA_MAX_LEN);
  });

  it('nickname を省いて set しても前の名前を保つ', () => {
    const b = new MemoBook([{ userId: 'u1', note: 'a', kana: '', updatedMs: T, nickname: 'A', uniqueId: 'a' }]);
    const r = b.set('u1', { note: 'b', kana: '' }, T + 1)!;
    expect(r.nickname).toBe('A');
    expect(r.uniqueId).toBe('a');
  });
});

describe('MemoBook.import', () => {
  const incoming: MemoRecord[] = [
    { userId: 'u1', note: '新しい', kana: '', updatedMs: T + 10 },
    { userId: 'u2', note: '追加', kana: 'に', updatedMs: T },
  ];

  it('merge: updatedMs の新しい方を採用、無い人は追加', () => {
    const b = new MemoBook([
      { userId: 'u1', note: '古い', kana: '', updatedMs: T },
      { userId: 'u3', note: '残る', kana: '', updatedMs: T },
    ]);
    expect(b.import(incoming, 'merge')).toBe(2);
    expect(b.get('u1')?.note).toBe('新しい');
    expect(b.get('u2')?.kana).toBe('に');
    expect(b.get('u3')?.note).toBe('残る');
    expect(b.drainDirty().put.map((r) => r.userId).sort()).toEqual(['u1', 'u2']);
    // 古い方を取り込んでも上書きしない
    expect(b.import([{ userId: 'u1', note: 'もっと古い', kana: '', updatedMs: T - 1 }], 'merge')).toBe(0);
    expect(b.get('u1')?.note).toBe('新しい');
  });

  it('replace: 既存を捨てて置き換え、消えた人は del に載る', () => {
    const b = new MemoBook([{ userId: 'zz', note: 'x', kana: '', updatedMs: T }]);
    b.drainDirty();
    expect(b.import(incoming, 'replace')).toBe(2);
    expect(b.all().map((r) => r.userId).sort()).toEqual(['u1', 'u2']);
    const d = b.drainDirty();
    expect(d.del).toEqual(['zz']);
    expect(d.put).toHaveLength(2);
  });

  it('壊れた行は捨てる', () => {
    const b = new MemoBook();
    expect(b.import([null, {}, { userId: 'x' }, { userId: 'ok', note: 'a' }], 'merge')).toBe(1);
    expect(b.get('ok')).toMatchObject({ note: 'a', kana: '', updatedMs: 0 });
  });
});

describe('sanitizeMemo', () => {
  it('userId 必須・note/kana 両方空は null・数値 userId は文字列に', () => {
    expect(sanitizeMemo(null)).toBeNull();
    expect(sanitizeMemo({ note: 'a' })).toBeNull();
    expect(sanitizeMemo({ userId: 'u', note: '', kana: '' })).toBeNull();
    expect(sanitizeMemo({ userId: 7, note: 'a', updatedMs: 'nope' })).toEqual({ userId: '7', note: 'a', kana: '', updatedMs: 0 });
    expect(sanitizeMemo({ userId: 'u', kana: 'か', nickname: 'N', uniqueId: '' })).toEqual({ userId: 'u', note: '', kana: 'か', updatedMs: 0, nickname: 'N' });
  });
});
