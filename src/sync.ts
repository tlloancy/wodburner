import { getMeta, listWods, replaceWods, setMeta } from './db';
import { readWods } from './transfer';
import { MAX_BLOB, applyFriend, cleanDeleted, cleanWho, mergePayload, newKey, open, packPayload, parseKey, seal, showKey, vaultId } from './sync-core';

const STORE = 'wb-sync';
const WHO = 'wb-who';
const FRIENDS = 'wb-friends';

export type SyncError = 'network' | 'notfound' | 'badkey' | 'limit' | 'noname';

export class SyncFailure extends Error {
  constructor(readonly code: SyncError) {
    super(code);
  }
}

export function savedKey(): string | null {
  try {
    return parseKey(localStorage.getItem(STORE) ?? '');
  } catch {
    return null;
  }
}

export function currentWho(): string {
  try {
    return cleanWho(localStorage.getItem(WHO) ?? '');
  } catch {
    return '';
  }
}

export function setWho(value: string): void {
  const name = cleanWho(value);
  try {
    if (name) localStorage.setItem(WHO, name);
    else localStorage.removeItem(WHO);
  } catch {
    // Storage blocked: the name is still sent with this page's sync.
  }
}

export function savedFriends(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FRIENDS) ?? '[]');
    if (!Array.isArray(raw)) return [];
    const keys: string[] = [];
    for (const item of raw) {
      const key = parseKey(typeof item === 'string' ? item : '');
      if (key && !keys.includes(key)) keys.push(key);
    }
    return keys.slice(0, 20);
  } catch {
    return [];
  }
}

function rememberFriend(key: string): void {
  const keys = [key, ...savedFriends().filter((item) => item !== key)].slice(0, 20);
  try {
    localStorage.setItem(FRIENDS, JSON.stringify(keys));
  } catch {
    // The copy is already on this device. The next scan can refresh it.
  }
}

function remember(key: string | null): void {
  try {
    if (key) localStorage.setItem(STORE, key);
    else localStorage.removeItem(STORE);
  } catch {
    // Storage blocked: sync then lasts until the page closes.
  }
}

function url(id: string): string {
  return `${document.body.dataset.worker || ''}/sync/${id}`;
}

async function call(method: string, id: string, body?: string): Promise<Response> {
  try {
    return await fetch(url(id), { method, body, headers: body ? { 'content-type': 'text/plain' } : undefined });
  } catch {
    throw new SyncFailure('network');
  }
}

async function pull(key: string): Promise<string | null> {
  const response = await call('GET', await vaultId(key));
  if (response.status === 404) return null;
  if (!response.ok) throw new SyncFailure('network');
  return response.text();
}

export interface SyncReport {
  added: number;
  total: number;
}

// Pulls the encrypted copy, merges it with this device, saves the result here and sends it back.
export async function syncNow(key: string): Promise<SyncReport> {
  const blob = await pull(key);
  let remote = null;
  if (blob) {
    try {
      remote = await open(key, blob);
    } catch {
      throw new SyncFailure('badkey');
    }
  }
  const deleted = cleanDeleted(await getMeta('deleted'));
  const merged = await mergePayload(await listWods(), deleted, remote);
  await replaceWods(merged.wods);
  await setMeta('deleted', merged.deleted);
  const localWho = currentWho();
  const name = localWho || cleanWho(remote?.who);
  if (name && name !== localWho) setWho(name);
  const out = await seal(key, packPayload(merged.wods, merged.deleted, name));
  if (out.length > MAX_BLOB) throw new SyncFailure('limit');
  const response = await call('PUT', await vaultId(key), out);
  if (response.status === 413) throw new SyncFailure('limit');
  if (!response.ok) throw new SyncFailure('network');
  return { added: merged.added, total: merged.wods.length };
}

export async function enable(): Promise<string> {
  const key = newKey();
  remember(key);
  await syncNow(key);
  return key;
}

// Joins an existing backup. The key must already have one, otherwise a typo would start an empty vault.
export async function join(typed: string): Promise<SyncReport> {
  const key = parseKey(typed);
  if (!key) throw new SyncFailure('badkey');
  if ((await pull(key)) === null) throw new SyncFailure('notfound');
  const report = await syncNow(key);
  remember(key);
  return report;
}

export async function disable(): Promise<void> {
  const key = savedKey();
  remember(null);
  if (key) {
    try {
      await call('DELETE', await vaultId(key));
    } catch {
      // Offline: the copy expires by itself.
    }
  }
}

export interface FriendReport {
  name: string;
  added: number;
  total: number;
  changed: boolean;
}

// Reads a friend's backup and copies it next to ours. Never writes to their backup.
export async function importFriend(typed: string, fallbackName = ''): Promise<FriendReport> {
  const key = parseKey(typed);
  if (!key) throw new SyncFailure('badkey');
  const blob = await pull(key);
  if (blob === null) throw new SyncFailure('notfound');
  let remote;
  try {
    remote = await open(key, blob);
  } catch {
    throw new SyncFailure('badkey');
  }
  let remoteWods;
  try {
    remoteWods = await readWods(remote.wods);
  } catch {
    throw new SyncFailure('badkey');
  }
  const id = await vaultId(key);
  const local = await listWods();
  const name = cleanWho(remote.who) || cleanWho(fallbackName) || local.find((wod) => wod.by === id)?.who || '';
  if (!name) throw new SyncFailure('noname');
  const deleted = cleanDeleted(await getMeta('deleted'));
  const applied = applyFriend(local, remoteWods, { id, name }, deleted);
  const now = new Date().toISOString();
  for (const tomb of applied.dropped) deleted[tomb] = now;
  await replaceWods(applied.wods);
  await setMeta('deleted', deleted);
  rememberFriend(key);
  return { name, added: applied.added, total: applied.wods.length, changed: applied.changed || applied.dropped.length > 0 };
}

export async function forgetDeleted(hash: string): Promise<void> {
  const deleted = cleanDeleted(await getMeta('deleted'));
  deleted[hash] = new Date().toISOString();
  await setMeta('deleted', deleted);
}

export function display(key: string): string {
  return showKey(key);
}
