import { applyWods, getMeta, listWods, setMeta } from './db';
import { sha256Hex } from './hash';
import { readWods } from './transfer';
import { MAX_BLOB, applyFriend, cleanDeleted, cleanWho, mergePayload, moveFriend, newKey, open, packPayload, parseKey, pruneDeleted, seal, shareCode, showKey, vaultId, writeToken } from './sync-core';

const STORE = 'wb-sync';
const WHO = 'wb-who';
// Friends are kept as read-only share codes. `wb-friends` held full keys in earlier versions.
const FRIENDS = 'wb-friends2';
const LEGACY_FRIENDS = 'wb-friends';
const SHARED = 'wb-shared';

export type SyncError = 'network' | 'notfound' | 'badkey' | 'limit' | 'noname' | 'quota' | 'self';

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

function readKeys(name: string): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(name) ?? '[]');
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

function writeKeys(name: string, keys: string[]): void {
  try {
    if (keys.length) localStorage.setItem(name, JSON.stringify(keys));
    else localStorage.removeItem(name);
  } catch {
    // Storage blocked: the copy is already on this device. The next visit can refresh it.
  }
}

export function savedFriends(): string[] {
  return readKeys(FRIENDS);
}

function rememberFriend(code: string): void {
  writeKeys(FRIENDS, [code, ...savedFriends().filter((item) => item !== code)].slice(0, 20));
}

