import { DataError, parseScanResult } from '../src/validate';
import { sha256Hex } from '../src/hash';

export const PROMPT = `You are an expert CrossFit coach. You are given a photo of a workout (whiteboard, screen or paper). Extract it into the JSON schema provided.

Rules:
1. Read the ENTIRE image. It may contain several columns or sections (warm-up, strength, metcon, accessory).
2. "text": transcribe everything, in the ORIGINAL language of the image, with line breaks and indentation preserved. Combine all sections into one cohesive text but keep the structure of the image. Do not translate, summarize or invent anything. Mark an unreadable fragment as [?].
3. "name": the title of the workout if there is one (e.g. "Fran", "Murph"). Otherwise a short descriptive name (4 words max) based on the main exercises.
4. "format": the format of the MAIN conditioning piece (the metcon), not the warm-up or strength. One of fortime, amrap, emom, tabata, other.
5. "timer": derive ONLY what is written on the board. Omit every field that does not apply.
   - AMRAP of N minutes: durationSec = N*60.
   - EMOM: "EMOM N" or "every minute for N" -> intervalSec 60, rounds N. "Every 2:30 for 6 rounds" -> intervalSec 150, rounds 6. An alternating EMOM over N minutes -> intervalSec 60, rounds N.
   - Tabata: workSec 20, restSec 10, rounds 8 unless other values are written.
   - For Time with a time cap: capSec. No cap written -> omit it.
   - Never guess a number that is not on the board (except the Tabata defaults above).
6. "confidence": high if everything is clearly legible, medium if some parts are uncertain, low if the image is hard to read.
7. "warnings": short messages in the language of the image for anything unclear or illegible (e.g. "line 4 illegible"). Empty array if none.`;

