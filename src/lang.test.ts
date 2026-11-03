import { describe, expect, it } from 'vitest';
import { chooseLang, pageLang, swapLang } from './lang';

describe('chooseLang', () => {
  it('uses the stored choice first', () => {
    expect(chooseLang({ stored: 'en', languages: ['fr-FR'] })).toBe('en');
    expect(chooseLang({ stored: 'fr', languages: ['en-US'] })).toBe('fr');
  });

  it('ignores a stored value the site does not support', () => {
    expect(chooseLang({ stored: 'de', languages: ['fr-FR'] })).toBe('fr');
    expect(chooseLang({ stored: 42, languages: ['fr'] })).toBe('fr');
    expect(chooseLang({ stored: null, languages: [] })).toBe('en');
  });

  it('matches regional tags on their language', () => {
    expect(chooseLang({ languages: ['fr-CA'] })).toBe('fr');
    expect(chooseLang({ languages: ['FR_be'] })).toBe('fr');
    expect(chooseLang({ languages: ['en-GB'] })).toBe('en');
  });

  it('walks the whole browser list, not just the first language', () => {
    expect(chooseLang({ languages: ['de-DE', 'fr-FR', 'en'] })).toBe('fr');
    expect(chooseLang({ languages: ['es-ES', 'en-US'] })).toBe('en');
  });

  it('falls back to English when nothing matches', () => {
    expect(chooseLang({ languages: ['de-DE', 'ja'] })).toBe('en');
    expect(chooseLang()).toBe('en');
    expect(chooseLang({ languages: [''] })).toBe('en');
  });

  it('supports a third language through the supported list', () => {
    expect(chooseLang({ languages: ['es-MX'], supported: ['fr', 'en', 'es'] })).toBe('es');
    expect(chooseLang({ stored: 'es', languages: ['fr'], supported: ['fr', 'en', 'es'] })).toBe('es');
  });
});

describe('pageLang and swapLang', () => {
  it('reads the language of a localized path', () => {
    expect(pageLang('/fr/')).toBe('fr');
    expect(pageLang('/en/timers/emom/')).toBe('en');
    expect(pageLang('/fr')).toBe('fr');
  });

  it('returns null for the root and unknown paths', () => {
    expect(pageLang('/')).toBeNull();
    expect(pageLang('/index.html')).toBeNull();
    expect(pageLang('/de/')).toBeNull();
    expect(pageLang('/frank/')).toBeNull();
    expect(pageLang('/404.html')).toBeNull();
  });

  it('keeps the rest of the path when it swaps', () => {
    expect(swapLang('/en/timers/emom/', 'fr')).toBe('/fr/timers/emom/');
    expect(swapLang('/fr/hero-wods/fran/', 'en')).toBe('/en/hero-wods/fran/');
    expect(swapLang('/fr/', 'en')).toBe('/en/');
    expect(swapLang('/', 'fr')).toBe('/fr/');
  });
});
