import { sha256Hex } from './hash';
import { exportDocument, importDocument } from './transfer';
import type { Wod } from './types';

// Sync without an account. A random secret key never leaves the device. From it we derive
// (1) an opaque id the server stores the data under and (2) an AES-GCM key that encrypts the data
// before it is sent. The server holds ciphertext only and cannot tell whose it is.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const KEY_CHARS = 32; // 160 bits
export const MAX_BLOB = 900_000;

export interface Payload {
  v: 1;
  wods: unknown;
  // hash of a deleted workout -> when it was deleted
  deleted: Record<string, string>;
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

export async function seal(key: string, payload: Payload): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key), data));
  const out = new Uint8Array(1 + iv.length + cipher.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(cipher, 1 + iv.length);
  return toBase64(out);
}

export async function open(key: string, blob: string): Promise<Payload> {
  const bytes = fromBase64(blob);
  if (bytes[0] !== 1 || bytes.length < 30) throw new Error('format');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(1, 13) }, await aesKey(key), bytes.slice(13));
  const value: unknown = JSON.parse(new TextDecoder().decode(plain));
  if (typeof value !== 'object' || value === null || (value as { v?: unknown }).v !== 1) throw new Error('format');
  return value as Payload;
}

export function cleanDeleted(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const [hash, when] of Object.entries(value)) {
    if (/^[0-9a-f]{64}$/.test(hash) && typeof when === 'string' && !Number.isNaN(Date.parse(when))) out[hash] = when;
  }
  return out;
}

export function packPayload(wods: Wod[], deleted: Record<string, string>): Payload {
  return { v: 1, wods: exportDocument(wods), deleted };
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
  const kept = wods.filter((wod) => !deleted[wod.hash] || wod.createdAt > (deleted[wod.hash] as string));
  return { wods: kept, deleted, added };
}
