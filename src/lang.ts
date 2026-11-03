export const SUPPORTED: readonly string[] = ['fr', 'en'];
export const DEFAULT_LANG = 'en';
export const LANG_KEY = 'wb-lang';

export interface ChooseInput {
  stored?: unknown;
  languages?: readonly string[];
  supported?: readonly string[];
}

// Picks the language to show. A stored explicit choice wins. Without one, the first browser
// language that the site supports wins (fr-CA counts as fr). Otherwise English.
export function chooseLang(input: ChooseInput = {}): string {
  const supported = input.supported ?? SUPPORTED;
  if (typeof input.stored === 'string' && supported.includes(input.stored)) return input.stored;
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

export function readChoice(): string | null {
  try {
    const value = localStorage.getItem(LANG_KEY);
    return value && SUPPORTED.includes(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeChoice(lang: string): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Storage can be blocked. The page still works, the choice is just not kept.
  }
}

export function clearChoice(): void {
  try {
    localStorage.removeItem(LANG_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

interface BannerCopy {
  text: string;
  go: string;
  stay: Record<string, string>;
}

// The banner speaks the language it offers, so a French reader on an English page reads French.
export const BANNER: Record<string, BannerCopy> = {
  fr: { text: 'Cette page existe en français.', go: 'Voir en français', stay: { en: 'Rester en anglais' } },
  en: { text: 'This page is also available in English.', go: 'View in English', stay: { fr: 'Stay in French' } },
};
