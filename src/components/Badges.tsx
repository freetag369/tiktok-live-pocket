import type { Viewer } from '../lib/events';

export function VisitBadge({ visits, firstEver }: { visits: number; firstEver: boolean }) {
  if (firstEver) return <span className="badge first">初見</span>;
  const regular = visits >= 5;
  return <span className={`badge visits${regular ? ' regular' : ''}`}>{visits}回目</span>;
}

export function RoleBadges({ v }: { v: Viewer }) {
  return (
    <>
      {v.isModerator ? <span className="badge mod">モデ</span> : null}
      {v.isSubscriber ? <span className="badge sub">サブスク</span> : null}
    </>
  );
}
