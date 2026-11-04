import strings from '@i18n';
import { beep, setVolume, unlockAudio, type BeepName } from '../audio';
import { formatClock } from '../engine/format';
import {
  addRound,
  createTimer,
  cues,
  markDone,
  pause,
  project,
  reconcile,
  resume,
  start,
  type EngineState,
  type TimerView,
} from '../engine/timer';
import { fill } from '../fill';
import { presentStored } from '../reflow';
import { workoutHash } from '../hash';
import { getMeta, getWod, listWods, putWod, setMeta } from '../db';
import { registerSW } from '../pwa';
import type { Format, Result, TimerConfig, Wod } from '../types';
import { releaseWake, requestWake, vibrate, wakeSupported } from '../wake';

registerSW();

const format = (document.body.dataset.format || 'fortime') as Format;
const lang = document.body.dataset.lang === 'fr' ? 'fr' : 'en';
void setMeta('lang', lang).catch(() => undefined);

const setup = must<HTMLElement>('#setup');
const run = must<HTMLElement>('#run');
const form = must<HTMLFormElement>('#setup-form');
const clock = must<HTMLElement>('#clock');
const label = must<HTMLElement>('#label');
const sub = must<HTMLElement>('#sub');
const live = must<HTMLElement>('#live');
const startBtn = must<HTMLButtonElement>('#start');
const pauseBtn = must<HTMLButtonElement>('#pause');
const doneBtn = must<HTMLButtonElement>('#done');
const plusBtn = must<HTMLButtonElement>('#plus');
const hits = must<HTMLElement>('#rounds-hit');
const soundBtn = must<HTMLButtonElement>('#sound');
const volume = must<HTMLInputElement>('#volume');
const fullBtn = must<HTMLButtonElement>('#full');
const modifyBtn = must<HTMLButtonElement>('#modify');
const wakeNote = must<HTMLElement>('#wake-note');
const resultForm = must<HTMLFormElement>('#result-form');
const summary = must<HTMLElement>('#result-summary');
const fieldRounds = must<HTMLElement>('#field-rounds');
const fieldReps = must<HTMLElement>('#field-reps');
const saveStatus = must<HTMLElement>('#save-status');
const wodNow = document.querySelector<HTMLElement>('#wod-now');
const nameEl = document.querySelector<HTMLElement>('#wod-name');
const textEl = document.querySelector<HTMLElement>('#wod-text');

let engine: EngineState = createTimer(format, {});
let config: TimerConfig = {};
let prev: TimerView | null = null;
let lastClock = '';
let lastLive = '';
let sound = true;
let tick = 0;
let wodId = '';
let displayName = '';

function must<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(selector);
  return node;
}

