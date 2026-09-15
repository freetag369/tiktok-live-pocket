import type { Viewer } from '../lib/events';

export function VisitBadge({ visits, firstEver }: { visits: number; firstEver: boolean }) {
  if (firstEver) return <span className="badge first">初見</span>;
  const regular = visits >= 5;
  return <span className={`badge visits${regular ? ' regular' : ''}`}>{visits}回目</span>;
}

/** ギフターレベル(入室通知に載っているときだけ)。 */
export function GradeBadge({ v }: { v: Viewer }) {
  return v.gifterLevel ? <span className="badge grade">Lv.{v.gifterLevel}</span> : null;
}

export function RoleBadges({ v }: { v: Viewer }) {
  return (
    <>
      <GradeBadge v={v} />
      {v.isModerator ? <span className="badge mod">モデ</span> : null}
      {v.isSubscriber ? <span className="badge sub">サブスク</span> : null}
    </>
  );
}
