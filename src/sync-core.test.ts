import { describe, expect, it } from 'vitest';
import { workoutHash } from './hash';
import { applyFriend, cleanWho, mergePayload, newKey, open, packPayload, parseKey, seal, showKey, tombstoneKey, vaultId } from './sync-core';
import type { Wod } from './types';

async function wod(name: string, at: string): Promise<Wod> {
  const text = `${name} text`;
  return { id: crypto.randomUUID(), name, format: 'other', timer: {}, text, createdAt: at, source: 'manual', hash: await workoutHash(name, 'other', text), results: [] };
}

describe('keys', () => {
  it('makes a 32 character key from 20 bytes', () => {
    const key = newKey();
    expect(key).toHaveLength(32);
    expect(parseKey(showKey(key))).toBe(key);
    expect(newKey()).not.toBe(key);
  });
  it('is deterministic for given bytes and covers the whole alphabet range', () => {
    expect(newKey(new Uint8Array(20))).toBe('0'.repeat(32));
    expect(newKey(new Uint8Array(20).fill(255))).toBe('Z'.repeat(32));
  });
  it('accepts typed keys: case, spaces, look-alikes', () => {
    const key = newKey(new Uint8Array(20).fill(7));
    expect(parseKey(showKey(key).toLowerCase().replace(/-/g, ' '))).toBe(key);
    expect(parseKey('O'.repeat(32))).toBe('0'.repeat(32));
    expect(parseKey('I'.repeat(32))).toBe('1'.repeat(32));
  });
  it('rejects bad keys', () => {
    expect(parseKey('')).toBeNull();
    expect(parseKey('ABC')).toBeNull();
    expect(parseKey('U'.repeat(32))).toBeNull();
    expect(parseKey('0'.repeat(33))).toBeNull();
  });
  it('derives a stable opaque id', async () => {
    const key = newKey();
    expect(await vaultId(key)).toMatch(/^[0-9a-f]{40}$/);
    expect(await vaultId(key)).toBe(await vaultId(key));
    expect(await vaultId(key)).not.toBe(await vaultId(newKey()));
  });
});

