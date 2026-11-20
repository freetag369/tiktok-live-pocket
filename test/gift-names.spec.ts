import { describe, expect, it } from 'vitest';
import { japaneseGiftName } from '../src/lib/gift-names';

describe('ギフトの日本語名', () => {
  it('giftId で TikTok LIVE の日本語名に直す', () => {
    expect(japaneseGiftName('Rose', '5655')).toBe('バラ');
    expect(japaneseGiftName('Finger Heart', '5487')).toBe('フィンガーハート');
    expect(japaneseGiftName("You're awesome", '15232')).toBe('素晴らしい');
  });

  it('giftId が無い・知らないときは英語名で引く', () => {
    expect(japaneseGiftName('Doughnut')).toBe('ドーナッツ');
    expect(japaneseGiftName('  ice_cream cone ', '0')).toBe('ソフトクリーム');
  });

  it('一覧に無いギフトは届いた名前のまま出す', () => {
    expect(japaneseGiftName('Brand New Gift', '99999999')).toBe('Brand New Gift');
    expect(japaneseGiftName('おやすみトッポ', '76637')).toBe('おやすみトッポ');
    expect(japaneseGiftName('', '99999999')).toBe('ギフト 99999999');
    expect(japaneseGiftName('')).toBe('ギフト');
  });
});
