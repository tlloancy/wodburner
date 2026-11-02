import type { Format, TimerConfig } from '../types';

export type Phase = 'idle' | 'prep' | 'running' | 'paused' | 'finished';
export type SegmentKind = 'idle' | 'prep' | 'countup' | 'countdown' | 'interval' | 'work' | 'rest' | 'setrest';
export type FinishReason = 'done' | 'cap' | 'complete' | null;
export type Beep = 'short' | 'high' | 'low' | 'end' | 'count';

export interface EngineState {
  format: Format;
  config: TimerConfig;
  phase: Phase;
  startedAt: number | null;
  pausedTotal: number;
  pauseStartedAt: number | null;
  finishedWorkoutMs: number | null;
  finishKind: 'done' | null;
  roundsHit: number;
}

export interface TimerView {
  phase: Phase;
  format: Format;
  displayMs: number;
  clock: 'up' | 'down';
  workoutMs: number;
  totalMs: number | null;
  segmentKind: SegmentKind;
  segmentId: string;
  segmentRemainingMs: number;
  round: number;
  rounds: number;
  set: number;
  sets: number;
  finishedReason: FinishReason;
  roundsHit: number;
  countdownSec: number | null;
}

interface Segment {
  kind: SegmentKind;
  id: string;
  remainingMs: number;
  round: number;
  rounds: number;
  set: number;
  sets: number;
}

export function createTimer(format: Format, config: TimerConfig = {}): EngineState {
  return {
    format,
    config: { ...config },
    phase: 'idle',
    startedAt: null,
    pausedTotal: 0,
    pauseStartedAt: null,
    finishedWorkoutMs: null,
    finishKind: null,
    roundsHit: 0,
  };
}

export function start(state: EngineState, now: number): EngineState {
  if (state.phase !== 'idle') return state;
  return {
    ...state,
    phase: 'running',
    startedAt: now,
    pausedTotal: 0,
    pauseStartedAt: null,
    finishedWorkoutMs: null,
    finishKind: null,
    roundsHit: 0,
  };
}

export function pause(state: EngineState, now: number): EngineState {
  const view = project(state, now);
  if (view.phase !== 'running' && view.phase !== 'prep') return state;
  return { ...state, phase: 'paused', pauseStartedAt: now };
}

export function resume(state: EngineState, now: number): EngineState {
  if (state.phase !== 'paused' || state.pauseStartedAt == null) return state;
  const delta = Math.max(0, now - state.pauseStartedAt);
  return { ...state, phase: 'running', pausedTotal: state.pausedTotal + delta, pauseStartedAt: null };
}

export function markDone(state: EngineState, now: number): EngineState {
  if (state.phase === 'finished') return state;
  const view = project(state, now);
  if (view.phase === 'idle' || view.phase === 'prep') return createTimer(state.format, state.config);
  if (view.phase === 'finished') return { ...state, phase: 'finished', finishedWorkoutMs: view.workoutMs, pauseStartedAt: null };
  return {
    ...state,
    phase: 'finished',
    finishedWorkoutMs: view.workoutMs,
    pauseStartedAt: null,
    finishKind: 'done',
  };
}

export function addRound(state: EngineState, now: number): EngineState {
  const view = project(state, now);
  if (view.phase !== 'running' && view.phase !== 'paused') return state;
  return { ...state, roundsHit: state.roundsHit + 1 };
}

export function reconcile(state: EngineState, now: number): EngineState {
  const view = project(state, now);
  if (view.phase === 'finished' && state.phase !== 'finished') {
    return { ...state, phase: 'finished', finishedWorkoutMs: view.workoutMs, pauseStartedAt: null };
  }
  return state;
}

