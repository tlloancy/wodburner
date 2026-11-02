import strings from '@i18n';
import { clearAll, deleteWod, getWod, listWods, putWod, replaceWods, setMeta } from '../db';
import { fill } from '../fill';
import { workoutHash } from '../hash';
import { registerSW } from '../pwa';
import { timerHref } from '../timer-link';
import { exportDocument, importDocument } from '../transfer';
import type { Format, Result, TimerConfig, Wod } from '../types';
import { parseTimer } from '../validate';

registerSW();
const lang = document.body.dataset.lang === 'fr' ? 'fr' : 'en';
void setMeta('lang', lang).catch(() => undefined);

const list = document.querySelector<HTMLElement>('#list');
const empty = document.querySelector<HTMLElement>('#empty');
const status = document.querySelector<HTMLElement>('#status');
const form = document.querySelector<HTMLFormElement>('#manual');
const formatSelect = document.querySelector<HTMLSelectElement>('#format');
const dialog = document.querySelector<HTMLDialogElement>('#confirm');
const confirmText = document.querySelector<HTMLElement>('#confirm-text');

function say(message: string): void {
  if (status) status.textContent = message;
}

function ask(message: string): Promise<boolean> {
  if (!dialog || !confirmText) return Promise.resolve(window.confirm(message));
  confirmText.textContent = message;
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        resolve(dialog.returnValue === 'ok');
      },
      { once: true },
    );
  });
}

function showFields(): void {
  const format = formatSelect?.value || 'fortime';
  document.querySelectorAll<HTMLElement>('[data-for]').forEach((node) => {
    const allowed = (node.dataset.for || '').split(' ');
    node.hidden = !allowed.includes(format);
  });
}

function readConfig(data: FormData, format: Format): TimerConfig {
  const num = (key: string): number | undefined => {
    const raw = String(data.get(key) ?? '').trim();
    if (!/^\d+$/.test(raw)) return undefined;
    return Number(raw);
  };
  const timer: TimerConfig = {};
  const prep = num('prep');
  if (prep !== undefined) timer.prepSec = prep;
  if (format === 'fortime') {
    const cap = num('capMin');
    if (cap) timer.capSec = cap * 60;
  } else if (format === 'amrap') {
    timer.durationSec = (num('minutes') ?? 20) * 60;
  } else if (format === 'emom') {
    timer.rounds = num('intervals') ?? 10;
    timer.intervalSec = num('interval') ?? 60;
  } else if (format === 'tabata') {
    timer.workSec = num('work') ?? 20;
    timer.restSec = num('rest') ?? 10;
    timer.rounds = num('tabataRounds') ?? 8;
    const sets = num('sets');
    const setRest = num('setRest');
    if (sets) timer.sets = sets;
    if (setRest !== undefined) timer.setRestSec = setRest;
  } else {
    const minutes = num('minutes');
    if (minutes) timer.durationSec = minutes * 60;
  }
  return parseTimer(timer);
}

