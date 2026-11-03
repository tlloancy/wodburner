import strings from '@i18n';
import { clearAll, deleteWod, getWod, listWods, putWod, replaceWods } from '../db';
import { fill } from '../fill';
import { workoutHash } from '../hash';
import { clearChoice } from '../lang';
import { registerSW } from '../pwa';
import { qrModules } from '../qr';
import { buildIndex, matchRanges, parseQuery, search, sortHits, type Indexed, type SortMode } from '../search';
import * as sync from '../sync';
import { SyncFailure } from '../sync';
import { parseKey, tombstoneKey } from '../sync-core';
import { timerHref } from '../timer-link';
import { exportDocument, importDocument } from '../transfer';
import type { Format, Result, TimerConfig, Wod } from '../types';
import { parseTimer } from '../validate';

registerSW();
const lang = document.body.dataset.lang === 'fr' ? 'fr' : 'en';

const list = document.querySelector<HTMLElement>('#list');
const empty = document.querySelector<HTMLElement>('#empty');
const status = document.querySelector<HTMLElement>('#status');
const formStatus = document.querySelector<HTMLElement>('#form-status');
const form = document.querySelector<HTMLFormElement>('#manual');
const formatSelect = document.querySelector<HTMLSelectElement>('#format');
const dialog = document.querySelector<HTMLDialogElement>('#confirm');
const confirmText = document.querySelector<HTMLElement>('#confirm-text');

function say(message: string): void {
  if (status) status.textContent = message;
}

function sayForm(message: string): void {
  if (formStatus) formStatus.textContent = message;
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

const PAGE = 50;
const finder = document.querySelector<HTMLElement>('#finder');
const box = document.querySelector<HTMLInputElement>('#q');
const sortSelect = document.querySelector<HTMLSelectElement>('#sort');
const chipsBox = document.querySelector<HTMLElement>('#chips');
const count = document.querySelector<HTMLElement>('#count');
const more = document.querySelector<HTMLButtonElement>('#more');

let index: Indexed<Wod>[] = [];
let total = 0;
let fmt = '';
let withResult = false;
let sort: SortMode = 'recent';
let limit = PAGE;

function highlight(node: HTMLElement, text: string, ranges: [number, number][]): void {
  if (!ranges.length) {
    node.textContent = text;
    return;
  }
  node.textContent = '';
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) node.append(text.slice(at, a));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(a, b);
    node.append(mark);
    at = b;
  }
  if (at < text.length) node.append(text.slice(at));
}

function chip(key: string, text: string, on: boolean, toggle: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip';
  button.dataset.key = key;
  button.setAttribute('aria-pressed', String(on));
  button.textContent = text;
  button.addEventListener('click', () => {
    toggle();
    limit = PAGE;
    render();
  });
  return button;
}

function drawChips(wods: Wod[]): void {
  if (!chipsBox) return;
  const present = (Object.keys(strings.formats) as Format[]).filter((f) => wods.some((w) => w.format === f));
  if (fmt && !present.includes(fmt as Format)) fmt = '';
  chipsBox.replaceChildren(chip('', strings.dashboard.chipAll, !fmt && !withResult, () => {
    fmt = '';
    withResult = false;
  }));
  for (const f of present) chipsBox.append(chip(f, strings.formats[f], fmt === f, () => {
    fmt = fmt === f ? '' : f;
  }));
  if (wods.some((w) => w.results.length)) chipsBox.append(chip('result', strings.dashboard.chipResult, withResult, () => {
    withResult = !withResult;
  }));
}

