import strings from '@i18n';
import { getMeta, listWods, putWod, setMeta } from '../db';
import { workoutHash } from '../hash';
import { registerSW } from '../pwa';
import { fileToBlob, postScan, ScanError } from '../scan';
import { timerHref } from '../timer-link';
import type { Format, TimerConfig, Wod } from '../types';
import { parseTimer } from '../validate';

registerSW();
const lang = document.body.dataset.lang === 'fr' ? 'fr' : 'en';
void setMeta('lang', lang).catch(() => undefined);

const status = document.querySelector<HTMLElement>('#scan-status');
const offline = document.querySelector<HTMLElement>('#offline');
const review = document.querySelector<HTMLFormElement>('#review');
const fileInput = document.querySelector<HTMLInputElement>('#file');
const cameraInput = document.querySelector<HTMLInputElement>('#camera');
const drop = document.querySelector<HTMLElement>('#drop');
const warnings = document.querySelector<HTMLElement>('#warnings');
const confidence = document.querySelector<HTMLElement>('#confidence');
const widget = document.querySelector<HTMLElement>('#abuse-check');
const siteKey = document.body.dataset.turnstile || '';
const endpoint = `${document.body.dataset.worker || ''}/scan`;

let token = '';
let widgetId = '';
let generation = 0;
let pendingResolve: ((value: string) => void) | null = null;
let pendingReject: ((error: Error) => void) | null = null;

function say(message: string): void {
  if (status) status.textContent = message;
}

function showOffline(): void {
  if (offline) offline.hidden = navigator.onLine;
}

interface TurnstileApi {
  render: (el: HTMLElement, opts: {
    sitekey: string;
    theme: 'dark';
    appearance: 'always';
    callback: (value: string) => void;
    'expired-callback': () => void;
    'error-callback': () => void;
  }) => string;
  getResponse: (id: string) => string | undefined;
  reset: (id: string) => void;
}

function turnstileApi(): TurnstileApi | null {
  const host = window as unknown as { turnstile?: Partial<TurnstileApi> };
  const api = host.turnstile;
  if (!api || typeof api.render !== 'function' || typeof api.getResponse !== 'function' || typeof api.reset !== 'function') return null;
  return api as TurnstileApi;
}

async function ensureTurnstile(): Promise<void> {
  if (!siteKey || !widget) {
    say(strings.scan.unconfigured);
    return;
  }
  if (!turnstileApi()) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('turnstile'));
      document.head.appendChild(script);
    });
  }
  const api = turnstileApi();
  if (!api || widgetId) return;
  widgetId = api.render(widget, {
    sitekey: siteKey,
    theme: 'dark',
    appearance: 'always',
    callback: (value) => {
      token = value;
      pendingResolve?.(value);
      pendingResolve = null;
      pendingReject = null;
    },
    'expired-callback': () => {
      token = '';
    },
    'error-callback': () => {
      token = '';
      pendingReject?.(new Error('turnstile'));
      pendingResolve = null;
      pendingReject = null;
    },
  });
}

function currentToken(): string {
  const api = turnstileApi();
  if (api && widgetId) return api.getResponse(widgetId) || token;
  return token;
}

function waitForToken(gen: number): Promise<string> {
  const existing = currentToken();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (generation === gen) {
        pendingResolve = null;
        pendingReject = null;
      }
      reject(new Error('turnstile'));
    }, 60000);
    pendingResolve = (value) => {
      window.clearTimeout(timer);
      if (generation !== gen) reject(new Error('replaced'));
      else resolve(value);
    };
    pendingReject = (error) => {
      window.clearTimeout(timer);
      reject(generation === gen ? error : new Error('replaced'));
    };
  });
}

function resetTurnstile(): void {
  token = '';
  const api = turnstileApi();
  if (api && widgetId) api.reset(widgetId);
}

function readTimer(data: FormData, format: Format): TimerConfig {
  const num = (key: string): number | undefined => {
    const raw = String(data.get(key) ?? '').trim();
    if (!/^\d+$/.test(raw)) return undefined;
    return Number(raw);
  };
  const timer: TimerConfig = {};
  if (format === 'fortime') {
    const cap = num('capMin');
    if (cap) timer.capSec = cap * 60;
  } else if (format === 'amrap') {
    const minutes = num('minutes');
    if (minutes) timer.durationSec = minutes * 60;
  } else if (format === 'emom') {
    const rounds = num('rounds');
    const interval = num('interval');
    if (rounds) timer.rounds = rounds;
    if (interval) timer.intervalSec = interval;
  } else if (format === 'tabata') {
    const work = num('work');
    const rest = num('rest');
    const rounds = num('rounds');
    if (work) timer.workSec = work;
    if (rest != null) timer.restSec = rest;
    if (rounds) timer.rounds = rounds;
  }
  return parseTimer(timer);
}

