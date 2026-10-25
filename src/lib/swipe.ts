/**
 * 人物シートの横スワイプ判定。開始点からの移動量だけで決める純粋関数(DOM に依らない)。
 *
 *  - 横に threshold px 以上動き、かつ横の動きが縦の 1.5 倍以上なら 'right'(指が左→右)/ 'left'。
 *  - それ以外(縦スクロール中・まだ短い)は null。
 */
export interface SwipeStart {
  x: number;
  y: number;
}

export type SwipeDir = 'left' | 'right';

export function judgeSwipe(start: SwipeStart, x: number, y: number, threshold = 60): SwipeDir | null {
  const dx = x - start.x;
  const dy = y - start.y;
  if (Math.abs(dx) < threshold) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx > 0 ? 'right' : 'left';
}
