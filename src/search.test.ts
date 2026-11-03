import { describe, expect, it } from 'vitest';
import { buildIndex, fold, matchRanges, normalize, parseQuery, search, sortHits } from './search';

interface W {
  name: string;
  text: string;
  meta?: string;
}
const read = (w: W) => ({ name: w.name, text: w.text, meta: w.meta ?? '' });
const run = (items: W[], q: string) => search(buildIndex(items, read), parseQuery(q)).map((h) => h.item.name);

const WODS: W[] = [
  { name: 'Fran', text: '21-15-9 thrusters, pull-ups' },
  { name: 'Cindy', text: '20 min AMRAP 5 pull-ups 10 push-ups 15 squats' },
  { name: 'Mon WOD du mardi', text: '3 tours: 10 tractions, 20 pompes, 30 abdos' },
  { name: 'Deadlift day', text: '5x5 deadlift' },
  { name: 'Éléphant', text: 'Soulevé de terre 1RM' },
];

describe('normalize', () => {
  it('drops accents, case, hyphens and extra spaces', () => {
    expect(normalize('  Éléphant  ')).toBe('elephant');
    expect(normalize('Pull-Ups')).toBe('pull ups');
    expect(normalize('snatch_balance')).toBe('snatch balance');
    expect(normalize('')).toBe('');
  });
  it('maps folded positions back to the original', () => {
    const f = fold('Épaulé  jeté');
    expect(f.text).toBe('epaule jete');
    expect(f.map.length).toBe(f.text.length);
  });
});

describe('search', () => {
  it('returns everything for an empty query', () => {
    expect(run(WODS, '   ')).toHaveLength(WODS.length);
  });
  it('ignores accents and case', () => {
    expect(run(WODS, 'elephant')).toEqual(['Éléphant']);
    expect(run(WODS, 'ELEPHANT')).toEqual(['Éléphant']);
  });
  it('requires every word', () => {
    expect(run(WODS, 'pull thrusters')).toEqual(['Fran']);
    expect(run(WODS, 'pull zzz')).toEqual([]);
  });
  it('finds pullups, pull-ups and pull ups alike', () => {
    expect(run(WODS, 'pullups').sort()).toEqual(['Cindy', 'Fran', 'Mon WOD du mardi']);
    expect(run(WODS, 'pull ups').sort()).toEqual(['Cindy', 'Fran', 'Mon WOD du mardi']);
  });
  it('crosses French and English', () => {
    expect(run(WODS, 'traction')).toContain('Fran');
    expect(run(WODS, 'pull up')).toContain('Mon WOD du mardi');
    expect(run(WODS, 'deadlift').sort()).toEqual(['Deadlift day', 'Éléphant']);
    expect(run(WODS, 'souleve de terre').sort()).toEqual(['Deadlift day', 'Éléphant']);
    expect(run(WODS, 'pompe')).toContain('Cindy');
  });
  it('ranks name matches above text matches', () => {
    expect(run(WODS, 'deadlift')[0]).toBe('Deadlift day');
  });
  it('keeps input order on ties', () => {
    const items = [{ name: 'a', text: 'row' }, { name: 'b', text: 'row' }, { name: 'c', text: 'row' }];
    expect(run(items, 'row')).toEqual(['a', 'b', 'c']);
  });
  it('sorts A to Z on request', () => {
    const hits = search(buildIndex(WODS, read), parseQuery(''));
    expect(sortHits(hits, 'name', (w) => w.name).map((h) => h.item.name)[0]).toBe('Cindy');
  });
});

describe('matchRanges', () => {
  it('maps matches back onto accented text', () => {
    const text = 'Soulevé de terre';
    const r = matchRanges(text, parseQuery('souleve'));
    expect(text.slice(r[0]![0], r[0]![1]).startsWith('Soulevé')).toBe(true);
  });
  it('highlights synonyms and merges overlaps', () => {
    const text = '10 tractions';
    const r = matchRanges(text, parseQuery('pull up'));
    expect(r.map(([a, b]) => text.slice(a, b))).toEqual(['traction']);
    expect(matchRanges('abcabc', parseQuery('abc'))).toEqual([[0, 6]]);
  });
  it('returns nothing for an empty query', () => {
    expect(matchRanges('hello', parseQuery(''))).toEqual([]);
  });
});

describe('speed', () => {
  it('searches 5000 workouts in under 50 ms', () => {
    const words = ['thrusters', 'pull-ups', 'tractions', 'squats', 'burpees', 'row', 'run', 'deadlift', 'snatch'];
    const items: W[] = Array.from({ length: 5000 }, (_, i) => ({
      name: `WOD ${i}`,
      text: Array.from({ length: 12 }, (_, k) => `${(i + k) % 20} ${words[(i * 7 + k) % words.length]}`).join(', '),
    }));
    const index = buildIndex(items, read);
    const q = parseQuery('pull up thrusters');
    search(index, q);
    const t = performance.now();
    search(index, q);
    expect(performance.now() - t).toBeLessThan(50);
  });
});
