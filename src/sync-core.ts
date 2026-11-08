import { sha256Hex } from './hash';
import { exportDocument, importDocument } from './transfer';
import type { Wod } from './types';
import { isoDate } from './validate';

// Sync without an account. The secret key is not sent to the server. From it we derive
// (1) an opaque id the server stores the data under and (2) an AES-GCM key that encrypts the data
// before it is sent. The server holds ciphertext only and cannot tell whose it is.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const KEY_CHARS = 32; // 160 bits
export const MAX_BLOB = 900_000;

export interface Payload {
  v: 1;
  wods: unknown;
  // hash of a deleted workout -> when it was deleted. A friend's copy uses `${by}:${hash}`.
  deleted: Record<string, string>;
  who?: string;
}

export function newKey(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(20))): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out;
}

export function showKey(key: string): string {
  return key.match(/.{1,4}/g)?.join('-') ?? key;
}

// Accepts what a person types: any case, dashes or spaces, and the look-alike letters Crockford allows.
export function parseKey(input: string): string | null {
  const key = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (key.length !== KEY_CHARS) return null;
  for (const ch of key) if (!ALPHABET.includes(ch)) return null;
  return key;
}

export async function vaultId(key: string): Promise<string> {
  return (await sha256Hex(`wodburner:id:${key}`)).slice(0, 40);
}

// A second secret, derived one way from the key. It opens a read-only copy of our own workouts.
// Whoever holds it cannot get back to the key, so they can read that copy but never write or delete anything.
export async function shareCode(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`wodburner:share:${key}`));
  return newKey(new Uint8Array(digest).slice(0, 20));
}

// Proof of ownership sent with every write. The server keeps only its hash.
export async function writeToken(key: string): Promise<string> {
  return sha256Hex(`wodburner:write:${key}`);
}