function intParam(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw == null || !/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fieldInt(data: FormData, key: string): number | null {
  const raw = String(data.get(key) ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function configFromQuery(params: URLSearchParams): TimerConfig | null {
  const next: TimerConfig = {};
  const prep = intParam(params, 'prep');
  if (prep != null) next.prepSec = clamp(prep, 0, 120);
  if (format === 'fortime') {
    if (params.get('open') === '1') return next;
    const cap = intParam(params, 'cap');
    if (cap == null) return null;
    next.capSec = clamp(cap, 1, 86_400);
    return next;
  }
  if (format === 'amrap') {
    const minutes = intParam(params, 'min');
    if (minutes == null) return null;
    next.durationSec = clamp(minutes, 1, 1440) * 60;
    return next;
  }
  if (format === 'emom') {
    const rounds = intParam(params, 'min');
    const interval = intParam(params, 'int');
    if (rounds == null && interval == null) return null;
    next.rounds = clamp(rounds ?? 10, 1, 500);
    next.intervalSec = clamp(interval ?? 60, 1, 3600);
    return next;
  }
  if (format === 'tabata') {
    const work = intParam(params, 'work');
    const rest = intParam(params, 'rest');
    const rounds = intParam(params, 'rounds');
    const sets = intParam(params, 'sets');
    const setRest = intParam(params, 'setrest');
    if (work == null && rest == null && rounds == null && sets == null && setRest == null) return null;
    next.workSec = clamp(work ?? 20, 1, 3600);
    next.restSec = clamp(rest ?? 10, 0, 3600);
    next.rounds = clamp(rounds ?? 8, 1, 500);
    if (sets != null) next.sets = clamp(sets, 1, 40);
    if (setRest != null) next.setRestSec = clamp(setRest, 0, 3600);
    return next;
  }
  return null;
}

function configFromForm(data: FormData): TimerConfig {
  const next: TimerConfig = {};
  const prep = fieldInt(data, 'prep');
  if (prep != null) next.prepSec = clamp(prep, 0, 120);
  if (format === 'fortime') {
    const cap = fieldInt(data, 'capMin');
    if (cap) next.capSec = clamp(cap, 1, 1440) * 60;
  } else if (format === 'amrap') {
    next.durationSec = clamp(fieldInt(data, 'minutes') ?? 20, 1, 1440) * 60;
  } else if (format === 'emom') {
    next.rounds = clamp(fieldInt(data, 'rounds') ?? 10, 1, 500);
    next.intervalSec = clamp(fieldInt(data, 'interval') ?? 60, 1, 3600);
  } else if (format === 'tabata') {
    next.workSec = clamp(fieldInt(data, 'work') ?? 20, 1, 3600);
    next.restSec = clamp(fieldInt(data, 'rest') ?? 10, 0, 3600);
    next.rounds = clamp(fieldInt(data, 'rounds') ?? 8, 1, 500);
    const sets = fieldInt(data, 'sets');
    const setRest = fieldInt(data, 'setRest');
    if (sets) next.sets = clamp(sets, 1, 40);
    if (setRest != null) next.setRestSec = clamp(setRest, 0, 3600);
  }
  return next;
}

function writeUrl(): void {
  const params = new URLSearchParams();
  if (displayName) params.set('name', displayName);
  if (wodId) params.set('wod', wodId);
  if (config.prepSec != null) params.set('prep', String(config.prepSec));
  if (format === 'fortime') {
    if (config.capSec) params.set('cap', String(config.capSec));
    else params.set('open', '1');
  } else if (format === 'amrap') params.set('min', String(Math.round((config.durationSec ?? 0) / 60)));
  else if (format === 'emom') {
    params.set('min', String(config.rounds ?? 10));
    params.set('int', String(config.intervalSec ?? 60));
  } else if (format === 'tabata') {
    params.set('work', String(config.workSec ?? 20));
    params.set('rest', String(config.restSec ?? 10));
    params.set('rounds', String(config.rounds ?? 8));
    if (config.sets != null) params.set('sets', String(config.sets));
    if (config.setRestSec != null) params.set('setrest', String(config.setRestSec));
  }
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

function fillForm(): void {
  const set = (name: string, value: number | undefined): void => {
    const input = form.elements.namedItem(name);
    if (input instanceof HTMLInputElement && value != null) input.value = String(value);
  };
  set('prep', config.prepSec ?? 10);
  if (config.capSec) set('capMin', Math.round(config.capSec / 60));
  if (config.durationSec) set('minutes', Math.round(config.durationSec / 60));
  set('rounds', config.rounds);
  set('interval', config.intervalSec);
  set('work', config.workSec);
  set('rest', config.restSec);
  set('sets', config.sets);
  set('setRest', config.setRestSec);
}

function showRun(): void {
  setup.hidden = true;
  run.hidden = false;
  resultForm.hidden = true;
  engine = createTimer(format, config);
  prev = null;
  lastClock = '';
  render();
}

function play(cue: import('../engine/timer').Beep): void {
  if (sound) beep(cue as BeepName);
  const pattern = cue === 'end' ? [180, 80, 180] : cue === 'low' ? [70] : cue === 'high' ? [20, 30, 20] : [30];
  vibrate(pattern);
}

function liveMessage(view: TimerView): string {
  if (view.phase === 'idle') return '';
  if (view.phase === 'prep') return strings.timer.announcePrep;
  if (view.phase === 'paused') return strings.timer.announcePaused;
  if (view.phase === 'finished') return strings.timer.announceDone;
  let message = strings.timer.announceRunning;
  if (view.segmentKind === 'work') message = fill(strings.timer.announceWork, { round: view.round, rounds: view.rounds });
  else if (view.segmentKind === 'rest') message = fill(strings.timer.announceRest, { round: view.round, rounds: view.rounds });
  else if (view.segmentKind === 'setrest') message = strings.timer.announceSetRest;
  else if (view.format === 'emom' && view.phase === 'running') message = fill(strings.timer.announceRound, { round: view.round, rounds: view.rounds });
  if (view.format === 'amrap' && view.roundsHit > 0) {
    const template = view.roundsHit === 1 ? strings.timer.announceHitsOne : strings.timer.announceHits;
    message = `${message}. ${fill(template, { n: view.roundsHit })}`;
  }
  return message;
}

function phaseLabel(view: TimerView): string {
  if (view.phase === 'prep') return strings.timer.prep;
  if (view.segmentKind === 'work') return strings.timer.work;
  if (view.segmentKind === 'rest') return strings.timer.rest;
  if (view.segmentKind === 'setrest') return strings.timer.setRest;
  if (view.phase === 'paused') return strings.timer.announcePaused;
  if (view.phase === 'finished') return strings.timer.announceDone;
  return strings.formats[format];
}

function subLabel(view: TimerView): string {
  if (view.format === 'emom' && view.round > 0) return fill(strings.timer.round, { round: view.round, rounds: view.rounds });
  if (view.format === 'tabata' && view.round > 0) {
    const base = fill(strings.timer.round, { round: view.round, rounds: view.rounds });
    return view.sets > 1 ? `${base} · ${view.set}/${view.sets}` : base;
  }
  if (view.format === 'fortime' && config.capSec) return fill(strings.timer.cap, { time: formatClock(config.capSec * 1000, 'up') });
  return '';
}

function paint(view: TimerView): void {
  const text = formatClock(view.displayMs, view.clock);
  if (text !== lastClock) {
    clock.textContent = text;
    lastClock = text;
  }
  label.textContent = phaseLabel(view);
  sub.textContent = subLabel(view);
  document.body.dataset.segment = view.phase === 'idle' ? '' : view.segmentKind;
  document.body.classList.toggle('is-running', view.phase === 'prep' || view.phase === 'running' || view.phase === 'paused');
  startBtn.hidden = view.phase !== 'idle';
  pauseBtn.hidden = view.phase !== 'running' && view.phase !== 'prep' && view.phase !== 'paused';
  pauseBtn.textContent = view.phase === 'paused' ? strings.timer.resume : strings.timer.pause;
  doneBtn.hidden = view.phase !== 'running' && view.phase !== 'paused' && view.phase !== 'prep';
  plusBtn.hidden = format !== 'amrap' || (view.phase !== 'running' && view.phase !== 'paused');
  resultForm.hidden = view.phase !== 'finished';
  const showHits = format === 'amrap' && view.phase !== 'idle';
  hits.hidden = !showHits;
  if (showHits) {
    const template = view.roundsHit === 1 ? strings.timer.hitsOne : strings.timer.hits;
    hits.textContent = fill(template, { n: new Intl.NumberFormat(lang).format(view.roundsHit) });
  }
  const message = liveMessage(view);
  if (message !== lastLive) {
    live.textContent = message;
    lastLive = message;
  }
  if (view.phase === 'finished') {
    summary.textContent = formatClock(view.workoutMs, 'up');
    fieldRounds.hidden = view.format !== 'amrap';
    fieldReps.hidden = view.format !== 'amrap' && view.finishedReason !== 'cap';
  }
}

function render(): void {
  const now = performance.now();
  engine = reconcile(engine, now);
  const view = project(engine, now);
  if (prev) for (const cue of cues(prev, view)) play(cue);
  prev = view;
  paint(view);
  if (view.phase === 'finished') {
    stopTicking();
    releaseWake();
  }
}

function startTicking(): void {
  if (tick) return;
  tick = window.setInterval(render, 100);
}

function stopTicking(): void {
  if (!tick) return;
  window.clearInterval(tick);
  tick = 0;
}

async function keepAwake(): Promise<void> {
  if (!wakeSupported()) {
    wakeNote.hidden = false;
    return;
  }
  const ok = await requestWake();
  wakeNote.hidden = ok;
}

function onStart(): void {
  unlockAudio();
  const now = performance.now();
  if (project(engine, now).phase === 'finished') {
    engine = createTimer(format, config);
    prev = project(engine, now);
  }
  if (project(engine, now).phase === 'idle') engine = start(engine, performance.now());
  void keepAwake();
  render();
  startTicking();
}

function onPause(): void {
  const now = performance.now();
  const view = project(engine, now);
  if (view.phase === 'paused') {
    engine = resume(engine, now);
    void keepAwake();
    startTicking();
  } else if (view.phase === 'running' || view.phase === 'prep') {
    engine = pause(engine, now);
    releaseWake();
  }
  render();
}

function describe(): string {
  if (format === 'amrap') return `AMRAP ${Math.round((config.durationSec ?? 0) / 60)}`;
  if (format === 'emom') return `EMOM ${config.rounds ?? 0} × ${config.intervalSec ?? 60}s`;
  if (format === 'tabata') return `Tabata ${config.workSec ?? 20}/${config.restSec ?? 10} × ${config.rounds ?? 8}`;
  if (config.capSec) return `For Time cap ${formatClock(config.capSec * 1000, 'up')}`;
  return strings.formats[format];
}

async function saveResult(view: TimerView): Promise<void> {
  const data = new FormData(resultForm);
  const rounds = String(data.get('rounds') ?? '').trim();
  const reps = String(data.get('reps') ?? '').trim();
  const note = String(data.get('note') ?? '').trim();
  const at = new Date().toISOString();
  let result: Result;
  if (view.format === 'amrap' || (view.finishedReason === 'cap' && (rounds || reps))) {
    const value = rounds && reps ? `${rounds}+${reps}` : rounds || reps || '0';
    result = note ? { at, kind: 'rounds', value, note } : { at, kind: 'rounds', value };
  } else if (view.format === 'fortime' || view.format === 'other') {
    const value = formatClock(view.workoutMs, 'up');
    result = note ? { at, kind: 'time', value, note } : { at, kind: 'time', value };
  } else {
    const value = formatClock(view.totalMs ?? view.workoutMs, 'up');
    result = note ? { at, kind: 'time', value, note } : { at, kind: 'time', value };
  }
  const name = displayName || describe();
  const text = name;
  try {
    if (wodId) {
      const existing = await getWod(wodId);
      if (existing && !existing.by) {
        existing.results.push(result);
        await putWod(existing);
        saveStatus.textContent = strings.timer.saved;
        return;
      }
    }
    const hash = await workoutHash(name, format, text);
    const same = (await listWods()).find((wod) => !wod.by && wod.hash === hash);
    if (same) {
      same.results.push(result);
      await putWod(same);
      wodId = same.id;
    } else {
      const wod: Wod = {
        id: crypto.randomUUID(),
        name,
        format,
        timer: config,
        text,
        createdAt: at,
        source: 'manual',
        hash,
        results: [result],
      };
      await putWod(wod);
      wodId = wod.id;
    }
    saveStatus.textContent = strings.timer.saved;
  } catch {
    saveStatus.textContent = strings.timer.saveFailed;
  }
}

function paintSound(): void {
  soundBtn.setAttribute('aria-pressed', sound ? 'true' : 'false');
}

document.addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });

form.addEventListener('submit', (event) => {
  event.preventDefault();
  config = configFromForm(new FormData(form));
  writeUrl();
  showRun();
});

startBtn.addEventListener('click', onStart);
pauseBtn.addEventListener('click', onPause);
doneBtn.addEventListener('click', () => {
  const now = performance.now();
  const before = project(engine, now).phase;
  engine = markDone(engine, now);
  if (before === 'prep' && project(engine, performance.now()).phase === 'idle') {
    stopTicking();
    releaseWake();
  }
  render();
});
plusBtn.addEventListener('click', () => {
  engine = addRound(engine, performance.now());
  render();
});
modifyBtn.addEventListener('click', () => {
  stopTicking();
  releaseWake();
  setup.hidden = false;
  run.hidden = true;
  document.body.dataset.segment = '';
});
soundBtn.addEventListener('click', () => {
  sound = !sound;
  paintSound();
  void setMeta('sound', sound);
});
volume.addEventListener('input', () => {
  const value = Number(volume.value) / 100;
  setVolume(value);
  void setMeta('volume', value);
});
fullBtn.addEventListener('click', () => {
  void (async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // The browser can refuse fullscreen.
    }
  })();
});
resultForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void saveResult(project(engine, performance.now()));
});