function forgetShared(): void {
  try {
    localStorage.removeItem(SHARED);
  } catch {
    // Nothing to forget.
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

async function call(method: string, id: string, body?: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'text/plain';
  if (token) headers['x-write-token'] = token;
  try {
    return await fetch(url(id), { method, body, headers });
  } catch {
    throw new SyncFailure('network');
  }
}

function failure(response: Response): SyncFailure {
  if (response.status === 413) return new SyncFailure('limit');
  if (response.status === 429) return new SyncFailure('quota');
  if (response.status === 403) return new SyncFailure('badkey');
  return new SyncFailure('network');
}

// `secret` is the key for our own backup, or a share code for someone's read-only copy.
async function pull(secret: string): Promise<string | null> {
  const response = await call('GET', await vaultId(secret));
  if (response.status === 404) return null;
  if (!response.ok) throw new SyncFailure('network');
  return response.text();
}

// The read-only copy holds our own workouts only (no friend copies, no deletions). It is sent again
// only when its content changed, so most syncs make a single write.
async function publishShare(key: string, wods: Awaited<ReturnType<typeof listWods>>, name: string, token: string): Promise<void> {
  const own = wods.filter((wod) => !wod.by);
  const stamp = await sha256Hex(JSON.stringify([own, name]));
  try {
    if (localStorage.getItem(SHARED) === stamp) return;
  } catch {
    // Storage blocked: publish anyway.
  }
  const code = await shareCode(key);
  const blob = await seal(code, packPayload(own, {}, name));
  if (blob.length > MAX_BLOB) return;
  try {
    const response = await call('PUT', await vaultId(code), blob, token);
    if (!response.ok) return;
    localStorage.setItem(SHARED, stamp);
  } catch {
    // The friend link keeps the previous copy. The next sync tries again.
  }
}

export async function currentShareCode(): Promise<string | null> {
  const key = savedKey();
  return key ? shareCode(key) : null;
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
  const before = await listWods();
  const merged = await mergePayload(before, pruneDeleted(cleanDeleted(await getMeta('deleted'))), remote);
  const deleted = pruneDeleted(merged.deleted);
  await applyWods(before, merged.wods);
  await setMeta('deleted', deleted);
  const localWho = currentWho();
  const name = localWho || cleanWho(remote?.who);
  if (name && name !== localWho) setWho(name);
  const out = await seal(key, packPayload(merged.wods, deleted, name));
  if (out.length > MAX_BLOB) throw new SyncFailure('limit');
  const token = await writeToken(key);
  const response = await call('PUT', await vaultId(key), out, token);
  if (!response.ok) throw failure(response);
  await publishShare(key, merged.wods, name, token);
  return { added: merged.added, total: merged.wods.length };
}

export async function enable(): Promise<string> {
  const key = newKey();
  forgetShared();
  remember(key);
  await syncNow(key);
  return key;
}

// Joins an existing backup. The key must already have one, otherwise a typo would start an empty vault.
export async function join(typed: string): Promise<SyncReport> {
  const key = parseKey(typed);
  if (!key) throw new SyncFailure('badkey');
  if ((await pull(key)) === null) throw new SyncFailure('notfound');
  forgetShared();
  const report = await syncNow(key);
  remember(key);
  return report;
}

export async function disable(): Promise<void> {
  const key = savedKey();
  remember(null);
  forgetShared();
  if (key) {
    try {
      const token = await writeToken(key);
      await call('DELETE', await vaultId(key), undefined, token);
      await call('DELETE', await vaultId(await shareCode(key)), undefined, token);
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

async function openCopy(secret: string, blob: string): Promise<Awaited<ReturnType<typeof open>>> {
  try {
    return await open(secret, blob);
  } catch {
    throw new SyncFailure('badkey');
  }
}

// Reads a friend's read-only copy and copies it next to ours. Never writes to their backup.
// `mode: 'key'` is for an old link that carried the whole key: we keep only the share code derived from it.
export async function importFriend(typed: string, fallbackName = '', mode: 'share' | 'key' = 'share'): Promise<FriendReport> {
  const input = parseKey(typed);
  if (!input) throw new SyncFailure('badkey');
  const code = mode === 'key' ? await shareCode(input) : input;
  const own = savedKey();
  if (own && (await shareCode(own)) === code) throw new SyncFailure('self');
  const id = await vaultId(code);
  const blob = await pull(code);
  // An old link only works once its owner has opened WODBurner again: that publishes the read-only copy.
  if (blob === null) throw new SyncFailure('notfound');
  const remote = await openCopy(code, blob);
  let remoteWods;
  try {
    remoteWods = await readWods(remote.wods);
  } catch {
    throw new SyncFailure('badkey');
  }
  const before = await listWods();
  let local = before;
  let deleted = cleanDeleted(await getMeta('deleted'));
  if (mode === 'key') {
    const moved = moveFriend(local, deleted, await vaultId(input), id);
    local = moved.wods;
    deleted = moved.deleted;
  }
  const name = cleanWho(remote.who) || cleanWho(fallbackName) || local.find((wod) => wod.by === id)?.who || '';
  if (!name) throw new SyncFailure('noname');
  const applied = applyFriend(local, remoteWods, { id, name }, deleted);
  const now = new Date().toISOString();
  for (const tomb of applied.dropped) deleted[tomb] = now;
  await applyWods(before, applied.wods);
  await setMeta('deleted', pruneDeleted(deleted));
  rememberFriend(code);
  return { name, added: applied.added, total: applied.wods.length, changed: applied.changed || applied.dropped.length > 0 };
}

// Friends saved by an earlier version are full keys. Each one is turned into a read-only share code.
export async function migrateFriends(): Promise<boolean> {
  const legacy = readKeys(LEGACY_FRIENDS);
  let changed = false;
  const drop = (key: string): void => writeKeys(LEGACY_FRIENDS, readKeys(LEGACY_FRIENDS).filter((item) => item !== key));
  for (const key of legacy) {
    try {
      if ((await importFriend(key, '', 'key')).changed) changed = true;
      drop(key);
    } catch (error) {
      // Not reachable or not published yet: the key stays and is tried again. One that cannot be read is dropped.
      if (error instanceof SyncFailure && (error.code === 'badkey' || error.code === 'self')) drop(key);
    }
  }
  return changed;
}

export async function forgetDeleted(hash: string): Promise<void> {
  const deleted = cleanDeleted(await getMeta('deleted'));
  deleted[hash] = new Date().toISOString();
  await setMeta('deleted', deleted);
}

export function display(key: string): string {
  return showKey(key);
}