function fillReview(result: { name: string; format: Format; timer: TimerConfig; text: string; confidence: string; warnings: string[] }): void {
  if (!review) return;
  const name = review.elements.namedItem('name');
  const format = review.elements.namedItem('format');
  const text = review.elements.namedItem('text');
  if (name instanceof HTMLInputElement) name.value = result.name;
  if (format instanceof HTMLSelectElement) format.value = result.format;
  if (text instanceof HTMLTextAreaElement) text.value = result.text;
  const set = (key: string, value: number | undefined, scale = 1): void => {
    const input = review.elements.namedItem(key);
    if (input instanceof HTMLInputElement) input.value = value == null ? '' : String(Math.round(value / scale));
  };
  set('capMin', result.timer.capSec, 60);
  set('minutes', result.timer.durationSec, 60);
  set('rounds', result.timer.rounds);
  set('interval', result.timer.intervalSec);
  set('work', result.timer.workSec);
  set('rest', result.timer.restSec);
  if (confidence) confidence.textContent = `${confidenceText()} ${strings.confidence[result.confidence as 'high' | 'medium' | 'low']}`;
  if (warnings) {
    warnings.replaceChildren();
    for (const warning of result.warnings) {
      const item = document.createElement('li');
      item.textContent = warning;
      warnings.append(item);
    }
  }
  review.hidden = false;
}

function confidenceText(): string {
  return document.querySelector('#confidence-label')?.textContent || '';
}

async function save(action: 'save' | 'launch'): Promise<void> {
  if (!review) return;
  const data = new FormData(review);
  const name = String(data.get('name') ?? '').trim();
  const format = String(data.get('format') ?? 'other') as Format;
  const text = String(data.get('text') ?? '');
  const timer = readTimer(data, format);
  const hash = await workoutHash(name, format, text);
  const existing = (await listWods()).find((wod) => wod.hash === hash);
  let wod: Wod;
  if (existing) wod = existing;
  else {
    wod = {
      id: crypto.randomUUID(),
      name: name || strings.untitled,
      format,
      timer,
      text,
      createdAt: new Date().toISOString(),
      source: 'scan',
      hash,
      results: [],
    };
    await putWod(wod);
  }
  if (action === 'launch') {
    const href = new URL(timerHref(lang, wod.format, wod.timer, wod.name), location.origin);
    href.searchParams.set('wod', wod.id);
    location.assign(`${href.pathname}${href.search}`);
    return;
  }
  const reviewStatus = document.querySelector<HTMLElement>('#review-status');
  if (reviewStatus) reviewStatus.textContent = strings.scan.saved;
  else say(strings.scan.saved);
}

async function run(file: File): Promise<void> {
  const gen = ++generation;
  if (!navigator.onLine) {
    say(strings.scan.offline);
    showOffline();
    return;
  }
  if (!siteKey) {
    say(strings.scan.unconfigured);
    return;
  }
  try {
    await ensureTurnstile();
    if (generation !== gen) return;
    let turnstile = currentToken();
    if (!turnstile) {
      say(strings.scan.turnstileWait);
      turnstile = await waitForToken(gen);
    }
    if (generation !== gen) return;
    say(strings.scan.preparing);
    const blob = await fileToBlob(file);
    if (generation !== gen) return;
    say(strings.scan.sending);
    const license = await getMeta('license');
    const result = await postScan(blob, {
      endpoint,
      turnstileToken: turnstile,
      ...(typeof license === 'string' && license ? { license } : {}),
    });
    if (generation !== gen) return;
    fillReview(result);
    say('');
    resetTurnstile();
  } catch (error) {
    if (generation !== gen) return;
    if (error instanceof Error && error.message === 'replaced') return;
    if (error instanceof Error && error.message === 'turnstile') {
      say(strings.scan.turnstileWait);
      return;
    }
    resetTurnstile();
    if (error instanceof ScanError) {
      if (error.code === 'decode') say(strings.scan.decode);
      else if (error.code === 'size') say(strings.scan.size);
      else if (error.code === 'network') say(strings.scan.network);
      else if (error.code === 'invalid') say(strings.scan.invalid);
      else say(error.detail || strings.scan.failed);
      return;
    }
    say(strings.scan.failed);
  }
}

function watchFile(input: HTMLInputElement | null): void {
  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) void run(file);
  });
}

watchFile(fileInput);
watchFile(cameraInput);
drop?.addEventListener('dragover', (event) => event.preventDefault());
drop?.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) void run(file);
});
review?.addEventListener('submit', (event) => {
  event.preventDefault();
  const submitter = (event as SubmitEvent).submitter;
  const action = submitter instanceof HTMLButtonElement && submitter.value === 'launch' ? 'launch' : 'save';
  void save(action);
});

window.addEventListener('offline', showOffline);
window.addEventListener('online', showOffline);
showOffline();
void ensureTurnstile().catch(() => say(strings.scan.unconfigured));