export function project(state: EngineState, now: number): TimerView {
  const prep = prepMs(state.config);
  const limit = limitMs(state.format, state.config);
  const countUp = isCountUp(state.format, state.config);

  if (state.phase === 'idle' || state.startedAt == null) return idleView(state, limit, countUp);

  const active = activeMs(state, now);
  const rawWorkout = Math.max(0, active - prep);
  const pastEnd = limit != null && rawWorkout >= limit;
  const doneByUser = state.phase === 'finished' && state.finishKind === 'done';

  let phase: Phase;
  let workoutMs: number;
  let finishedReason: FinishReason;

  if (doneByUser) {
    phase = 'finished';
    workoutMs = state.finishedWorkoutMs ?? rawWorkout;
    finishedReason = 'done';
  } else if (pastEnd && limit != null) {
    phase = 'finished';
    workoutMs = limit;
    finishedReason = naturalReason(state.format, state.config);
  } else if (state.phase === 'paused') {
    phase = 'paused';
    workoutMs = rawWorkout;
    finishedReason = null;
  } else if (active < prep) {
    phase = 'prep';
    workoutMs = 0;
    finishedReason = null;
  } else {
    phase = 'running';
    workoutMs = rawWorkout;
    finishedReason = null;
  }

  const inPrep = phase === 'prep' || (phase === 'paused' && active < prep);
  const segment = inPrep ? prepSegment(Math.max(0, prep - active)) : segmentAt(state.format, state.config, workoutMs, limit, countUp);
  const clock: 'up' | 'down' = inPrep || !countUp ? 'down' : 'up';
  let displayMs: number;
  if (phase === 'finished' && !countUp) displayMs = 0;
  else if (inPrep) displayMs = Math.max(0, prep - active);
  else if (countUp) displayMs = workoutMs;
  else displayMs = segment.remainingMs;

  const cueRemaining = phase === 'finished' ? null : countUp && limit != null ? Math.max(0, limit - workoutMs) : clock === 'down' ? displayMs : null;

  return {
    phase,
    format: state.format,
    displayMs,
    clock,
    workoutMs,
    totalMs: limit,
    segmentKind: segment.kind,
    segmentId: segment.id,
    segmentRemainingMs: segment.remainingMs,
    round: segment.round,
    rounds: segment.rounds,
    set: segment.set,
    sets: segment.sets,
    finishedReason,
    roundsHit: state.roundsHit,
    countdownSec: countdownSec(cueRemaining),
  };
}

export function cues(prev: TimerView, next: TimerView): Beep[] {
  if (next.phase === 'finished' && prev.phase !== 'finished') return ['end'];
  const out: Beep[] = [];
  let entered = false;
  if (next.segmentId !== prev.segmentId && next.phase !== 'paused' && next.phase !== 'idle') {
    const cue = entryCue(next);
    if (cue) {
      out.push(cue);
      entered = true;
    }
  }
  if (!entered && next.countdownSec != null && next.countdownSec !== prev.countdownSec) out.push('count');
  return out;
}

function entryCue(view: TimerView): Beep | null {
  if (view.phase !== 'running') return null;
  if (view.segmentKind === 'work') return 'high';
  if (view.segmentKind === 'rest' || view.segmentKind === 'setrest') return 'low';
  if (view.format === 'emom') return 'short';
  if (view.segmentKind === 'countup' || view.segmentKind === 'countdown') return 'high';
  return null;
}

function countdownSec(remaining: number | null): number | null {
  if (remaining == null) return null;
  const sec = Math.ceil(remaining / 1000);
  if (sec >= 1 && sec <= 3) return sec;
  return null;
}

function prepMs(config: TimerConfig): number {
  return Math.max(0, (config.prepSec ?? 10) * 1000);
}

function isCountUp(format: Format, config: TimerConfig): boolean {
  if (format === 'fortime') return true;
  if (format === 'other') return config.durationSec == null;
  return false;
}

function naturalReason(format: Format, config: TimerConfig): FinishReason {
  if (format === 'fortime') return 'cap';
  if (format === 'other' && config.durationSec == null) return 'cap';
  return 'complete';
}

function limitMs(format: Format, config: TimerConfig): number | null {
  if (format === 'fortime') return config.capSec != null ? config.capSec * 1000 : null;
  if (format === 'amrap') return (config.durationSec ?? 0) * 1000;
  if (format === 'emom') return (config.rounds ?? 1) * (config.intervalSec ?? 60) * 1000;
  if (format === 'tabata') return tabataParts(config).total;
  if (format === 'other') {
    if (config.durationSec != null) return config.durationSec * 1000;
    if (config.capSec != null) return config.capSec * 1000;
  }
  return null;
}

function activeMs(state: EngineState, now: number): number {
  if (state.startedAt == null) return 0;
  return Math.max(0, frozenNow(state, now) - state.startedAt - state.pausedTotal);
}

function frozenNow(state: EngineState, now: number): number {
  if (state.phase === 'paused' && state.pauseStartedAt != null) return state.pauseStartedAt;
  if (state.phase === 'finished' && state.finishKind === 'done' && state.startedAt != null && state.finishedWorkoutMs != null) {
    return state.startedAt + state.pausedTotal + prepMs(state.config) + state.finishedWorkoutMs;
  }
  return now;
}

