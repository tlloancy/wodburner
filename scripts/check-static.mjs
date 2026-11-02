import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const heroes = JSON.parse(await readFile(path.join(root, 'data/hero-wods.json'), 'utf8'));
const todo = await readFile(path.join(root, 'TODO-VERIFY.md'), 'utf8');
const failures = [];
const fail = (message) => failures.push(message);

function walk(dir, acc = []) {
  return readdir(dir, { withFileTypes: true }).then(async (entries) => {
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, acc);
      else if (entry.name.endsWith('.html')) acc.push(full);
    }
    return acc;
  });
}

const htmlFiles = await walk(dist);
if (htmlFiles.length < 10) fail('too few html files');

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const rel = path.relative(dist, file);
  if (/Loading\.\.\./i.test(html)) fail(`${rel} contains Loading`);
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
  for (const match of scripts) {
    const tag = match[1];
    const type = /type="([^"]*)"/.exec(tag)?.[1] || '';
    if (type === 'application/ld+json') continue;
    if (!/\ssrc=/.test(tag)) fail(`${rel} has an inline script`);
  }
  const indexable = !html.includes('name="robots" content="noindex"');
  if (!indexable) continue;
  for (const needle of ['rel="canonical"', 'hreflang="fr"', 'hreflang="en"', 'hreflang="x-default"', 'og:image', '<h1']) {
    if (!html.includes(needle)) fail(`${rel} missing ${needle}`);
  }
}

const fran = await readFile(path.join(dist, 'fr/hero-wods/fran/index.html'), 'utf8');
if (!fran.includes('Thrusters')) fail('Fran page missing Thrusters');
if (!fran.includes('name=Fran') || !fran.includes('open=1')) fail('Fran launch link');
const home = await readFile(path.join(dist, 'fr/index.html'), 'utf8');
if (!home.includes('Scanner un tableau')) fail('French home missing the scan link');
const dash = await readFile(path.join(dist, 'fr/dashboard/index.html'), 'utf8');
if (!dash.includes('noindex')) fail('dashboard should be noindex');
const headers = await readFile(path.join(dist, '_headers'), 'utf8');
if (!headers.includes('Content-Security-Policy') || headers.includes('unsafe-inline')) fail('CSP header');
const redirects = await readFile(path.join(dist, '_redirects'), 'utf8');
for (const line of ['/generate    /en/    301', '/timers/emom    /en/timers/emom/    301', '/dashboard    /en/dashboard/    301', '/scan    /en/scan/    301', '/hero-wods/fran    /en/hero-wods/fran/    301']) {
  if (!redirects.includes(line)) fail(`redirects missing ${line}`);
}
const sitemap = await readFile(path.join(dist, 'sitemap.xml'), 'utf8');
if (!sitemap.includes('/fr/hero-wods/fran/') || sitemap.includes('/dashboard/')) fail('sitemap');
const sw = await readFile(path.join(dist, 'sw.js'), 'utf8');
if (!sw.includes('/fr/') || sw.includes('scan.wodburner.app')) fail('service worker precache');

for (const wod of heroes) {
  if (!wod.text?.fr || !wod.text?.en || !wod.scaling?.fr || !wod.scaling?.en) fail(`${wod.slug} missing text`);
  if (wod.verified === false && !todo.includes(wod.slug)) fail(`${wod.slug} missing from TODO-VERIFY.md`);
  if (wod.verified === true && todo.includes(`\`${wod.slug}\``)) fail(`${wod.slug} is verified and still listed`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`static check ok (${htmlFiles.length} html files)`);