describe('seal and open', () => {
  it('round-trips and hides the content', async () => {
    const key = newKey();
    const payload = packPayload([await wod('Fran', '2026-01-01T00:00:00.000Z')], {});
    const blob = await seal(key, payload);
    expect(blob).not.toContain('Fran');
    expect(atob(blob.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('Fran');
    expect(await open(key, blob)).toEqual(payload);
  });
  it('uses a fresh nonce every time', async () => {
    const key = newKey();
    const p = packPayload([], {});
    expect(await seal(key, p)).not.toBe(await seal(key, p));
  });
  it('fails with the wrong key or a damaged blob', async () => {
    const blob = await seal(newKey(), packPayload([], {}));
    await expect(open(newKey(), blob)).rejects.toThrow();
    await expect(open(newKey(), blob.slice(0, -4) + 'AAAA')).rejects.toThrow();
    await expect(open(newKey(), 'zz')).rejects.toThrow();
  });
});

describe('mergePayload', () => {
  it('keeps the union of both devices', async () => {
    const a = await wod('Fran', '2026-01-01T00:00:00.000Z');
    const b = await wod('Cindy', '2026-02-01T00:00:00.000Z');
    const merged = await mergePayload([a], {}, packPayload([b], {}));
    expect(merged.wods.map((w) => w.name)).toEqual(['Cindy', 'Fran']);
    expect(merged.added).toBe(1);
  });
  it('works with nothing on the server yet', async () => {
    const a = await wod('Fran', '2026-01-01T00:00:00.000Z');
    expect((await mergePayload([a], {}, null)).wods).toHaveLength(1);
  });
  it('a deletion on one device removes it on the other', async () => {
    const a = await wod('Fran', '2026-01-01T00:00:00.000Z');
    const remote = packPayload([], { [a.hash]: '2026-03-01T00:00:00.000Z' });
    const merged = await mergePayload([a], {}, remote);
    expect(merged.wods).toHaveLength(0);
    expect(merged.deleted[a.hash]).toBe('2026-03-01T00:00:00.000Z');
  });
  it('a local deletion is not undone by an older remote copy', async () => {
    const a = await wod('Fran', '2026-01-01T00:00:00.000Z');
    const merged = await mergePayload([], { [a.hash]: '2026-03-01T00:00:00.000Z' }, packPayload([a], {}));
    expect(merged.wods).toHaveLength(0);
  });
  it('a workout saved again after its deletion comes back', async () => {
    const a = await wod('Fran', '2026-05-01T00:00:00.000Z');
    const merged = await mergePayload([a], { [a.hash]: '2026-03-01T00:00:00.000Z' }, null);
    expect(merged.wods).toHaveLength(1);
  });
  it('ignores junk in the remote deleted list', async () => {
    const a = await wod('Fran', '2026-01-01T00:00:00.000Z');
    const remote = { v: 1 as const, wods: packPayload([], {}).wods, deleted: { nope: 'x', [a.hash]: 12 } as never };
    expect((await mergePayload([a], {}, remote)).wods).toHaveLength(1);
  });
  it('does not delete a friend copy when ours is deleted', async () => {
    const mine = await wod('Fran', '2026-01-01T00:00:00.000Z');
    const theirs = { ...mine, id: crypto.randomUUID(), by: 'ab'.repeat(20), who: 'Alex' };
    const merged = await mergePayload([mine, theirs], { [mine.hash]: '2026-03-01T00:00:00.000Z' }, null);
    expect(merged.wods).toEqual([theirs]);
  });
  it('merges results of the same workout', async () => {
    const a = await wod('Fran', '2026-01-01T00:00:00.000Z');
    const withResult = { ...a, results: [{ at: '2026-01-02T00:00:00.000Z', kind: 'free' as const, value: '4:12' }] };
    const merged = await mergePayload([a], {}, packPayload([withResult], {}));
    expect(merged.wods[0]?.results).toHaveLength(1);
  });
});

describe('friend copy', () => {
  it('adds their workouts under their name and leaves ours in place', async () => {
    const mine = await wod('Fran', '2026-01-01T00:00:00.000Z');
    const theirs = await wod('Cindy', '2026-02-01T00:00:00.000Z');
    const nested = { ...theirs, id: crypto.randomUUID(), name: 'Murph', by: 'cd'.repeat(20), who: 'Sam' };
    const friend = { id: 'ab'.repeat(20), name: '  Alex  ' };
    const copy = applyFriend([mine], [theirs, nested], friend, {});
    expect(copy.added).toBe(1);
    expect(copy.wods.map((item) => item.name).sort()).toEqual(['Cindy', 'Fran']);
    expect(copy.wods.find((item) => item.name === 'Cindy')?.who).toBe('Alex');
    expect(copy.wods.find((item) => item.name === 'Fran')?.by).toBeUndefined();
    expect(cleanWho('  Alex  ')).toBe('Alex');
  });
  it('does not bring back a copy that was deleted here', async () => {
    const theirs = await wod('Cindy', '2026-02-01T00:00:00.000Z');
    const id = 'ab'.repeat(20);
    const copy = applyFriend([], [theirs], { id, name: 'Alex' }, { [tombstoneKey({ hash: theirs.hash, by: id })]: '2026-03-01T00:00:00.000Z' });
    expect(copy.wods).toHaveLength(0);
    expect(copy.changed).toBe(false);
  });
  it('drops a workout they removed', async () => {
    const theirs = await wod('Cindy', '2026-02-01T00:00:00.000Z');
    const id = 'ab'.repeat(20);
    const kept = { ...theirs, by: id, who: 'Alex' };
    const copy = applyFriend([kept], [], { id, name: 'Alex' }, {});
    expect(copy.wods).toHaveLength(0);
    expect(copy.dropped).toEqual([tombstoneKey(kept)]);
  });
});
