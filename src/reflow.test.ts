import { describe, expect, it } from 'vitest';
import { presentStored } from './reflow';
import type { TimerConfig } from './types';

describe('presentStored', () => {
  const wod = { name: 'Test', format: 'other' as const, timer: {} as TimerConfig, text: 'AMRAP 12\n10 Burpees\n15 Air squats' };
  it('gives the same answer the second time and does not share its timer with the cache', () => {
    const first = presentStored(wod);
    first.timer.durationSec = 1;
    const second = presentStored(wod);
    expect(second.format).toBe('amrap');
    expect(second.timer.durationSec).toBe(720);
  });
});
