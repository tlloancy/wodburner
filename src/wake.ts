let sentinel: WakeLockSentinel | null = null;

export function wakeSupported(): boolean {
  return 'wakeLock' in navigator;
}

export async function requestWake(): Promise<boolean> {
  if (!wakeSupported()) return false;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    return true;
  } catch {
    return false;
  }
}

export function releaseWake(): void {
  const current = sentinel;
  sentinel = null;
  if (current) void current.release();
}

export function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some browsers expose vibrate and then throw.
  }
}
