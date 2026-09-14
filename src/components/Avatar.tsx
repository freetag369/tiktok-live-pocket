import { memo, useState } from 'react';

export const Avatar = memo(function Avatar({ url, name, enabled }: { url?: string; name?: string; enabled: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!enabled || !url || failed) {
    return <div className="avatar ph">{(name || '?').slice(0, 1)}</div>;
  }
  return <img className="avatar" src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
});

export const GiftIcon = memo(function GiftIcon({ url }: { url?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <div className="gift-icon ph">🎁</div>;
  return <img className="gift-icon" src={url} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
});
