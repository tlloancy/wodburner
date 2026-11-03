import { describe, expect, it } from 'vitest';
import { canonicalWorkout, workoutHash } from './hash';
import { parseExport, parseScanResult, DataError } from './validate';
import { importDocument, mergeByHash } from './transfer';
import { timerHref } from './timer-link';
import type { Wod } from './types';

const HASH = 'a'.repeat(64);

function wod(partial: Partial<Wod> = {}): Wod {
  return {
    id: partial.id ?? '11111111-1111-4111-8111-111111111111',
    name: partial.name ?? 'Fran',
    format: partial.format ?? 'fortime',
    timer: partial.timer ?? {},
    text: partial.text ?? '21-15-9',
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00.000Z',
    source: partial.source ?? 'manual',
    hash: partial.hash ?? HASH,
    results: partial.results ?? [],
    ...(partial.by ? { by: partial.by } : {}),
    ...(partial.who ? { who: partial.who } : {}),
  };
}

describe('hash', () => {
  it('normalizes name and newlines', async () => {
    expect(canonicalWorkout('  Fran  ', 'fortime', 'a \r\nb')).toBe(canonicalWorkout('fran', 'fortime', 'a\nb'));
    const a = await workoutHash('Fran', 'fortime', '21-15-9');
    const b = await workoutHash(' fran ', 'fortime', '21-15-9\n');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('validate', () => {
  it('accepts a scan result and rejects a bad format', () => {
    const parsed = parseScanResult({
      name: 'Fran',
      format: 'fortime',
      timer: { capSec: 900 },
      text: '21-15-9',
      confidence: 'high',
      warnings: [],
    });
    expect(parsed.timer.capSec).toBe(900);
    expect(() => parseScanResult({ ...parsed, format: 'nope' })).toThrow(DataError);
  });

  it('rejects an unknown export version', () => {
    expect(() => parseExport({ version: 2, exportedAt: '2026-01-01T00:00:00.000Z', wods: [] })).toThrow(DataError);
  });
});

describe('merge', () => {
  it('merges the same hash and keeps both results', () => {
    const left = wod({ results: [{ at: '2026-01-01T00:00:00.000Z', kind: 'time', value: '4:12' }] });
    const right = wod({
      id: '22222222-2222-4222-8222-222222222222',
      createdAt: '2025-01-01T00:00:00.000Z',
      results: [
        { at: '2026-01-01T00:00:00.000Z', kind: 'time', value: '4:12' },
        { at: '2026-02-01T00:00:00.000Z', kind: 'time', value: '3:58' },
      ],
    });
    const merged = mergeByHash([left], [right]);
    expect(merged.added).toBe(0);
    expect(merged.merged).toBe(1);
    expect(merged.wods).toHaveLength(1);
    expect(merged.wods[0]?.id).toBe(left.id);
    expect(merged.wods[0]?.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(merged.wods[0]?.results.map((result) => result.value)).toEqual(['4:12', '3:58']);
  });

  it('keeps a friend copy apart from ours when the hash matches', () => {
    const mine = wod();
    const theirs = wod({ id: '22222222-2222-4222-8222-222222222222', by: 'a'.repeat(40), who: 'Alex' });
    const merged = mergeByHash([mine], [theirs]);
    expect(merged.added).toBe(1);
    expect(merged.wods).toHaveLength(2);
    expect(merged.wods.find((item) => item.by)?.who).toBe('Alex');
  });

  it('recomputes the hash on import', async () => {
    const incoming = wod();
    const file = { version: 1, exportedAt: '2026-03-01T00:00:00.000Z', wods: [incoming] };
    const result = await importDocument([], file);
    expect(result.added).toBe(1);
    expect(result.wods[0]?.hash).toBe(await workoutHash('Fran', 'fortime', '21-15-9'));
  });
});

describe('timer links', () => {
  it('matches the public query shape', () => {
    expect(timerHref('en', 'emom', { rounds: 10, intervalSec: 60 }, 'EMOM')).toBe('/en/timers/emom/?name=EMOM&min=10&int=60');
    expect(timerHref('en', 'amrap', { durationSec: 20 * 60 })).toBe('/en/timers/amrap/?min=20');
    expect(timerHref('en', 'tabata', { workSec: 20, restSec: 10, rounds: 8 })).toBe('/en/timers/tabata/?work=20&rest=10&rounds=8');
    expect(timerHref('en', 'fortime', { capSec: 900 })).toBe('/en/timers/for-time/?cap=900');
    expect(timerHref('fr', 'fortime', {}, 'Fran')).toBe('/fr/timers/for-time/?name=Fran&open=1');
  });
});
