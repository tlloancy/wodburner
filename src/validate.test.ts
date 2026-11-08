import { describe, expect, it } from 'vitest';
import { parseWod } from './validate';

const base = { id: 'a', name: 'Fran', format: 'fortime', timer: {}, text: '21-15-9', source: 'manual', hash: 'a'.repeat(64), results: [] };

describe('dates', () => {
  it('stores every date in UTC so that text comparison orders them', () => {
    const wod = parseWod({ ...base, createdAt: '2026-05-01T12:00:00+02:00', results: [{ at: '2026-05-01T12:00:00+02:00', kind: 'free', value: '4:12' }] });
    expect(wod.createdAt).toBe('2026-05-01T10:00:00.000Z');
    expect(wod.results[0]?.at).toBe('2026-05-01T10:00:00.000Z');
  });
});
