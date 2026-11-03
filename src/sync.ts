import { getMeta, listWods, replaceWods, setMeta } from './db';
import { MAX_BLOB, cleanDeleted, mergePayload, newKey, open, packPayload, parseKey, seal, showKey, vaultId } from './sync-core';

const STORE = 'wb-sync';

export type SyncError = 'network' | 'notfound' | 'badkey' | 'limit';

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
  const out = await seal(key, packPayload(merged.wods, merged.deleted));
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

export async function forgetDeleted(hash: string): Promise<void> {
  const deleted = cleanDeleted(await getMeta('deleted'));
  deleted[hash] = new Date().toISOString();
  await setMeta('deleted', deleted);
}

export function display(key: string): string {
  return showKey(key);
}
