import { describe, expect, it } from 'vitest';
import { addRound, createTimer, cues, markDone, pause, project, resume, start } from './timer';
import { formatClock } from './format';
import type { Format, TimerConfig } from '../types';

describe('formatClock', () => {
  it('formats count-up and countdown', () => {
    expect(formatClock(0, 'up')).toBe('00:00');
    expect(formatClock(999, 'up')).toBe('00:00');
    expect(formatClock(1000, 'up')).toBe('00:01');
    expect(formatClock(90_000, 'up')).toBe('01:30');
    expect(formatClock(3_600_000, 'up')).toBe('1:00:00');
    expect(formatClock(1_200_000, 'down')).toBe('20:00');
    expect(formatClock(1_199_000, 'down')).toBe('19:59');
    expect(formatClock(0, 'down')).toBe('00:00');
  });
});

describe('for time', () => {
  it('starts in prep then runs', () => {
    const s = start(createTimer('fortime', { prepSec: 10 }), 0);
    expect(project(s, 0).phase).toBe('prep');
    expect(project(s, 9_999).phase).toBe('prep');
    expect(project(s, 10_000).phase).toBe('running');
    expect(project(s, 10_000).workoutMs).toBe(0);
    expect(project(s, 15_000).workoutMs).toBe(5_000);
  });

  it('defaults prep to 10 seconds', () => {
    const s = start(createTimer('fortime', {}), 0);
    expect(project(s, 0).phase).toBe('prep');
    expect(project(s, 10_000).phase).toBe('running');
  });

  it('pauses and resumes without drift', () => {
    let s = start(createTimer('fortime', { prepSec: 0 }), 0);
    s = pause(s, 10_000);
    expect(project(s, 40_000).workoutMs).toBe(10_000);
    expect(project(s, 40_000).phase).toBe('paused');
    s = resume(s, 40_000);
    expect(project(s, 40_000).workoutMs).toBe(10_000);
    expect(project(s, 55_000).workoutMs).toBe(25_000);
  });

  it('records the exact time on done', () => {
    let s = start(createTimer('fortime', { prepSec: 0 }), 1_000);
    s = markDone(s, 1_000 + 12 * 60_000 + 34_000);
    const view = project(s, 9_999_999);
    expect(view.phase).toBe('finished');
    expect(view.finishedReason).toBe('done');
    expect(view.workoutMs).toBe(12 * 60_000 + 34_000);
    expect(view.displayMs).toBe(12 * 60_000 + 34_000);
  });

  it('stops at the cap', () => {
    const s = start(createTimer('fortime', { prepSec: 0, capSec: 900 }), 0);
    expect(project(s, 899_000).phase).toBe('running');
    const atCap = project(s, 900_000);
    expect(atCap.phase).toBe('finished');
    expect(atCap.finishedReason).toBe('cap');
    expect(atCap.displayMs).toBe(900_000);
    expect(project(s, 1_200_000).workoutMs).toBe(900_000);
  });

  it('cancels during prep', () => {
    let s = start(createTimer('fortime', { prepSec: 10 }), 0);
    s = markDone(s, 2_000);
    expect(project(s, 2_000).phase).toBe('idle');
  });
});

describe('amrap', () => {
  it('ends exactly at durationSec', () => {
    const s = start(createTimer('amrap', { prepSec: 0, durationSec: 20 * 60 }), 0);
    expect(project(s, 20 * 60_000 - 1).phase).toBe('running');
    const done = project(s, 20 * 60_000);
    expect(done.phase).toBe('finished');
    expect(done.finishedReason).toBe('complete');
    expect(done.displayMs).toBe(0);
    expect(done.workoutMs).toBe(20 * 60_000);
  });

  it('pause and resume do not gain or lose time', () => {
    let s = start(createTimer('amrap', { prepSec: 0, durationSec: 600 }), 0);
    s = pause(s, 5_000);
    expect(project(s, 15_000).workoutMs).toBe(5_000);
    expect(project(s, 15_000).displayMs).toBe(595_000);
    s = resume(s, 15_000);
    expect(project(s, 15_000).workoutMs).toBe(5_000);
    expect(project(s, 20_000).workoutMs).toBe(10_000);
  });

  it('counts rounds without touching the clock', () => {
    let s = start(createTimer('amrap', { prepSec: 0, durationSec: 600 }), 0);
    s = addRound(s, 1_000);
    s = addRound(s, 2_000);
    expect(project(s, 3_000).roundsHit).toBe(2);
    expect(project(s, 3_000).workoutMs).toBe(3_000);
  });
});

