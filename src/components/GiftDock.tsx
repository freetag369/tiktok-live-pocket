import { useLayoutEffect, useRef } from 'react';
import type { FeedRow, GiftRow } from '../lib/feed';
import { hhmm, num } from '../lib/format';
import { japaneseGiftName } from '../lib/gift-names';
import { displayName } from '../lib/names';
import { GiftIcon } from './Avatar';

interface Props {
  /** ギフト(古い順)。feed.ts の dockGifts で絞ったもの。 */
  rows: GiftRow[];
  /** この💎以上のギフトを金色で強調する(フィードと同じ設定)。 */
  bigGiftDiamonds: number;
  isFavorite?: (userId: string) => boolean;
  /** メモに書いた呼び方(よみがな)。名前のすぐ後ろに出す(名前が長くても呼び方は切らない)。 */
  kanaFor?: (userId: string) => string | undefined;
  onTapRow?: (row: FeedRow) => void;
}

/**
 * 下の固定枠の右の列「ギフト」。すべて・コメントタブでは、ギフトは上のフィードに流さずここに出す。
 * 枠の高さ(入室 5 行ぶん)に 3 件ぶんのカードが見える。新着は下に積まれ、連打は同じカードの ×N が伸びる。
 * 古い分は列の中を上へスクロールして見る(全部はギフトタブで)。
 */
export function GiftDock({ rows, bigGiftDiamonds, isFavorite, kanaFor, onTapRow }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows]);

  return (
    <section className="dock-col dock-gifts" aria-label="ギフト">
      <div className="dock-title">
        ギフト
        {rows.length > 0 ? <span className="n">{rows.length}</span> : null}
      </div>
      <div ref={ref} className="dock-list">
        <div className="dock-inner">
          {rows.length === 0 ? <div className="dock-empty">ギフトはここに出ます</div> : null}
          {rows.map((r) => {
            const v = r.viewer;
            const name = displayName(v);
            const kana = kanaFor?.(v.userId);
            const big = bigGiftDiamonds > 0 && r.diamonds >= bigGiftDiamonds;
            const cls = `dock-gift${big ? ' big' : ''}${r.firstEver ? ' first' : ''}${isFavorite?.(v.userId) ? ' fav' : ''}${onTapRow ? ' tappable' : ''}`;
            return (
              <div key={r.id} className={cls} data-id={r.id} onClick={onTapRow ? () => onTapRow(r) : undefined}>
                <GiftIcon url={r.iconUrl} />
                <div className="body">
                  <div className="head">
                    <span className="who">{name}</span>
                    {kana ? <span className="kana">({kana})</span> : null}
                    <span className="time">{hhmm(r.tsMs)}</span>
                  </div>
                  <div className="gift-line">
                    <span className="gift-name">{japaneseGiftName(r.giftName, r.giftId)}</span>
                    {r.count > 1 || r.streaking ? (
                      <span key={r.count} className={`gift-cnt${r.streaking ? ' streak' : ''}`}>
                        ×{r.count}
                      </span>
                    ) : null}
                    <span className="gift-dia">{num(r.diamonds)}💎</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
