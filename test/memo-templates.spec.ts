import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MemoSheet } from '../src/components/MemoSheet';
import { MEMO_MAX_LEN, prependTemplate } from '../src/lib/memos';

describe('prependTemplate', () => {
  it('本文が空なら定型文だけ', () => {
    expect(prependTemplate('', '初見')).toBe('初見');
    expect(prependTemplate('', '  初見 ')).toBe('初見');
  });

  it('本文があれば一番最初に「、」付きで入る', () => {
    expect(prependTemplate('歌配信が好き', '初見')).toBe('初見、歌配信が好き');
    expect(prependTemplate('初見', '常連')).toBe('常連、初見');
  });

  it('定型文の末尾か本文の先頭に区切りがあれば「、」を足さない', () => {
    expect(prependTemplate('旅行の話', 'お礼を伝える /')).toBe('お礼を伝える /旅行の話');
    expect(prependTemplate('、歌配信が好き', '初見')).toBe('初見、歌配信が好き');
    expect(prependTemplate('\n2行目', '1行目')).toBe('1行目\n2行目');
  });

  it('空の定型文は何もしない。結果は上限に切り詰める', () => {
    expect(prependTemplate('そのまま', '  ')).toBe('そのまま');
    const full = 'あ'.repeat(MEMO_MAX_LEN);
    const out = prependTemplate(full, '初見');
    expect(out).toHaveLength(MEMO_MAX_LEN);
    expect(out.startsWith('初見、')).toBe(true);
  });
});

describe('MemoSheet の定型文ボタン', () => {
  const base = { target: { userId: 'u1', nickname: 'たろう' }, showAvatars: false, onSave: () => {}, onFavorite: () => {}, onClose: () => {} };

  it('空でない枠だけがメモ欄・前回欄の上に出る', () => {
    const html = renderToStaticMarkup(createElement(MemoSheet, { ...base, memoTemplates: ['初見', '', '誕生日', ''], previousTemplates: ['ギフトのお礼'] }));
    expect(html.match(/class="tplbtn"/g)).toHaveLength(3);
    expect(html).toContain('>初見</button>');
    expect(html).toContain('>誕生日</button>');
    expect(html).toContain('>ギフトのお礼</button>');
    expect(html.indexOf('>初見</button>')).toBeLessThan(html.indexOf('placeholder="例: 誕生日'));
    expect(html.indexOf('>ギフトのお礼</button>')).toBeLessThan(html.indexOf('aria-label="前回"'));
    expect(html.indexOf('>ギフトのお礼</button>')).toBeGreaterThan(html.indexOf('placeholder="例: 誕生日'));
  });

  it('定型文が無ければ列ごと出ない', () => {
    const html = renderToStaticMarkup(createElement(MemoSheet, { ...base, memoTemplates: ['', ''], previousTemplates: [] }));
    expect(html).not.toContain('msheet-tpl');
    expect(renderToStaticMarkup(createElement(MemoSheet, base))).not.toContain('tplbtn');
  });
});