async function aesKey(key: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`wodburner:enc:${key}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x2000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

const MAX_PLAIN = 40_000_000;

// Version 1 was plain JSON. Version 2 compresses before encrypting, so a long history fits the size limit.
export async function seal(key: string, payload: Payload): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await pipe(new TextEncoder().encode(JSON.stringify(payload)), new CompressionStream('gzip'));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key), data as BufferSource));
  const out = new Uint8Array(1 + iv.length + cipher.length);
  out[0] = 2;
  out.set(iv, 1);
  out.set(cipher, 1 + iv.length);
  return toBase64(out);
}

export async function open(key: string, blob: string): Promise<Payload> {
  const bytes = fromBase64(blob);
  if ((bytes[0] !== 1 && bytes[0] !== 2) || bytes.length < 30) throw new Error('format');
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(1, 13) }, await aesKey(key), bytes.slice(13)));
  const raw = bytes[0] === 2 ? await pipe(plain, new DecompressionStream('gzip')) : plain;
  if (raw.length > MAX_PLAIN) throw new Error('format');
  const value: unknown = JSON.parse(new TextDecoder().decode(raw));
  if (typeof value !== 'object' || value === null || (value as { v?: unknown }).v !== 1) throw new Error('format');
  return value as Payload;
}

const TOMBSTONE = /^(?:[0-9a-f]{40}:)?[0-9a-f]{64}$/;

export function cleanWho(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, 40);
}

export function tombstoneKey(wod: { hash: string; by?: string }): string {
  return wod.by ? `${wod.by}:${wod.hash}` : wod.hash;
}

export function cleanDeleted(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const [hash, when] of Object.entries(value)) {
    if (TOMBSTONE.test(hash) && typeof when === 'string' && !Number.isNaN(Date.parse(when))) out[hash] = isoDate(when);
  }
  return out;
}

const TOMBSTONE_DAYS = 365;

// A deletion only has to outlive the devices that still hold the workout. After a year it is forgotten,
// so the list cannot grow forever.
export function pruneDeleted(deleted: Record<string, string>, now = Date.now()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [hash, when] of Object.entries(deleted)) if (now - Date.parse(when) < TOMBSTONE_DAYS * 86_400_000) out[hash] = when;
  return out;
}

// Moves the copies of a friend (and our deletions of them) from one id to another.
export function moveFriend(wods: Wod[], deleted: Record<string, string>, from: string, to: string): { wods: Wod[]; deleted: Record<string, string> } {
  const moved = wods.map((wod) => (wod.by === from ? { ...wod, by: to } : wod));
  const next: Record<string, string> = {};
  for (const [key, when] of Object.entries(deleted)) next[key.startsWith(`${from}:`) ? `${to}:${key.slice(from.length + 1)}` : key] = when;
  return { wods: moved, deleted: next };
}

export function packPayload(wods: Wod[], deleted: Record<string, string>, who = ''): Payload {
  const payload: Payload = { v: 1, wods: exportDocument(wods), deleted };
  const name = cleanWho(who);
  if (name) payload.who = name;
  return payload;
}

export interface FriendCopy {
  wods: Wod[];
  added: number;
  dropped: string[];
  changed: boolean;
}

// Copies someone else's own workouts next to ours. Their copies of other people are left out.
// A copy we deleted stays deleted. A workout they removed is dropped here too.
export function applyFriend(local: Wod[], remote: Wod[], friend: { id: string; name: string }, deleted: Record<string, string>): FriendCopy {
  const name = cleanWho(friend.name);
  if (!/^[0-9a-f]{40}$/.test(friend.id) || !name) throw new Error('friend');
  const incoming = new Map<string, Wod>();
  for (const wod of remote) {
    if (wod.by || deleted[`${friend.id}:${wod.hash}`]) continue;
    incoming.set(wod.hash, wod);
  }
  const wods: Wod[] = [];
  const seen = new Set<string>();
  const dropped: string[] = [];
  let added = 0;
  let changed = false;
  for (const wod of local) {
    if (wod.by !== friend.id) {
      wods.push(wod);
      continue;
    }
    const fresh = incoming.get(wod.hash);
    if (!fresh) {
      dropped.push(`${friend.id}:${wod.hash}`);
      changed = true;
      continue;
    }
    seen.add(wod.hash);
    const next: Wod = { ...fresh, id: wod.id, by: friend.id, who: name, timer: { ...fresh.timer }, results: fresh.results.map((result) => ({ ...result })) };
    if (next.who !== wod.who || next.name !== wod.name || next.text !== wod.text || next.format !== wod.format || JSON.stringify(next.timer) !== JSON.stringify(wod.timer) || JSON.stringify(next.results) !== JSON.stringify(wod.results)) changed = true;
    wods.push(next);
  }
  for (const fresh of incoming.values()) {
    if (seen.has(fresh.hash)) continue;
    wods.push({ ...fresh, id: crypto.randomUUID(), by: friend.id, who: name, timer: { ...fresh.timer }, results: fresh.results.map((result) => ({ ...result })) });
    added += 1;
    changed = true;
  }
  return { wods, added, dropped, changed };
}

export interface Merged {
  wods: Wod[];
  deleted: Record<string, string>;
  added: number;
}

// Union of both sides. A workout deleted on either side stays deleted, unless it was saved again later.
export async function mergePayload(local: Wod[], localDeleted: Record<string, string>, remote: Payload | null): Promise<Merged> {
  const deleted = { ...cleanDeleted(remote?.deleted) };
  for (const [hash, when] of Object.entries(localDeleted)) if (!deleted[hash] || deleted[hash] < when) deleted[hash] = when;
  let wods = local;
  let added = 0;
  if (remote) {
    const merged = await importDocument(local, remote.wods);
    wods = merged.wods;
    added = merged.added;
  }
  const kept = wods.filter((wod) => {
    const when = deleted[tombstoneKey(wod)];
    return !when || wod.createdAt > when;
  });
  return { wods: kept, deleted, added };
}
