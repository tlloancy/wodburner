import { getMeta } from '../db';
import { registerSW } from '../pwa';

registerSW();

async function pick(): Promise<void> {
  const path = location.pathname;
  if (path !== '/' && path !== '/index.html') return;
  let lang = 'en';
  try {
    const saved = await getMeta('lang');
    if (saved === 'fr' || saved === 'en') lang = saved;
    else if (navigator.language.toLowerCase().startsWith('fr')) lang = 'fr';
  } catch {
    if (navigator.language.toLowerCase().startsWith('fr')) lang = 'fr';
  }
  location.replace(`/${lang}/${location.search}${location.hash}`);
}

void pick();
