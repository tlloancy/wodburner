import { browserLanguages, chooseLang } from '../lang';

// Runs in <head> as a classic script, so the language links on / never show before the redirect.
function main(): void {
  const path = location.pathname;
  if (path !== '/' && path !== '/index.html') return;
  const lang = chooseLang({ languages: browserLanguages() });
  location.replace(`/${lang}/${location.search}${location.hash}`);
}

main();