document.addEventListener('keydown', (event) => {
  if (event.key !== ' ') return;
  const target = event.target;
  if (target instanceof Element && target.closest('input, textarea, select, button, a')) return;
  if (run.hidden) return;
  event.preventDefault();
  onPause();
});

document.addEventListener('visibilitychange', () => {
  render();
  const phase = project(engine, performance.now()).phase;
  if (document.visibilityState === 'visible' && (phase === 'running' || phase === 'prep')) void keepAwake();
});
window.addEventListener('pageshow', () => render());

if (!('requestFullscreen' in document.documentElement)) fullBtn.hidden = true;

const params = new URLSearchParams(location.search);
wodId = params.get('wod') || '';
displayName = params.get('name') || '';

function showWod(name: string, text: string): void {
  if (!wodNow || !nameEl || !textEl) return;
  const view = presentStored({ name, format: 'other', timer: {}, text: text || name });
  const title = view.name.trim();
  const body = view.text.trim();
  nameEl.textContent = title;
  textEl.textContent = body;
  textEl.hidden = body === '';
  wodNow.hidden = title === '' && body === '';
  if (title) displayName = title;
}

showWod(displayName, '');
if (wodId) {
  void getWod(wodId).then((wod) => {
    if (wod) showWod(wod.name, wod.text);
  }).catch(() => undefined);
}
const fromUrl = configFromQuery(params);
if (fromUrl) {
  config = fromUrl;
  fillForm();
  showRun();
}

void (async () => {
  const savedSound = await getMeta('sound');
  const savedVolume = await getMeta('volume');
  if (typeof savedSound === 'boolean') sound = savedSound;
  if (typeof savedVolume === 'number') {
    setVolume(savedVolume);
    volume.value = String(Math.round(savedVolume * 100));
  }
  paintSound();
})();