function idleView(state: EngineState, limit: number | null, countUp: boolean): TimerView {
  let displayMs = 0;
  let clock: 'up' | 'down' = countUp ? 'up' : 'down';
  if (state.format === 'emom') displayMs = (state.config.intervalSec ?? 60) * 1000;
  else if (state.format === 'tabata') displayMs = (state.config.workSec ?? 20) * 1000;
  else if (!countUp) displayMs = limit ?? 0;
  const parts = state.format === 'tabata' ? tabataParts(state.config) : null;
  return {
    phase: 'idle',
    format: state.format,
    displayMs,
    clock,
    workoutMs: 0,
    totalMs: limit,
    segmentKind: 'idle',
    segmentId: 'idle',
    segmentRemainingMs: displayMs,
    round: 0,
    rounds: state.format === 'emom' ? (state.config.rounds ?? 1) : parts?.rounds ?? 0,
    set: 0,
    sets: parts?.sets ?? 0,
    finishedReason: null,
    roundsHit: state.roundsHit,
    countdownSec: null,
  };
}

function prepSegment(remainingMs: number): Segment {
  return { kind: 'prep', id: 'prep', remainingMs, round: 0, rounds: 0, set: 0, sets: 0 };
}

function segmentAt(format: Format, config: TimerConfig, workoutMs: number, limit: number | null, countUp: boolean): Segment {
  if (format === 'emom') return emomSegment(config, workoutMs);
  if (format === 'tabata') return tabataSegment(config, workoutMs);
  if (countUp) {
    const remaining = limit == null ? 0 : Math.max(0, limit - workoutMs);
    return { kind: 'countup', id: 'countup', remainingMs: remaining, round: 0, rounds: 0, set: 0, sets: 0 };
  }
  const remaining = limit == null ? 0 : Math.max(0, limit - workoutMs);
  return { kind: 'countdown', id: 'countdown', remainingMs: remaining, round: 0, rounds: 0, set: 0, sets: 0 };
}

function emomSegment(config: TimerConfig, workoutMs: number): Segment {
  const interval = Math.max(1, (config.intervalSec ?? 60) * 1000);
  const rounds = Math.max(1, config.rounds ?? 1);
  const total = interval * rounds;
  const done = workoutMs >= total;
  const round = done ? rounds : Math.floor(workoutMs / interval) + 1;
  const end = round * interval;
  const remaining = done ? 0 : end - workoutMs;
  return { kind: 'interval', id: `interval:${round}`, remainingMs: remaining, round, rounds, set: 1, sets: 1 };
}

interface TabataParts {
  work: number;
  rest: number;
  rounds: number;
  sets: number;
  setRest: number;
  roundLen: number;
  setLen: number;
  total: number;
}

function tabataParts(config: TimerConfig): TabataParts {
  const work = Math.max(0, (config.workSec ?? 20) * 1000);
  const rest = Math.max(0, (config.restSec ?? 10) * 1000);
  const rounds = Math.max(1, config.rounds ?? 8);
  const sets = Math.max(1, config.sets ?? 1);
  const setRest = Math.max(0, (config.setRestSec ?? 0) * 1000);
  const roundLen = work + rest;
  const setLen = rounds * roundLen;
  const total = sets * setLen + Math.max(0, sets - 1) * setRest;
  return { work, rest, rounds, sets, setRest, roundLen, setLen, total };
}

function tabataSegment(config: TimerConfig, workoutMs: number): Segment {
  const p = tabataParts(config);
  if (p.roundLen <= 0 || p.total <= 0) {
    return { kind: 'work', id: 'work:1:1', remainingMs: 0, round: 1, rounds: p.rounds, set: 1, sets: p.sets };
  }
  const t = workoutMs >= p.total ? p.total - 1 : Math.max(0, workoutMs);
  let cursor = 0;
  for (let set = 1; set <= p.sets; set++) {
    if (t < cursor + p.setLen) {
      const into = t - cursor;
      const round = Math.floor(into / p.roundLen) + 1;
      const intoRound = into - (round - 1) * p.roundLen;
      const roundStart = cursor + (round - 1) * p.roundLen;
      if (intoRound < p.work) {
        const end = roundStart + p.work;
        return { kind: 'work', id: `work:${set}:${round}`, remainingMs: Math.max(0, end - workoutMs), round, rounds: p.rounds, set, sets: p.sets };
      }
      const end = roundStart + p.roundLen;
      return { kind: 'rest', id: `rest:${set}:${round}`, remainingMs: Math.max(0, end - workoutMs), round, rounds: p.rounds, set, sets: p.sets };
    }
    cursor += p.setLen;
    if (set < p.sets) {
      if (t < cursor + p.setRest) {
        const end = cursor + p.setRest;
        return { kind: 'setrest', id: `setrest:${set}`, remainingMs: Math.max(0, end - workoutMs), round: p.rounds, rounds: p.rounds, set, sets: p.sets };
      }
      cursor += p.setRest;
    }
  }
  return { kind: 'rest', id: `rest:${p.sets}:${p.rounds}`, remainingMs: 0, round: p.rounds, rounds: p.rounds, set: p.sets, sets: p.sets };
}