export const SCAN_SCHEMA = {
  type: 'object',
  required: ['name', 'format', 'timer', 'text', 'confidence', 'warnings'],
  properties: {
    name: { type: 'string' },
    format: { type: 'string', enum: ['fortime', 'amrap', 'emom', 'tabata', 'other'] },
    timer: {
      type: 'object',
      properties: {
        capSec: { type: 'integer' },
        durationSec: { type: 'integer' },
        intervalSec: { type: 'integer' },
        rounds: { type: 'integer' },
        workSec: { type: 'integer' },
        restSec: { type: 'integer' },
      },
    },
    text: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

export interface Env {
  GEMINI_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  ALLOWED_ORIGIN: string;
  GEMINI_MODEL?: string;
  SCANS_PER_IP_PER_DAY?: string;
  SCANS_GLOBAL_PER_DAY?: string;
  IP_HASH_SALT?: string;
  KV: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  };
}

const COPY = {
  fr: {
    method: 'Méthode non autorisée.',
    origin: 'Origine refusée.',
    type: 'Envoyez une image WebP ou JPEG.',
    size: 'Image trop lourde (maximum 512 Ko).',
    magic: 'Le fichier n’est pas une image WebP ou JPEG valide.',
    turnstile: 'Vérification anti-abus refusée.',
    quota: 'Limite de scans atteinte pour aujourd’hui. Réessayez demain.',
    timeout: 'Le scan a dépassé 20 secondes.',
    upstream: 'Le scan a échoué. Réessayez.',
    invalid: 'La lecture n’a pas produit un résultat exploitable.',
    config: 'Le service de scan n’est pas configuré.',
  },
  en: {
    method: 'Method not allowed.',
    origin: 'Origin refused.',
    type: 'Send a WebP or JPEG image.',
    size: 'Image too large (512 KB maximum).',
    magic: 'The file is not a valid WebP or JPEG image.',
    turnstile: 'Abuse check refused.',
    quota: 'Daily scan limit reached. Try again tomorrow.',
    timeout: 'The scan took more than 20 seconds.',
    upstream: 'The scan failed. Try again.',
    invalid: 'The reading could not be used.',
    config: 'The scan service is not configured.',
  },
} as const;

type Code = keyof typeof COPY.en;

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('origin') || '';
  const lang = (request.headers.get('accept-language') || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
  const copy = COPY[lang];
  // v1 reads X-License and does not change the quota.
  void request.headers.get('x-license');

  if (request.method === 'OPTIONS') {
    if (origin !== env.ALLOWED_ORIGIN) return json(403, 'origin', copy.origin, origin, false);
    return new Response(null, { status: 204, headers: cors(env.ALLOWED_ORIGIN) });
  }
  if (request.method !== 'POST') return json(405, 'method', copy.method, origin);
  if (origin !== env.ALLOWED_ORIGIN) return json(403, 'origin', copy.origin, origin, false);

  const mime = (request.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase() || '';
  if (mime !== 'image/webp' && mime !== 'image/jpeg') return json(415, 'type', copy.type, origin);
  const declared = Number(request.headers.get('content-length') || '');
  if (Number.isFinite(declared) && declared > 512 * 1024) return json(413, 'size', copy.size, origin);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 512 * 1024) return json(413, 'size', copy.size, origin);
  if (!magicOk(bytes, mime)) return json(400, 'magic', copy.magic, origin);

  const token = request.headers.get('x-turnstile') || '';
  if (!env.TURNSTILE_SECRET || !(await verifyTurnstile(token, env.TURNSTILE_SECRET, request.headers.get('cf-connecting-ip') || ''))) {
    return json(403, 'turnstile', copy.turnstile, origin);
  }

  const digest = await sha256Hex(bytes);
  const cached = await env.KV.get(`cache:${digest}`);
  if (cached) return new Response(cached, { status: 200, headers: cors(origin) });

  const day = new Date().toISOString().slice(0, 10);
  const ipHash = await sha256Hex(`${env.IP_HASH_SALT || 'wodburner-v1'}:${request.headers.get('cf-connecting-ip') || 'unknown'}`);
  const ipKey = `ip:${day}:${ipHash}`;
  const globalKey = `global:${day}`;
  const ipLimit = positiveInt(env.SCANS_PER_IP_PER_DAY, 5);
  const globalLimit = positiveInt(env.SCANS_GLOBAL_PER_DAY, 500);
  const ipCount = Number((await env.KV.get(ipKey)) || '0');
  const globalCount = Number((await env.KV.get(globalKey)) || '0');
  if (ipCount >= ipLimit || globalCount >= globalLimit) return json(429, 'quota', copy.quota, origin);
  await env.KV.put(ipKey, String(ipCount + 1), { expirationTtl: 172800 });
  await env.KV.put(globalKey, String(globalCount + 1), { expirationTtl: 172800 });

  if (!env.GEMINI_API_KEY) return json(502, 'upstream', copy.config, origin);
  let parsed: unknown;
  let lastError: Code = 'invalid';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const payload = await callGemini(env, mime, bytes);
      const text = geminiText(payload);
      if (!text) {
        lastError = 'upstream';
        break;
      }
      parsed = parseScanResult(JSON.parse(text));
      break;
    } catch (error) {
      parsed = undefined;
      if (isTimeout(error)) {
        lastError = 'timeout';
        break;
      }
      if (error instanceof SyntaxError || error instanceof DataError) {
        lastError = 'invalid';
        continue;
      }
      lastError = 'upstream';
      break;
    }
  }
  if (!parsed) {
    const status = lastError === 'timeout' ? 504 : lastError === 'upstream' ? 502 : 422;
    return json(status, lastError, copy[lastError], origin);
  }
  const body = JSON.stringify(parsed);
  await env.KV.put(`cache:${digest}`, body, { expirationTtl: 86400 });
  return new Response(body, { status: 200, headers: cors(origin) });
}

async function callGemini(env: Env, mime: string, bytes: Uint8Array): Promise<unknown> {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY || '' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: bytesToBase64(bytes) } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCAN_SCHEMA },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('upstream');
  return response.json();
}

function geminiText(payload: unknown): string | null {
  if (!isObj(payload) || !Array.isArray(payload.candidates)) return null;
  const candidate = payload.candidates[0];
  if (!isObj(candidate) || !isObj(candidate.content) || !Array.isArray(candidate.content.parts)) return null;
  const text = candidate.content.parts.map((part) => (isObj(part) && typeof part.text === 'string' ? part.text : '')).join('');
  return text || null;
}

async function verifyTurnstile(token: string, secret: string, ip: string): Promise<boolean> {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    const data: unknown = await response.json();
    return isObj(data) && data.success === true;
  } catch {
    return false;
  }
}

function magicOk(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/webp') {
    return bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cors(origin: string): Headers {
  const headers = new Headers();
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-methods', 'POST, OPTIONS');
  headers.set('access-control-allow-headers', 'Content-Type, X-Turnstile, X-License');
  headers.set('access-control-max-age', '86400');
  headers.set('vary', 'Origin');
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return headers;
}

function json(status: number, code: Code, message: string, origin: string, allow = true): Response {
  const headers = allow && origin ? cors(origin) : new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  return new Response(JSON.stringify({ error: code, message }), { status, headers });
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