function syncUrl(): void {
  const value = box?.value.trim() ?? '';
  const url = new URL(location.href);
  if (value) url.searchParams.set('q', value);
  else url.searchParams.delete('q');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

async function draw(): Promise<void> {
  let wods: Wod[] = [];
  try {
    wods = await listWods();
  } catch {
    return;
  }
  total = wods.length;
  index = buildIndex(wods, (w) => ({ name: w.name || strings.untitled, text: w.text, meta: `${w.who ?? ''} ${strings.formats[w.format]} ${w.results.map((r) => `${r.value} ${r.note ?? ''}`).join(' ')}` }));
  if (finder) finder.hidden = total < 2;
  drawChips(wods);
  render();
}

function render(): void {
  if (!list || !empty) return;
  list.replaceChildren();
  empty.hidden = total > 0;
  const query = parseQuery(box && total > 1 ? box.value : '');
  let hits = search(index, query).filter((h) => (!fmt || h.item.format === fmt) && (!withResult || h.item.results.length > 0));
  hits = sortHits(hits, sort, (w) => w.name || strings.untitled);
  if (count) {
    count.textContent = !total ? '' : !hits.length ? strings.dashboard.noMatch : hits.length === total ? (total === 1 ? strings.dashboard.countOne : fill(strings.dashboard.countAll, { n: total })) : fill(strings.dashboard.countFiltered, { n: hits.length, total });
  }
  const shown = hits.slice(0, limit);
  if (more) {
    more.hidden = hits.length <= limit;
    more.textContent = strings.dashboard.more;
  }
  const when = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' });
  for (const { item: wod } of shown) {
    const item = document.createElement('li');
    item.className = 'card';
    item.dataset.id = wod.id;
    const title = document.createElement('h2');
    const open = document.createElement('a');
    open.href = `/${lang}/wod/#${encodeURIComponent(wod.id)}`;
    const shownName = wod.name || strings.untitled;
    highlight(open, shownName, matchRanges(shownName, query));
    title.append(open);
    const who = wod.who ? document.createElement('p') : null;
    if (who && wod.who) {
      who.className = 'who';
      who.textContent = wod.who;
    }
    const meta = document.createElement('p');
    meta.className = 'meta';
    const time = document.createElement('time');
    time.dateTime = wod.createdAt;
    time.textContent = when.format(new Date(wod.createdAt));
    meta.append(strings.formats[wod.format], ' · ', time);
    const text = document.createElement('pre');
    text.className = 'wod-text';
    highlight(text, wod.text, matchRanges(wod.text, query));
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
    const saved = document.createElement('p');
    saved.className = 'save-note';
    saved.setAttribute('role', 'status');
    resultForm.append(rounds, reps, note, submit, saved);
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
    item.append(title);
    if (who) item.append(who);
    item.append(meta, text, results, actions);
    if (!wod.by) item.append(resultForm);
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
  await draw();
  quietSync();
  const card = [...(list?.children ?? [])].find((node) => node instanceof HTMLElement && node.dataset.id === id);
  const note = card?.querySelector('.save-note');
  if (note) note.textContent = strings.dashboard.resultSaved;
}

async function removeWod(wod: Wod): Promise<void> {
  const ok = await ask(fill(strings.dashboard.confirmDelete, { name: wod.name || strings.untitled }));
  if (!ok) return;
  await deleteWod(wod.id);
  await sync.forgetDeleted(tombstoneKey(wod));
  await draw();
  quietSync();
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
      sayForm(strings.dashboard.needName);
      return;
    }
    const timer = readConfig(data, format);
    const hash = await workoutHash(name, format, text);
    const existing = (await listWods()).find((wod) => !wod.by && wod.hash === hash);
    if (existing) {
      sayForm(strings.dashboard.duplicate);
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
    sayForm(strings.dashboard.saved);
    await draw();
    quietSync();
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
      quietSync();
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
    clearChoice();
    await sync.disable();
    showSync();
    say(strings.dashboard.cleared);
    await draw();
  })();
});

if (sortSelect) {
  for (const [value, text] of [['recent', strings.dashboard.sortRecent], ['name', strings.dashboard.sortName]] as const) sortSelect.append(new Option(text, value));
  sortSelect.addEventListener('change', () => {
    sort = sortSelect.value === 'name' ? 'name' : 'recent';
    render();
  });
}
let timer = 0;
box?.addEventListener('input', () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    limit = PAGE;
    syncUrl();
    render();
  }, 60);
});
box?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && box.value) {
    box.value = '';
    syncUrl();
    render();
  }
});
more?.addEventListener('click', () => {
  limit += PAGE;
  render();
});
document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  if (!box || !finder || finder.hidden) return;
  event.preventDefault();
  box.focus();
});
if (box) box.value = new URLSearchParams(location.search).get('q') ?? '';

const syncStatus = document.querySelector<HTMLElement>('#sync-status');
const syncOff = document.querySelector<HTMLElement>('#sync-off');
const syncLive = document.querySelector<HTMLElement>('#sync-live');
const syncKey = document.querySelector<HTMLElement>('#sync-key');

function syncSay(message: string): void {
  if (syncStatus) syncStatus.textContent = message;
}

function syncError(error: unknown): string {
  const code = error instanceof SyncFailure ? error.code : 'network';
  return code === 'notfound' ? strings.dashboard.syncNotFound : code === 'badkey' ? strings.dashboard.syncBadKey : code === 'limit' ? strings.dashboard.syncLimit : code === 'noname' ? strings.dashboard.friendNameless : strings.dashboard.syncNetwork;
}

function deviceLink(key: string): string {
  return `${location.origin}${location.pathname}#k=${key}`;
}

function linkedKey(): string | null {
  if (!location.hash.startsWith('#k=')) return null;
  const raw = location.hash.slice(3);
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  return raw;
}

function drawQr(key: string): void {
  const host = document.querySelector<HTMLElement>('#sync-qr');
  if (!host) return;
  host.replaceChildren();
  const { n, dark } = qrModules(deviceLink(key));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `-4 -4 ${n + 8} ${n + 8}`);
  svg.setAttribute('aria-hidden', 'true');
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '-4');
  bg.setAttribute('y', '-4');
  bg.setAttribute('width', String(n + 8));
  bg.setAttribute('height', String(n + 8));
  bg.setAttribute('fill', '#fff');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', '#111');
  let d = '';
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) if (dark[row * n + col]) d += `M${col} ${row}h1v1h-1z`;
  path.setAttribute('d', d);
  svg.append(bg, path);
  host.append(svg);
}

