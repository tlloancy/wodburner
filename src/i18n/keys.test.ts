import { describe, expect, it } from 'vitest';
import fr from './fr.json';
import en from './en.json';

function keys(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => keys(item, `${prefix}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => keys(item, prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

describe('i18n', () => {
  it('gives French and English the same keys', () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
  });
});
