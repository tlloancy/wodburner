export const SUPPORTED: readonly string[] = ['fr', 'en'];
export const DEFAULT_LANG = 'en';

export interface ChooseInput {
  languages?: readonly string[];
  supported?: readonly string[];
}

// The phone language wins. fr-CA counts as fr. Otherwise English.
export function chooseLang(input: ChooseInput = {}): string {
  const supported = input.supported ?? SUPPORTED;
  for (const tag of input.languages ?? []) {
    const base = String(tag).toLowerCase().split(/[-_]/)[0] ?? '';
    if (supported.includes(base)) return base;
  }
  return supported.includes(DEFAULT_LANG) ? DEFAULT_LANG : (supported[0] ?? DEFAULT_LANG);
}

// The language carried by a path such as /fr/timers/, or null for the root and unknown paths.
export function pageLang(pathname: string, supported: readonly string[] = SUPPORTED): string | null {
  const match = /^\/([a-z]{2})(?=\/|$)/.exec(pathname);
  return match && supported.includes(match[1] as string) ? (match[1] as string) : null;
}

// The same page in another language: /en/timers/emom/ becomes /fr/timers/emom/.
export function swapLang(pathname: string, to: string, supported: readonly string[] = SUPPORTED): string {
  const from = pageLang(pathname, supported);
  if (!from) return `/${to}/`;
  return `/${to}${pathname.slice(from.length + 1)}`;
}

export function browserLanguages(): readonly string[] {
  const list = typeof navigator === 'undefined' ? [] : navigator.languages;
  if (list && list.length > 0) return list;
  return typeof navigator === 'undefined' || !navigator.language ? [] : [navigator.language];
}
