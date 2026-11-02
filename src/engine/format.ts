/** Whole seconds. Countdown uses ceil so 20:00 stays up for the first second. Count-up uses floor. */
export function formatClock(ms: number, clock: 'up' | 'down'): string {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const total = clock === 'down' ? Math.ceil(safe / 1000) : Math.floor(safe / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}