async function draw(): Promise<void> {
  if (!list || !empty) return;
  list.replaceChildren();
  let wods: Wod[] = [];
  try {
    wods = await listWods();
  } catch {
    return;
  }
  empty.hidden = wods.length > 0;
  const when = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  for (const wod of wods) {
    const item = document.createElement('li');
    item.className = 'card';
    const title = document.createElement('h2');
    const open = document.createElement('a');
    open.href = `/${lang}/wod/#${encodeURIComponent(wod.id)}`;
    open.textContent = wod.name || strings.untitled;
    title.append(open);
    const meta = document.createElement('p');
    meta.className = 'meta';
    const time = document.createElement('time');
    time.dateTime = wod.createdAt;
    time.textContent = when.format(new Date(wod.createdAt));
    meta.append(strings.formats[wod.format], ' · ', time);
    const text = document.createElement('pre');
    text.className = 'wod-text';
    text.textContent = wod.text;
    const results = document.createElement('ul');
    results.className = 'results';
    for (const result of wod.results) {
      const row = document.createElement('li');
      row.textContent = result.note ? `${result.value} — ${result.note}` : result.value;
      results.append(row);
    }
    const actions = document.createElement('div');
    actions.className = 'actions';
    const again = document.createElement('a');
    again.className = 'btn';
    const href = new URL(timerHref(lang, wod.format, wod.timer, wod.name), location.origin);
    href.searchParams.set('wod', wod.id);
    again.href = `${href.pathname}${href.search}`;
    again.textContent = label('relaunch');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-ghost';
    remove.textContent = label('delete');
    remove.addEventListener('click', () => {
      void removeWod(wod);
    });
    actions.append(again, remove);
    const resultForm = document.createElement('form');
    resultForm.className = 'inline-result';
    const rounds = input('number', 'rounds', label('rounds'));
    const reps = input('number', 'reps', label('reps'));
    const note = input('text', 'note', label('note'));
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn';
    submit.textContent = label('addResult');
    resultForm.append(rounds, reps, note, submit);
    resultForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(resultForm);
      const roundValue = String(data.get('rounds') ?? '').trim();
      const repValue = String(data.get('reps') ?? '').trim();
      const noteValue = String(data.get('note') ?? '').trim();
      const value = roundValue && repValue ? `${roundValue}+${repValue}` : roundValue || repValue || noteValue;
      if (!value) return;
      const result: Result = {
        at: new Date().toISOString(),
        kind: roundValue || repValue ? 'rounds' : 'free',
        value,
      };
      if (noteValue && result.value !== noteValue) result.note = noteValue;
      void saveResult(wod.id, result);
    });
    item.append(title, meta, text, results, actions, resultForm);
    list.append(item);
  }
}

function label(key: 'relaunch' | 'delete' | 'addResult' | 'rounds' | 'reps' | 'note'): string {
  const node = document.querySelector<HTMLElement>(`[data-label="${key}"]`);
  return node?.textContent || key;
}

function input(type: string, name: string, text: string): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.textContent = text;
  const field = document.createElement('input');
  field.type = type;
  field.name = name;
  if (type === 'number') {
    field.min = '0';
    field.inputMode = 'numeric';
  }
  field.maxLength = 200;
  wrap.append(field);
  return wrap;
}

async function saveResult(id: string, result: Result): Promise<void> {
  const wod = await getWod(id);
  if (!wod) return;
  wod.results.push(result);
  await putWod(wod);
  say(strings.dashboard.resultSaved);
  await draw();
}

async function removeWod(wod: Wod): Promise<void> {
  const ok = await ask(fill(strings.dashboard.confirmDelete, { name: wod.name || strings.untitled }));
  if (!ok) return;
  await deleteWod(wod.id);
  await draw();
}

formatSelect?.addEventListener('change', showFields);
showFields();

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const text = String(data.get('text') ?? '');
    const format = String(data.get('format') ?? 'other') as Format;
    if (!name) {
      say(strings.dashboard.needName);
      return;
    }
    const timer = readConfig(data, format);
    const hash = await workoutHash(name, format, text);
    const existing = (await listWods()).find((wod) => wod.hash === hash);
    if (existing) {
      say(strings.dashboard.duplicate);
      return;
    }
    await putWod({
      id: crypto.randomUUID(),
      name,
      format,
      timer,
      text,
      createdAt: new Date().toISOString(),
      source: 'manual',
      hash,
      results: [],
    });
    form.reset();
    showFields();
    say(strings.dashboard.saved);
    await draw();
  })();
});

document.querySelector('#export')?.addEventListener('click', () => {
  void (async () => {
    const wods = await listWods();
    const blob = new Blob([JSON.stringify(exportDocument(wods), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `wodburner-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  })();
});

document.querySelector<HTMLInputElement>('#import')?.addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  void (async () => {
    try {
      const raw: unknown = JSON.parse(await file.text());
      const existing = await listWods();
      const merged = await importDocument(existing, raw);
      await replaceWods(merged.wods);
      say(fill(strings.dashboard.imported, { added: merged.added, merged: merged.merged }));
      await draw();
    } catch {
      say(strings.dashboard.importError);
    }
  })();
});

document.querySelector('#clear')?.addEventListener('click', () => {
  void (async () => {
    const ok = await ask(strings.dashboard.confirmClear);
    if (!ok) return;
    await clearAll();
    await setMeta('lang', lang);
    say(strings.dashboard.cleared);
    await draw();
  })();
});

void draw();
