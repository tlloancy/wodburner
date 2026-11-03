import { browserLanguages, chooseLang, readChoice } from '../lang';

// Runs in <head> as a classic script, so the language picker never shows before the redirect.
function main(): void {
  const path = location.pathname;
  if (path !== '/' && path !== '/index.html') return;
  const lang = chooseLang({ stored: readChoice(), languages: browserLanguages() });
  location.replace(`/${lang}/${location.search}${location.hash}`);
}

main();
