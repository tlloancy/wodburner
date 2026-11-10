import { describe, expect, it } from 'vitest';
import { lineKind } from './board-view';

describe('lineKind', () => {
  it('keeps a movement apart from a rest, a note and a scale line', () => {
    expect(lineKind('100 bmu')).toBe('move');
    expect(lineKind('3 ROUNDS:')).toBe('kicker');
    expect(lineKind("1' rest")).toBe('rest');
    expect(lineKind('CONSIGNES:')).toBe('note');
    expect(lineKind('-> switch directement')).toBe('note');
    expect(lineKind('Rx: 70/50kg')).toBe('pair');
    expect(lineKind('Athlete A: max bmu')).toBe('pair');
  });
});