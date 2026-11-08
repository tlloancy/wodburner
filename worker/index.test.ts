import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, SCAN_SCHEMA, type Env } from './index';
import { newKey, open, packPayload, seal, shareCode, vaultId, writeToken } from '../src/sync-core';

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async put(key: string, value: string) {
      map.set(key, value);
    },
    async delete(key: string) {
      map.delete(key);
    },
  };
}

function jpeg(marker: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, marker, 0x00, 0x11]);
}

function env(over: Partial<Env> = {}): Env {
  return {
    ALLOWED_ORIGIN: 'https://wodburner.app',
    GEMINI_API_KEY: 'test-key',
    TURNSTILE_SECRET: 'turnstile-secret',
    IP_HASH_SALT: 'test-salt-0123456789abcdef',
    GEMINI_MODEL: 'gemini-2.5-flash',
    KV: memory(),
    ...over,
  };
}

let geminiCalls = 0;
let mode: 'ok' | 'bad-once' | 'bad' | 'timeout' | 'http' = 'ok';
let lastGemini: { url: string; init: RequestInit } | null = null;

function installFetch(): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('siteverify')) {
      const body = String(init?.body ?? '');
      return new Response(JSON.stringify({ success: body.includes('response=ok') }), { status: 200 });
    }
    if (url.includes(':generateContent')) {
      geminiCalls += 1;
      lastGemini = { url, init: init || {} };
      if (mode === 'timeout') throw new DOMException('slow', 'TimeoutError');
      if (mode === 'http') return new Response('nope', { status: 500 });
      const bad = mode === 'bad' || (mode === 'bad-once' && geminiCalls === 1);
      const text = bad ? 'not-json' : JSON.stringify({ name: 'Fran', format: 'fortime', timer: {}, text: '21-15-9', confidence: 'high', warnings: [] });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  });
}

