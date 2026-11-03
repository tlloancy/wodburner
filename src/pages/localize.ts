import { browserLanguages, chooseLang, pageLang, swapLang } from '../lang';

// Sends a person to the same page in the phone language. A crawler stays on the address it asked for,
// so both /fr/ and /en/ remain readable.

function isCrawler(): boolean {
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram/i.test(navigator.userAgent || '');
}

function main(): void {
  if (isCrawler()) return;
  const here = pageLang(location.pathname);
  if (!here) return;
  const wanted = chooseLang({ languages: browserLanguages() });
  if (wanted === here) return;
  location.replace(`${swapLang(location.pathname, wanted)}${location.search}${location.hash}`);
}

main();
