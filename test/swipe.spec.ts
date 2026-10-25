import { describe, expect, it } from 'vitest';
import { judgeSwipe } from '../src/lib/swipe';

describe('judgeSwipe', () => {
  const s = { x: 100, y: 300 };
  it('右に 60px 以上で right、左で left', () => {
    expect(judgeSwipe(s, 160, 300)).toBe('right');
    expect(judgeSwipe(s, 200, 310)).toBe('right');
    expect(judgeSwipe(s, 40, 300)).toBe('left');
  });
  it('しきい値未満は null', () => {
    expect(judgeSwipe(s, 159, 300)).toBeNull();
    expect(judgeSwipe(s, 100, 300)).toBeNull();
    expect(judgeSwipe(s, 41, 300)).toBeNull();
  });
  it('縦の動きが大きければ null(縦スクロールを横取りしない)', () => {
    expect(judgeSwipe(s, 170, 360)).toBeNull(); // dx 70 < dy 60 * 1.5
    expect(judgeSwipe(s, 190, 360)).toBe('right'); // dx 90 >= 90
    expect(judgeSwipe(s, 100, 500)).toBeNull();
  });
  it('threshold を変えられる', () => {
    expect(judgeSwipe(s, 130, 300, 30)).toBe('right');
    expect(judgeSwipe(s, 130, 300)).toBeNull();
  });
});