describe('emom', () => {
  it('steps intervals, including 150 seconds', () => {
    const s = start(createTimer('emom', { prepSec: 0, intervalSec: 150, rounds: 4 }), 0);
    expect(project(s, 0).round).toBe(1);
    expect(project(s, 0).segmentRemainingMs).toBe(150_000);
    expect(project(s, 149_999).round).toBe(1);
    expect(project(s, 150_000).round).toBe(2);
    expect(project(s, 150_000).segmentRemainingMs).toBe(150_000);
    expect(project(s, 450_000).round).toBe(4);
    expect(project(s, 599_999).phase).toBe('running');
    expect(project(s, 600_000).phase).toBe('finished');
  });

  it('lands in the right interval after a clock jump', () => {
    const s = start(createTimer('emom', { prepSec: 0, intervalSec: 150, rounds: 6 }), 0);
    const view = project(s, 150_000 * 2 + 10_000);
    expect(view.round).toBe(3);
    expect(view.segmentRemainingMs).toBe(140_000);
    expect(view.phase).toBe('running');
  });
});

describe('tabata', () => {
  it('alternates 8 rounds of work and rest', () => {
    const s = start(createTimer('tabata', { prepSec: 0, workSec: 20, restSec: 10, rounds: 8 }), 0);
    for (let round = 0; round < 8; round++) {
      const t = round * 30_000;
      expect(project(s, t).segmentKind).toBe('work');
      expect(project(s, t).round).toBe(round + 1);
      expect(project(s, t + 19_999).segmentKind).toBe('work');
      expect(project(s, t + 20_000).segmentKind).toBe('rest');
    }
    expect(project(s, 239_999).phase).toBe('running');
    expect(project(s, 240_000).phase).toBe('finished');
    expect(project(s, 240_000).workoutMs).toBe(240_000);
  });

  it('inserts rest between sets', () => {
    const cfg = { prepSec: 0, workSec: 20, restSec: 10, rounds: 8, sets: 2, setRestSec: 60 };
    const s = start(createTimer('tabata', cfg), 0);
    expect(project(s, 239_999).segmentKind).toBe('rest');
    expect(project(s, 240_000).segmentKind).toBe('setrest');
    expect(project(s, 299_999).segmentKind).toBe('setrest');
    expect(project(s, 300_000).segmentKind).toBe('work');
    expect(project(s, 300_000).set).toBe(2);
    expect(project(s, 300_000).round).toBe(1);
    expect(project(s, 539_999).phase).toBe('running');
    expect(project(s, 540_000).phase).toBe('finished');
  });
});

describe('pause and clock jumps', () => {
  const cases: Array<[Format, TimerConfig, number]> = [
    ['fortime', { prepSec: 0, capSec: 600 }, 600_000],
    ['amrap', { prepSec: 0, durationSec: 600 }, 600_000],
    ['emom', { prepSec: 0, intervalSec: 60, rounds: 10 }, 600_000],
    ['emom', { prepSec: 0, intervalSec: 150, rounds: 4 }, 600_000],
    ['tabata', { prepSec: 0, workSec: 20, restSec: 10, rounds: 8 }, 240_000],
    ['tabata', { prepSec: 0, workSec: 20, restSec: 10, rounds: 8, sets: 2, setRestSec: 60 }, 540_000],
    ['other', { prepSec: 0, durationSec: 600 }, 600_000],
  ];

  it.each(cases)('%s: a 30s pause does not move the finish', (format, config, total) => {
    let s = start(createTimer(format, config), 0);
    const mid = Math.floor(total / 2);
    s = pause(s, mid);
    s = resume(s, mid + 30_000);
    const endWall = mid + 30_000 + (total - mid);
    expect(project(s, endWall - 1).phase).not.toBe('finished');
    const done = project(s, endWall);
    expect(done.phase).toBe('finished');
    expect(done.workoutMs).toBe(total);
  });

  it('a suspended tab jumps straight to the right state', () => {
    const amrap = start(createTimer('amrap', { prepSec: 0, durationSec: 60 }), 0);
    const jumped = project(amrap, 5 * 60_000);
    expect(jumped.phase).toBe('finished');
    expect(jumped.workoutMs).toBe(60_000);
    expect(jumped.displayMs).toBe(0);

    const tabata = start(createTimer('tabata', { prepSec: 0, workSec: 20, restSec: 10, rounds: 8 }), 0);
    expect(project(tabata, 25_000).segmentKind).toBe('rest');
    expect(project(tabata, 25_000).round).toBe(1);
  });
});

describe('cues', () => {
  it('beeps at the start, on 3-2-1, and when an EMOM interval changes', () => {
    const created = createTimer('emom', { prepSec: 0, intervalSec: 60, rounds: 2 });
    const running = start(created, 0);
    expect(cues(project(created, 0), project(running, 0))).toEqual(['short']);
    expect(cues(project(running, 56_000), project(running, 57_000))).toEqual(['count']);
    expect(cues(project(running, 59_000), project(running, 60_000))).toEqual(['short']);
    expect(cues(project(running, 119_000), project(running, 120_000))).toEqual(['end']);
  });

  it('uses a high beep for work and a low beep for rest', () => {
    const s = start(createTimer('tabata', { prepSec: 10, workSec: 20, restSec: 10, rounds: 8 }), 0);
    expect(cues(project(s, 9_000), project(s, 10_000))).toEqual(['high']);
    expect(cues(project(s, 29_000), project(s, 30_000))).toEqual(['low']);
  });
});
