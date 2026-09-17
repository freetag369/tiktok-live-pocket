import { useEffect, useState } from 'react';
import { followToastLabel, type FollowToast as FollowToastState } from '../lib/follow-toast';
import { Avatar } from './Avatar';

interface Props {
  toast: FollowToastState;
  showAvatars: boolean;
  onDone: () => void;
}

const LEAVE_MS = 220;

/** 画面上部に出るフォロー通知。期限が来る(またはタップ)と滑り上がって消える。 */
export function FollowToast({ toast, showAvatars, onDone }: Props) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    setLeaving(false);
    const t = setTimeout(() => setLeaving(true), Math.max(0, toast.untilMs - Date.now()));
    return () => clearTimeout(t);
  }, [toast.id, toast.untilMs]);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onDone, LEAVE_MS);
    return () => clearTimeout(t);
  }, [leaving, onDone]);

  const last = toast.names[toast.names.length - 1];
  return (
    <div className={`follow-toast${leaving ? ' leaving' : ''}`} role="status" aria-live="polite" onClick={() => setLeaving(true)}>
      <Avatar url={toast.avatarUrl} name={last} enabled={showAvatars} />
      <div className="body">
        <div className="kicker">♥ FOLLOW</div>
        <div className="msg">
          <span className="who">{followToastLabel(toast.names)}</span>
          <span>がフォローしました</span>
          {toast.firstEver ? <span className="badge first">初見</span> : null}
        </div>
      </div>
    </div>
  );
}
