import { describe, expect, it } from 'vitest';
import { qrModules } from './qr';

describe('qr', () => {
  it('builds a version 1 code for a short text', () => {
    const code = qrModules('A');
    expect(code.n).toBe(21);
    expect(code.dark).toHaveLength(21 * 21);
    expect(code.dark[0]).toBe(1);
    expect(code.dark[20]).toBe(1);
    expect(code.dark[20 * 21]).toBe(1);
  });

  it('fits a sync link in version 4', () => {
    const link = `https://wodburner.app/fr/dashboard/#k=${'A'.repeat(32)}`;
    expect(qrModules(link).n).toBe(33);
  });

  it('refuses a text that does not fit', () => {
    expect(() => qrModules('x'.repeat(120))).toThrow('qr');
  });
});
