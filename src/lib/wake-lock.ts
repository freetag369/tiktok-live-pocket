/**
 * 画面スリープ防止(Screen Wake Lock API・iOS 16.4+ の Safari で利用可)。
 * バックグラウンドに行くと自動解放されるので、前面復帰で取り直す。
 */
type Sentinel = { release(): Promise<void>; addEventListener(type: 'release', fn: () => void): void };

let sentinel: Sentinel | null = null;
let wanted = false;

function api(): { request(type: 'screen'): Promise<Sentinel> } | null {
  const n = navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } };
  return n.wakeLock ?? null;
}

export function wakeLockSupported(): boolean {
  return api() != null;
}

export async function setWakeLock(on: boolean): Promise<void> {
  wanted = on;
  if (!on) {
    const s = sentinel;
    sentinel = null;
    if (s) {
      try {
        await s.release();
      } catch {
        /* ignore */
      }
    }
    return;
  }
  await acquire();
}

async function acquire(): Promise<void> {
  const w = api();
  if (!w || sentinel || document.visibilityState !== 'visible') return;
  try {
    const s = await w.request('screen');
    sentinel = s;
    s.addEventListener('release', () => {
      if (sentinel === s) sentinel = null;
    });
  } catch {
    /* 低電力モード等で拒否される — 静かに諦める */
  }
}

let installed = false;
export function installWakeLockRefresh(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted) void acquire();
  });
}
