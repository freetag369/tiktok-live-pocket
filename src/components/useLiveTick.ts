import { useEffect, useReducer } from 'react';

/**
 * 「連打中」の表示を時間切れで消すための再描画フック。
 * `nextExpiryMs`(次に何かが切れる時刻)に 1 回だけタイマーを張り、切れたら再描画する。
 * 早く発火して(まだ切れていなくて)も tick 依存で張り直すので収束する。何も無ければ止まる。
 * iOS でバックグラウンドに回ると止まるが、復帰時に 1 回発火して古いものを消す。
 */
export function useLiveTick(nextExpiryMs: number | null): number {
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (nextExpiryMs == null) return;
    const t = setTimeout(bump, Math.max(30, nextExpiryMs - Date.now() + 20));
    return () => clearTimeout(t);
  }, [nextExpiryMs, tick]);
  return tick;
}
