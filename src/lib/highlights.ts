import type { ArchivedRow } from './archive';
import type { FeedRow } from './feed';

export function japanDay(ms = Date.now()): string {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
}

export function dayRange(day: string): [number, number] {
  const start = Date.parse(`${day}T00:00:00+09:00`);
  return [start, start + 86400_000];
}

export function actionKey(row: Pick<ArchivedRow, 'roomId' | 'id'>): string {
  return JSON.stringify([row.roomId, row.id]);
}

export function isAction(row: FeedRow): boolean {
  return row.k === 'comment' || row.k === 'like' || row.k === 'gift' || (row.k === 'social' && row.sub === 'follow');
}

export interface HighlightMember {
  row: ArchivedRow;
  comments: number;
  likes: number;
  follows: number;
  gifts: number;
}

export function mergeDayRows(day: string, saved: ArchivedRow[], live: ArchivedRow[]): ArchivedRow[] {
  const [start, end] = dayRange(day);
  const merged = new Map<string, ArchivedRow>();
  // Merge before filtering: an updated gift may have moved to another date.
  for (const row of [...saved, ...live]) merged.set(actionKey(row), row);
  return [...merged.values()].filter(r => isAction(r) && r.tsMs >= start && r.tsMs < end)
    .sort((a, b) => b.tsMs - a.tsMs || actionKey(a).localeCompare(actionKey(b)));
}

export function highlightMembers(rows: ArchivedRow[]): HighlightMember[] {
  const members = new Map<string, HighlightMember>();
  for (const row of rows) {
    if (!isAction(row)) continue;
    let member = members.get(row.viewer.userId);
    if (!member) {
      member = { row, comments: 0, likes: 0, follows: 0, gifts: 0 };
      members.set(row.viewer.userId, member);
    }
    if (row.tsMs > member.row.tsMs) member.row = row;
    if (row.k === 'comment') member.comments++;
    if (row.k === 'like') member.likes += row.count;
    if (row.k === 'social') member.follows++;
    if (row.k === 'gift') member.gifts += row.count;
  }
  return [...members.values()].sort((a, b) => b.row.tsMs - a.row.tsMs || a.row.viewer.userId.localeCompare(b.row.viewer.userId));
}

export function japanTime(ms: number): string {
  return new Date(ms + 9 * 3600_000).toISOString().slice(11, 19);
}
