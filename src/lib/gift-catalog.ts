import type { GiftEvent } from './events';
import type { GiftCatalogRecord } from './db';

/**
 * giftId → 名前/💎/画像 のキャッシュ。
 * 連打の途中 tick や一部のメッセージは画像 URL を持たないことがあるので、
 * 一度でも見た画像をここから補う。空文字で既知の画像を潰さない。
 */
export class GiftCatalog {
  private map = new Map<string, GiftCatalogRecord>();
  private dirty = new Set<string>();

  constructor(initial: Iterable<GiftCatalogRecord> = []) {
    for (const r of initial) this.map.set(r.giftId, r);
  }

  iconOf(giftId: string): string | undefined {
    return this.map.get(giftId)?.iconUrl || undefined;
  }

  observe(e: GiftEvent, now: number): void {
    if (!e.giftId) return;
    const cur = this.map.get(e.giftId);
    const next: GiftCatalogRecord = {
      giftId: e.giftId,
      name: e.giftName || cur?.name || '',
      diamonds: e.diamondEach || cur?.diamonds || 0,
      iconUrl: e.iconUrl || cur?.iconUrl || '',
      updatedMs: now,
    };
    if (!cur || cur.name !== next.name || cur.diamonds !== next.diamonds || cur.iconUrl !== next.iconUrl) {
      this.map.set(e.giftId, next);
      this.dirty.add(e.giftId);
    }
  }

  drainDirty(): GiftCatalogRecord[] {
    const out: GiftCatalogRecord[] = [];
    for (const id of this.dirty) {
      const r = this.map.get(id);
      if (r) out.push({ ...r });
    }
    this.dirty.clear();
    return out;
  }

  get size(): number {
    return this.map.size;
  }

  all(): GiftCatalogRecord[] {
    return [...this.map.values()].map((r) => ({ ...r }));
  }

  /** バックアップから取り込む(新しい updatedMs の方を採用)。 */
  import(records: GiftCatalogRecord[]): number {
    let n = 0;
    for (const raw of records) {
      if (!raw || typeof raw !== 'object' || typeof raw.giftId !== 'string' || !raw.giftId) continue;
      const r: GiftCatalogRecord = {
        giftId: raw.giftId,
        name: typeof raw.name === 'string' ? raw.name : '',
        diamonds: Math.max(0, Number(raw.diamonds) || 0),
        iconUrl: typeof raw.iconUrl === 'string' && /^https?:\/\//.test(raw.iconUrl) ? raw.iconUrl : '',
        updatedMs: Number(raw.updatedMs) || 0,
      };
      const cur = this.map.get(r.giftId);
      if (cur && cur.updatedMs >= r.updatedMs) continue;
      this.map.set(r.giftId, r);
      this.dirty.add(r.giftId);
      n++;
    }
    return n;
  }
}