function post(bytes: Uint8Array, headers: Record<string, string> = {}): Request {
  return new Request('https://scan.wodburner.app/scan', {
    method: 'POST',
    headers: {
      origin: 'https://wodburner.app',
      'content-type': 'image/jpeg',
      'x-turnstile': 'ok',
      ...headers,
    },
    body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  geminiCalls = 0;
  mode = 'ok';
  lastGemini = null;
});

describe('scan worker', () => {
  it('rejects the wrong method, origin, type, size and magic bytes', async () => {
    installFetch();
    const box = env();
    expect((await handleRequest(new Request('https://scan.wodburner.app/scan', { method: 'GET', headers: { origin: box.ALLOWED_ORIGIN } }), box)).status).toBe(405);
    expect((await handleRequest(post(jpeg(1), { origin: 'https://evil.test' }), box)).status).toBe(403);
    expect((await handleRequest(post(jpeg(1), { 'content-type': 'text/plain' }), box)).status).toBe(415);
    const huge = new Uint8Array(513 * 1024);
    huge.set([0xff, 0xd8, 0xff], 0);
    expect((await handleRequest(post(huge), box)).status).toBe(413);
    expect((await handleRequest(post(new Uint8Array([1, 2, 3, 4])), box)).status).toBe(400);
  });

  it('requires Turnstile and ignores X-License for the quota', async () => {
    installFetch();
    const box = env();
    expect((await handleRequest(post(jpeg(1), { 'x-turnstile': 'bad' }), box)).status).toBe(403);
    for (let i = 0; i < 5; i++) {
      const response = await handleRequest(post(jpeg(i + 2), { 'x-license': 'future-key' }), box);
      expect(response.status).toBe(200);
    }
    const blocked = await handleRequest(post(jpeg(20), { 'x-license': 'future-key' }), box);
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: string; message: string };
    expect(body.error).toBe('quota');
    expect(body.message.length).toBeGreaterThan(0);
  });

  it('caches the same image and does not call Gemini twice', async () => {
    installFetch();
    const box = env();
    const bytes = jpeg(7);
    expect((await handleRequest(post(bytes), box)).status).toBe(200);
    expect((await handleRequest(post(bytes), box)).status).toBe(200);
    expect(geminiCalls).toBe(1);
    const headers = new Headers(lastGemini?.init.headers);
    expect(headers.get('x-goog-api-key')).toBe('test-key');
    expect(lastGemini?.url).not.toContain('test-key');
    expect(lastGemini?.url).toContain('gemini-2.5-flash');
    const sent = JSON.parse(String(lastGemini?.init.body));
    expect(sent.generationConfig.temperature).toBe(0);
    expect(sent.generationConfig.responseMimeType).toBe('application/json');
    expect(sent.generationConfig.responseSchema).toEqual(SCAN_SCHEMA);
    expect(SCAN_SCHEMA.required).toContain('parts');
    expect(sent.contents[0].parts[1].inline_data.mime_type).toBe('image/jpeg');
    expect(typeof sent.contents[0].parts[1].inline_data.data).toBe('string');
  });

  it('retries once on invalid JSON', async () => {
    installFetch();
    mode = 'bad-once';
    const response = await handleRequest(post(jpeg(8)), env());
    expect(response.status).toBe(200);
    expect(geminiCalls).toBe(2);
    mode = 'bad';
    geminiCalls = 0;
    const failed = await handleRequest(post(jpeg(9)), env());
    expect(failed.status).toBe(422);
    expect(geminiCalls).toBe(2);
  });

  it('returns a timeout and does not log the image or the text', async () => {
    installFetch();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mode = 'timeout';
    const response = await handleRequest(post(jpeg(10)), env());
    expect(response.status).toBe(504);
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it('refuses to run without a real IP salt', async () => {
    installFetch();
    const response = await handleRequest(post(jpeg(40)), env({ IP_HASH_SALT: undefined }));
    expect(response.status).toBe(503);
    expect(geminiCalls).toBe(0);
  });

  it('gives the quota back when the provider fails', async () => {
    installFetch();
    const e = env({ SCANS_PER_IP_PER_DAY: '1' });
    mode = 'http';
    expect((await handleRequest(post(jpeg(41)), e)).status).toBe(502);
    mode = 'ok';
    expect((await handleRequest(post(jpeg(42)), e)).status).toBe(200);
  });

  it('a refund never takes the counter below what other requests added', async () => {
    installFetch();
    const box = env({ SCANS_PER_IP_PER_DAY: '3' });
    mode = 'http';
    expect((await handleRequest(post(jpeg(60)), box)).status).toBe(502);
    const counters = [...(box.KV as unknown as { map: Map<string, string> }).map.entries()].filter(([key]) => key.startsWith('ip:') || key.startsWith('global:'));
    expect(counters.every(([, value]) => value === '0')).toBe(true);
  });

  it('uses GEMINI_MODEL from the environment', async () => {
    installFetch();
    await handleRequest(post(jpeg(11)), env({ GEMINI_MODEL: 'custom-model' }));
    expect(lastGemini?.url).toContain('/models/custom-model:');
  });

  it('answers a preflight for the site origin only', async () => {
    installFetch();
    const ok = await handleRequest(new Request('https://scan.wodburner.app/scan', { method: 'OPTIONS', headers: { origin: 'https://wodburner.app' } }), env());
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://wodburner.app');
    const denied = await handleRequest(new Request('https://scan.wodburner.app/scan', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }), env());
    expect(denied.status).toBe(403);
  });
});

describe('sync endpoint', () => {
  const id = 'a'.repeat(40);
  const token = 'b'.repeat(64);
  const call = (method: string, path: string, body?: string, origin = 'https://wodburner.app', write: string | null = token) =>
    new Request(`https://scan.wodburner.app${path}`, { method, headers: { origin, 'content-type': 'text/plain', ...(write ? { 'x-write-token': write } : {}) }, body });

  it('stores, returns and deletes an opaque blob', async () => {
    const box = env();
    expect((await handleRequest(call('GET', `/sync/${id}`), box)).status).toBe(404);
    expect((await handleRequest(call('PUT', `/sync/${id}`, 'Abc_-123'), box)).status).toBe(204);
    const got = await handleRequest(call('GET', `/sync/${id}`), box);
    expect(got.status).toBe(200);
    expect(await got.text()).toBe('Abc_-123');
    expect(got.headers.get('access-control-allow-origin')).toBe('https://wodburner.app');
    expect((await handleRequest(call('DELETE', `/sync/${id}`), box)).status).toBe(204);
    expect((await handleRequest(call('GET', `/sync/${id}`), box)).status).toBe(404);
  });

  it('refuses a bad origin, a bad id, a bad body and a missing salt', async () => {
    const box = env();
    expect((await handleRequest(call('PUT', `/sync/${id}`, 'x', 'https://evil.test'), box)).status).toBe(403);
    expect((await handleRequest(call('GET', '/sync/short'), box)).status).toBe(400);
    expect((await handleRequest(call('PUT', `/sync/${id}`, '<script>'), box)).status).toBe(413);
    expect((await handleRequest(call('PUT', `/sync/${id}`, 'x'.repeat(900_001)), box)).status).toBe(413);
    expect((await handleRequest(call('PUT', `/sync/${id}`, 'abc'), env({ IP_HASH_SALT: undefined }))).status).toBe(503);
    expect((await handleRequest(call('PATCH', `/sync/${id}`, 'abc'), box)).status).toBe(405);
  });

  it('limits writes per IP per day', async () => {
    const box = env({ SYNC_WRITES_PER_IP_PER_DAY: '2' });
    expect((await handleRequest(call('PUT', `/sync/${id}`, 'a'), box)).status).toBe(204);
    expect((await handleRequest(call('PUT', `/sync/${id}`, 'b'), box)).status).toBe(204);
    expect((await handleRequest(call('PUT', `/sync/${id}`, 'c'), box)).status).toBe(429);
  });

  it('only the holder of the write token can change or delete a backup', async () => {
    const box = env();
    expect((await handleRequest(call('PUT', `/sync/${id}`, 'first'), box)).status).toBe(204);
    const other = 'c'.repeat(64);
    expect((await handleRequest(call('PUT', `/sync/${id}`, 'hijack', undefined, other), box)).status).toBe(403);
    expect((await handleRequest(call('DELETE', `/sync/${id}`, undefined, undefined, other), box)).status).toBe(403);
    expect((await handleRequest(call('PUT', `/sync/${id}`, 'no-token', undefined, null), box)).status).toBe(403);
    expect((await handleRequest(call('PUT', `/sync/${id}`, 'second'), box)).status).toBe(204);
    // Reading needs no token: that is what makes a read-only copy possible.
    expect(await (await handleRequest(call('GET', `/sync/${id}`, undefined, undefined, null), box)).text()).toBe('second');
    expect((await handleRequest(call('DELETE', `/sync/${id}`), box)).status).toBe(204);
  });

  it('never stores the token itself', async () => {
    const box = env();
    await handleRequest(call('PUT', `/sync/${id}`, 'x'), box);
    const stored = [...(box.KV as unknown as { map: Map<string, string> }).map.values()];
    expect(stored).not.toContain(token);
  });

  it('a backup made before tokens existed is claimed by its first write', async () => {
    const box = env();
    await box.KV.put(`sync:${id}`, 'old');
    expect((await handleRequest(call('PUT', `/sync/${id}`, 'new'), box)).status).toBe(204);
    expect((await handleRequest(call('PUT', `/sync/${id}`, 'again', undefined, 'c'.repeat(64)), box)).status).toBe(403);
  });

  it('rations new backups and keeps the first one small', async () => {
    const box = env({ SYNC_CREATES_PER_IP_PER_DAY: '2' });
    const make = (n: number) => `/sync/${n.toString(16).padStart(40, '0')}`;
    expect((await handleRequest(call('PUT', make(1), 'x'.repeat(262_145)), box)).status).toBe(413);
    expect((await handleRequest(call('PUT', make(1), 'a'), box)).status).toBe(204);
    expect((await handleRequest(call('PUT', make(2), 'a'), box)).status).toBe(204);
    expect((await handleRequest(call('PUT', make(3), 'a'), box)).status).toBe(429);
    // Updating an existing backup is not a creation, and can be large.
    expect((await handleRequest(call('PUT', make(1), 'x'.repeat(300_000)), box)).status).toBe(204);
  });

  it('stops reading a body that is bigger than the limit even without a declared length', async () => {
    const box = env();
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 10; i++) controller.enqueue(new TextEncoder().encode('a'.repeat(100_000)));
        controller.close();
      },
    });
    const request = new Request(`https://scan.wodburner.app/sync/${id}`, { method: 'PUT', headers: { origin: 'https://wodburner.app', 'x-write-token': token }, body: stream, duplex: 'half' } as RequestInit);
    expect((await handleRequest(request, box)).status).toBe(413);
  });

  it('accepts several allowed origins', async () => {
    const box = env({ ALLOWED_ORIGIN: 'https://wodburner.app, https://preview.wodburner.pages.dev' });
    const ok = await handleRequest(call('GET', `/sync/${id}`, undefined, 'https://preview.wodburner.pages.dev'), box);
    expect(ok.status).toBe(404);
    expect((await handleRequest(call('GET', `/sync/${id}`, undefined, 'https://evil.test'), box)).status).toBe(403);
  });
});

