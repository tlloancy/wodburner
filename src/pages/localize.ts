import { BANNER, SUPPORTED, browserLanguages, chooseLang, pageLang, readChoice, swapLang, writeChoice } from '../lang';

// Runs in <head> on /fr/* and /en/*. All of it is client-side: the HTML a crawler gets never changes.
// A visit is not a choice. The language is stored only when the person clicks.

function whenReady(run: () => void): void {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
}

function target(other: string): string {
  return `${swapLang(location.pathname, other)}${location.search}${location.hash}`;
}

function wireSwitch(here: string): void {
  const link = document.querySelector<HTMLAnchorElement>('a.lang');
  if (!link) return;
  const other = SUPPORTED.find((code) => code !== here);
  if (!other) return;
  const refresh = (): void => {
    link.href = target(other);
  };
  refresh();
  window.addEventListener('hashchange', refresh);
  link.addEventListener('click', () => {
    refresh();
    writeChoice(other);
  });
}

function showBanner(here: string, offered: string): void {
  const copy = BANNER[offered];
  const stay = copy?.stay[here];
  if (!copy || !stay) return;
  const bar = document.createElement('div');
  bar.className = 'langbar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', copy.text);
  bar.setAttribute('data-nosnippet', '');
  bar.lang = offered;
  const text = document.createElement('p');
  text.textContent = copy.text;
  const go = document.createElement('a');
  go.className = 'btn btn-accent';
  go.href = target(offered);
  go.textContent = copy.go;
  go.addEventListener('click', () => writeChoice(offered));
  const keep = document.createElement('button');
  keep.type = 'button';
  keep.className = 'btn btn-ghost';
  keep.textContent = stay;
  keep.addEventListener('click', () => {
    writeChoice(here);
    bar.remove();
    document.documentElement.classList.remove('has-langbar');
  });
  bar.append(text, go, keep);
  document.body.append(bar);
  document.documentElement.classList.add('has-langbar');
}

function main(): void {
  const here = pageLang(location.pathname);
  if (!here) return;
  const stored = readChoice();
  if (stored && stored !== here) {
    location.replace(`${swapLang(location.pathname, stored)}${location.search}${location.hash}`);
    return;
  }
  whenReady(() => {
    wireSwitch(here);
    if (stored) return;
    const wanted = chooseLang({ languages: browserLanguages() });
    if (wanted !== here) showBanner(here, wanted);
  });
}

main();