function showSync(): void {
  const key = sync.savedKey();
  if (syncOff) syncOff.hidden = key !== null;
  if (syncLive) syncLive.hidden = key === null;
  if (syncKey) syncKey.textContent = key ? sync.display(key) : '';
  const nameInput = document.querySelector<HTMLInputElement>('#sync-name');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = sync.currentWho();
  if (key) drawQr(key);
}

// Runs after a change on this page. Failures stay silent: the next visit tries again.
function quietSync(): void {
  const key = sync.savedKey();
  if (key) void sync.syncNow(key).catch(() => undefined);
}

async function runSync(action: () => Promise<{ added: number; total: number }>): Promise<void> {
  try {
    const report = await action();
    syncSay(fill(strings.dashboard.syncDone, { total: report.total, added: report.added }));
    await draw();
  } catch (error) {
    syncSay(syncError(error));
  }
  showSync();
}

document.querySelector('#sync-on')?.addEventListener('click', () => {
  void (async () => {
    try {
      await sync.enable();
      syncSay(strings.dashboard.syncOn);
    } catch (error) {
      syncSay(syncError(error));
    }
    showSync();
  })();
});
document.querySelector<HTMLFormElement>('#sync-join')?.addEventListener('submit', (event) => {
  event.preventDefault();
  void runSync(() => sync.join(document.querySelector<HTMLInputElement>('#sync-key-in')?.value ?? ''));
});
document.querySelector('#sync-now')?.addEventListener('click', () => {
  const key = sync.savedKey();
  if (key) void runSync(() => sync.syncNow(key));
});
document.querySelector('#sync-copy')?.addEventListener('click', () => {
  const key = sync.savedKey();
  if (!key) return;
  void navigator.clipboard?.writeText(sync.display(key)).then(() => syncSay(strings.dashboard.syncCopied), () => undefined);
});
document.querySelector('#sync-name')?.addEventListener('change', () => {
  const input = document.querySelector<HTMLInputElement>('#sync-name');
  sync.setWho(input?.value ?? '');
  if (input) input.value = sync.currentWho();
  quietSync();
});
document.querySelector('#sync-share')?.addEventListener('click', () => {
  const key = sync.savedKey();
  if (!key) return;
  const url = deviceLink(key);
  if (typeof navigator.share === 'function') {
    void navigator.share({ title: 'WODBurner', url }).catch(() => undefined);
    return;
  }
  void navigator.clipboard?.writeText(url).then(() => syncSay(strings.dashboard.syncLinkCopied), () => undefined);
});
document.querySelector('#sync-stop')?.addEventListener('click', () => {
  void (async () => {
    if (!(await ask(strings.dashboard.confirmSyncOff))) return;
    await sync.disable();
    syncSay(strings.dashboard.syncOff);
    showSync();
  })();
});

async function pullFriends(): Promise<void> {
  let changed = false;
  for (const friendKey of sync.savedFriends()) {
    try {
      const report = await sync.importFriend(friendKey);
      if (report.changed) changed = true;
    } catch {
      // One friend offline keeps the last copy.
    }
  }
  if (!changed) return;
  await draw();
  quietSync();
}

async function runFriend(friendKey: string): Promise<void> {
  try {
    let report: Awaited<ReturnType<typeof sync.importFriend>>;
    try {
      report = await sync.importFriend(friendKey);
    } catch (error) {
      if (!(error instanceof SyncFailure) || error.code !== 'noname') throw error;
      const typed = window.prompt(strings.dashboard.friendNeedName) ?? '';
      if (!typed.trim()) {
        syncSay(strings.dashboard.friendNameless);
        return;
      }
      report = await sync.importFriend(friendKey, typed);
    }
    syncSay(fill(strings.dashboard.friendDone, { name: report.name, added: report.added, total: report.total }));
    await draw();
    quietSync();
  } catch (error) {
    syncSay(syncError(error));
  }
  showSync();
}

const incoming = linkedKey();
const incomingKey = incoming ? parseKey(incoming) : null;
showSync();
void draw();
{
  const key = sync.savedKey();
  if (incoming && !incomingKey) syncSay(strings.dashboard.syncBadKey);
  else if (incomingKey && key && incomingKey !== key) {
    document.querySelector('#sync')?.setAttribute('open', '');
    void runFriend(incomingKey);
  } else if (incomingKey && !key) {
    document.querySelector('#sync')?.setAttribute('open', '');
    void runSync(() => sync.join(incomingKey));
  } else if (key) {
    void (async () => {
      await runSync(() => sync.syncNow(key));
      await pullFriends();
    })();
  }
}
