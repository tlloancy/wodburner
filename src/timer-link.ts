import type { Format, TimerConfig } from './types';

export function timerHref(lang: string, format: Format, timer: TimerConfig, name?: string): string {
  const q = new URLSearchParams();
  if (name) q.set('name', name);
  if (timer.prepSec != null) q.set('prep', String(timer.prepSec));
  if (format === 'amrap' || (format === 'other' && timer.durationSec != null)) {
    q.set('min', String(Math.max(1, Math.round((timer.durationSec ?? 60) / 60))));
    return `/${lang}/timers/amrap/?${q}`;
  }
  if (format === 'emom') {
    q.set('min', String(timer.rounds ?? 1));
    q.set('int', String(timer.intervalSec ?? 60));
    return `/${lang}/timers/emom/?${q}`;
  }
  if (format === 'tabata') {
    q.set('work', String(timer.workSec ?? 20));
    q.set('rest', String(timer.restSec ?? 10));
    q.set('rounds', String(timer.rounds ?? 8));
    if (timer.sets != null) q.set('sets', String(timer.sets));
    if (timer.setRestSec != null) q.set('setrest', String(timer.setRestSec));
    return `/${lang}/timers/tabata/?${q}`;
  }
  if (timer.capSec != null && timer.capSec > 0) q.set('cap', String(timer.capSec));
  else q.set('open', '1');
  return `/${lang}/timers/for-time/?${q}`;
}