describe('sharing end to end', () => {
  const call = (method: string, id: string, body?: string, token?: string) =>
    new Request(`https://scan.wodburner.app/sync/${id}`, { method, headers: { origin: 'https://wodburner.app', 'content-type': 'text/plain', ...(token ? { 'x-write-token': token } : {}) }, body });

  it('a friend can read the share copy but cannot change it, delete it or reach the backup', async () => {
    const box = env();
    const key = newKey();
    const code = await shareCode(key);
    const token = await writeToken(key);
    expect((await handleRequest(call('PUT', await vaultId(key), await seal(key, packPayload([], {}, 'Me')), token), box)).status).toBe(204);
    expect((await handleRequest(call('PUT', await vaultId(code), await seal(code, packPayload([], {}, 'Me')), token), box)).status).toBe(204);

    // The friend only holds the share code. Everything they can derive from it fails.
    const friendToken = await writeToken(code);
    const copy = await (await handleRequest(call('GET', await vaultId(code)), box)).text();
    expect((await open(code, copy)).who).toBe('Me');
    expect((await handleRequest(call('PUT', await vaultId(code), await seal(code, packPayload([], {}, 'Hacked')), friendToken), box)).status).toBe(403);
    expect((await handleRequest(call('DELETE', await vaultId(code), undefined, friendToken), box)).status).toBe(403);
    expect((await handleRequest(call('GET', await vaultId(code)), box)).status).toBe(200);
    // Nothing derived from the code leads to the backup itself.
    expect((await handleRequest(call('GET', await vaultId(await shareCode(code))), box)).status).toBe(404);
  });
});
