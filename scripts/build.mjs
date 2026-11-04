import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { paintAssets } from './paint.mjs';
import { contentSecurityPolicy, permissionsPolicy, redirectLines } from './security.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const config = JSON.parse(await readFile(path.join(root, 'site.config.json'), 'utf8'));
const site = (process.env.SITE_ORIGIN || config.siteOrigin).replace(/\/$/, '');
const worker = (process.env.WORKER_ORIGIN || config.workerOrigin).replace(/\/$/, '');
const turnstile = process.env.TURNSTILE_SITE_KEY || config.turnstileSiteKey || '';
const target = process.env.BUILD_TARGET || 'cloudflare';
const packs = {
  fr: JSON.parse(await readFile(path.join(root, 'src/i18n/fr.json'), 'utf8')),
  en: JSON.parse(await readFile(path.join(root, 'src/i18n/en.json'), 'utf8')),
};
const heroes = JSON.parse(await readFile(path.join(root, 'data/hero-wods.json'), 'utf8'));

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const fill = (template, vars) => template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => (key in vars ? String(vars[key]) : `{{${key}}}`));
const read = (name) => readFile(path.join(root, 'templates', name), 'utf8');

function timerHref(lang, format, timer, name) {
  const q = new URLSearchParams();
  if (name) q.set('name', name);
  if (timer.prepSec != null) q.set('prep', String(timer.prepSec));
  if (format === 'amrap' || (format === 'other' && timer.durationSec != null)) {
    q.set('min', String(Math.max(1, Math.round((timer.durationSec ?? 60) / 60))));
    return `/${lang}/timers/amrap/?${q}`;
  }
  if (format === 'emom') {
    q.set('min', String(timer.rounds ?? 1));
    q.set('int', String(timer.intervalSec ?? 60));
    return `/${lang}/timers/emom/?${q}`;
  }
  if (format === 'tabata') {
    q.set('work', String(timer.workSec ?? 20));
    q.set('rest', String(timer.restSec ?? 10));
    q.set('rounds', String(timer.rounds ?? 8));
    if (timer.sets != null) q.set('sets', String(timer.sets));
    if (timer.setRestSec != null) q.set('setrest', String(timer.setRestSec));
    return `/${lang}/timers/tabata/?${q}`;
  }
  if (timer.capSec != null && timer.capSec > 0) q.set('cap', String(timer.capSec));
  else q.set('open', '1');
  return `/${lang}/timers/for-time/?${q}`;
}

function field(label, inner) {
  return `<label>${esc(label)} ${inner}</label>`;
}
function num(name, attrs) {
  return `<input name="${name}" type="number" inputmode="numeric" ${attrs}>`;
}
function formatOptions(ui) {
  return ['fortime', 'amrap', 'emom', 'tabata', 'other'].map((format) => `<option value="${format}">${esc(ui.formats[format])}</option>`).join('');
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await paintAssets(path.join(root, 'public'));
await cp(path.join(root, 'public'), dist, { recursive: true });

const cssResult = await esbuild.transform(await readFile(path.join(root, 'src/styles.css'), 'utf8'), { loader: 'css', minify: true });
const cssName = `styles.${createHash('sha256').update(cssResult.code).digest('hex').slice(0, 10)}.css`;
await mkdir(path.join(dist, 'assets'), { recursive: true });
await writeFile(path.join(dist, 'assets', cssName), cssResult.code);

const entries = {
  boot: 'src/pages/boot.ts',
  home: 'src/pages/home.ts',
  dashboard: 'src/pages/dashboard.ts',
  scan: 'src/pages/scan.ts',
  timer: 'src/pages/timer.ts',
  wod: 'src/pages/wod.ts',
  hero: 'src/pages/hero.ts',
};
async function classicScript(entry, name) {
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    minify: true,
    write: false,
    target: 'es2022',
    legalComments: 'none',
  });
  const code = result.outputFiles[0].text;
  const file = `${name}.${createHash('sha256').update(code).digest('hex').slice(0, 10)}.js`;
  await writeFile(path.join(dist, 'assets', file), code);
  return file;
}
const localizeFile = await classicScript('src/pages/localize.ts', 'localize');
const rootLangFile = await classicScript('src/pages/root-lang.ts', 'root-lang');
const bundles = {};
for (const lang of ['fr', 'en']) {
  bundles[lang] = {};
  for (const [name, entry] of Object.entries(entries)) {
    const result = await esbuild.build({
      absWorkingDir: root,
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      minify: true,
      write: false,
      target: 'es2022',
      legalComments: 'none',
      plugins: [{
        name: 'i18n',
        setup(build) {
          build.onResolve({ filter: /^@i18n$/ }, () => ({ path: lang, namespace: 'i18n' }));
          build.onLoad({ filter: /.*/, namespace: 'i18n' }, () => ({
            contents: `export default ${JSON.stringify(packs[lang].ui)}`,
            loader: 'js',
          }));
        },
      }],
    });
    const code = result.outputFiles[0].text;
    const file = `${name}.${lang}.${createHash('sha256').update(code).digest('hex').slice(0, 10)}.js`;
    await writeFile(path.join(dist, 'assets', file), code);
    bundles[lang][name] = file;
  }
}

const base = await read('base.html');
const headerTpl = await read('header.html');
const footerTpl = await read('footer.html');
const cspMeta = contentSecurityPolicy(worker, true);
const pages = [];

function chrome(lang, currentPath, section = '') {
  const pack = packs[lang].pages;
  const here = (name) => (section === name ? ' aria-current="page"' : '');
  const vars = {
    lang,
    navTimers: esc(pack.nav.timers),
    navHeroes: esc(pack.nav.heroes),
    navHistory: esc(pack.nav.history),
    privacy: esc(pack.nav.privacy),
    contact: esc(pack.nav.contact),
    email: esc(pack.nav.email),
    curTimers: here('timers'),
    curHeroes: here('heroes'),
    curHistory: here('history'),
  };
  return { header: fill(headerTpl, vars), footer: fill(footerTpl, vars) };
}

function jsonScript(value) {
  return `<script type="application/ld+json">${JSON.stringify(value).replace(/</g, '\\u003c')}</script>`;
}

function addPage(page) {
  const lang = page.lang;
  const pack = packs[lang].pages;
  const canonical = `${site}${page.path}`;
  const indexable = page.index;
  const hreflang = indexable ? ['fr', 'en'].map((code) => {
    const href = page.path === '/' ? `${site}/${code}/` : `${site}${page.path.replace(`/${lang}/`, `/${code}/`)}`;
    return `<link rel="alternate" hreflang="${code}" href="${href}">`;
  }).join('\n') + `\n<link rel="alternate" hreflang="x-default" href="${page.path === '/' ? `${site}/en/` : `${site}${page.path.replace(`/${lang}/`, '/en/')}`}">` : '';
  const script = page.script ? `<script type="module" src="/assets/${bundles[lang][page.script]}"></script>` : '';
  const headFile = page.id === 'root' ? rootLangFile : page.id === 'missing' ? '' : localizeFile;
  const headscript = headFile ? `<script src="/assets/${headFile}"></script>` : '';
  const html = fill(base, {
    lang: page.htmlLang || lang,
    title: esc(page.title),
    description: esc(page.description),
    canonical,
    robots: indexable ? '' : '<meta name="robots" content="noindex">',
    hreflang,
    ogimage: `${site}/og.png`,
    ogtype: page.ogType || 'website',
    locale: lang === 'fr' ? 'fr_FR' : 'en_US',
    css: cssName,
    csp: esc(cspMeta),
    jsonld: page.jsonld || '',
    headscript,
    id: page.id,
    format: page.format || '',
    worker,
    turnstile: esc(turnstile),
    skip: esc(pack.skip),
    body: page.body,
    script,
  });
  pages.push({ ...page, html, canonical, indexable });
}

function software(lang, path, description) {
  return jsonScript({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'WODBurner',
    applicationCategory: 'HealthApplication',
    operatingSystem: 'Web',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    description,
    url: `${site}${path}`,
    inLanguage: lang,
  });
}

for (const lang of ['fr', 'en']) {
  const p = packs[lang].pages;
  const ui = packs[lang].ui;
  const home = chrome(lang, `/${lang}/`, '');
  const homeBody = fill(await read('home.html'), { ...home, lang, h1: esc(p.home.h1), lead: esc(p.home.lead), scan: esc(p.home.scan), timersTitle: esc(p.home.timersTitle), fortime: esc(p.home.fortime), amrap: esc(p.home.amrap), emom: esc(p.home.emom), tabata: esc(p.home.tabata), recent: esc(p.home.recent), empty: esc(p.home.empty), heroesLink: esc(p.home.heroesLink), searchLabel: esc(p.dashboard.searchLabel), searchPlaceholder: esc(p.dashboard.searchPlaceholder), searchGo: esc(p.home.searchGo) });
  addPage({ lang, id: 'home', path: `/${lang}/`, out: `${lang}/index.html`, index: true, title: p.home.title, description: p.home.description, script: 'home', body: homeBody, jsonld: software(lang, `/${lang}/`, p.home.description) });

  const timers = chrome(lang, `/${lang}/timers/`, 'timers');
  addPage({ lang, id: 'timers', path: `/${lang}/timers/`, out: `${lang}/timers/index.html`, index: true, title: p.timers.title, description: p.timers.description, script: 'boot', body: fill(await read('timers.html'), { ...timers, lang, h1: esc(p.timers.h1), lead: esc(p.timers.lead), fortime: esc(p.timers.fortime), amrap: esc(p.timers.amrap), emom: esc(p.timers.emom), tabata: esc(p.timers.tabata) }) });

  const timerSpecs = [
    ['for-time', 'fortime', 'forTime', [field(p.forTime.capLabel, num('capMin', 'min="1" max="1440"')), field(p.forTime.prepLabel, num('prep', 'min="0" max="120" value="10"'))]],
    ['amrap', 'amrap', 'amrap', [field(p.amrap.minutesLabel, num('minutes', 'min="1" max="1440" value="20" required')), field(p.amrap.prepLabel, num('prep', 'min="0" max="120" value="10"'))]],
    ['emom', 'emom', 'emom', [field(p.emom.intervalsLabel, num('rounds', 'min="1" max="500" value="10" required')), field(p.emom.intervalLabel, num('interval', 'min="1" max="3600" value="60" required')), field(p.emom.prepLabel, num('prep', 'min="0" max="120" value="10"'))]],
    ['tabata', 'tabata', 'tabata', [field(p.tabata.workLabel, num('work', 'min="1" max="3600" value="20" required')), field(p.tabata.restLabel, num('rest', 'min="0" max="3600" value="10" required')), field(p.tabata.roundsLabel, num('rounds', 'min="1" max="500" value="8" required')), field(p.tabata.setsLabel, num('sets', 'min="1" max="40"')), field(p.tabata.setRestLabel, num('setRest', 'min="0" max="3600"')), field(p.tabata.prepLabel, num('prep', 'min="0" max="120" value="10"'))]],
  ];
  const timerTpl = await read('timer.html');
  for (const [slug, format, key, fields] of timerSpecs) {
    const route = `/${lang}/timers/${slug}/`;
    const bar = chrome(lang, route, 'timers');
    const copy = p[key];
    const body = fill(timerTpl, {
      ...bar,
      h1: esc(copy.h1),
      lead: esc(copy.lead),
      noscript: esc(copy.noscript),
      fields: fields.join('\n'),
      start: esc(p.timerChrome.start),
      pause: esc(p.timerChrome.pause),
      done: esc(p.timerChrome.done),
      plus: esc(p.timerChrome.plus),
      sound: esc(p.timerChrome.sound),
      volume: esc(p.timerChrome.volume),
      full: esc(p.timerChrome.full),
      modify: esc(p.timerChrome.modify),
      wake: esc(p.timerChrome.wake),
      resultTitle: esc(p.timerChrome.resultTitle),
      roundsLabel: esc(p.timerChrome.roundsLabel),
      repsLabel: esc(p.timerChrome.repsLabel),
      noteLabel: esc(p.timerChrome.noteLabel),
      save: esc(p.timerChrome.save),
    });
    addPage({ lang, id: 'timer', format, path: route, out: `${lang}/timers/${slug}/index.html`, index: true, title: copy.title, description: copy.description, script: 'timer', body });
  }

  const dash = chrome(lang, `/${lang}/dashboard/`, 'history');
  addPage({ lang, id: 'dashboard', path: `/${lang}/dashboard/`, out: `${lang}/dashboard/index.html`, index: false, title: p.dashboard.title, description: p.dashboard.description, script: 'dashboard', body: fill(await read('dashboard.html'), { ...dash, ...Object.fromEntries(Object.entries(p.dashboard).map(([k, v]) => [k, esc(v)])), options: formatOptions(ui) }) });

  const scan = chrome(lang, `/${lang}/scan/`, 'scan');
  addPage({ lang, id: 'scan', path: `/${lang}/scan/`, out: `${lang}/scan/index.html`, index: false, title: p.scan.title, description: p.scan.description, script: 'scan', body: fill(await read('scan.html'), {
    ...scan,
    lang,
    ...Object.fromEntries(Object.entries(p.scan).map(([k, v]) => [k, esc(v)])),
    capMin: esc(p.dashboard.capMin),
    minutes: esc(p.dashboard.minutes),
    rounds: esc(p.dashboard.rounds),
    interval: esc(p.dashboard.interval),
    work: esc(p.dashboard.work),
    rest: esc(p.dashboard.rest),
    options: formatOptions(ui),
  }) });

  const wod = chrome(lang, `/${lang}/wod/`, 'history');
  addPage({ lang, id: 'wod', path: `/${lang}/wod/`, out: `${lang}/wod/index.html`, index: false, title: p.wod.title, description: p.wod.description, script: 'wod', body: fill(await read('wod.html'), { ...wod, lang, h1: esc(p.wod.h1), lead: esc(p.wod.lead), missing: esc(p.wod.missing), launch: esc(p.wod.launch), results: esc(p.wod.results) }) });

  const heroBar = chrome(lang, `/${lang}/hero-wods/`, 'heroes');
  const categoryLabel = { girl: 'Girl', hero: 'Hero', notable: lang === 'fr' ? 'Autre' : 'Other', funny: 'Funny' };
  const groups = ['girl', 'notable', 'funny', 'hero'].map((category) => {
    const items = heroes.filter((wod) => wod.category === category).map((wod) => `<li><a href="/${lang}/hero-wods/${esc(wod.slug)}/">${esc(wod.name)}</a> <span class="meta">${esc(ui.formats[wod.format])}</span></li>`).join('');
    if (!items) return '';
    return `<section><h2>${categoryLabel[category]}</h2><ul class="cards">${items}</ul></section>`;
  }).join('');
  addPage({ lang, id: 'heroes', path: `/${lang}/hero-wods/`, out: `${lang}/hero-wods/index.html`, index: true, title: p.heroes.title, description: p.heroes.description, script: 'boot', body: fill(await read('hero-index.html'), { ...heroBar, h1: esc(p.heroes.h1), lead: esc(p.heroes.lead), groups }) });

  for (const wod of heroes) {
    const route = `/${lang}/hero-wods/${wod.slug}/`;
    const bar = chrome(lang, route, 'heroes');
    const text = wod.text[lang];
    const steps = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const jsonld = jsonScript({
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: wod.name,
      description: steps[0] || wod.name,
      inLanguage: lang,
      step: steps.map((line, index) => ({ '@type': 'HowToStep', position: index + 1, text: line })),
    });
    const body = fill(await read('hero.html'), {
      ...bar,
      category: categoryLabel[wod.category] || 'Girl',
      name: esc(wod.name),
      nameAttr: esc(wod.name),
      formatLabel: esc(p.hero.format),
      format: esc(ui.formats[wod.format]),
      formatValue: esc(wod.format),
      text: esc(text),
      note: wod.note ? `<p class="banner">${esc(wod.note[lang])}</p>` : '',
      scalingLabel: esc(p.hero.scaling),
      scaling: esc(wod.scaling[lang]),
      launchHref: esc(timerHref(lang, wod.format, wod.timer, wod.name)),
      launch: esc(p.hero.launch),
      add: esc(p.hero.add),
      timerAttr: esc(JSON.stringify(wod.timer)),
    });
    addPage({ lang, id: 'hero', path: route, out: `${lang}/hero-wods/${wod.slug}/index.html`, index: true, title: `${wod.name} — WODBurner`, description: `${steps[0] || wod.name}. ${p.hero.descriptionSuffix}`, script: 'hero', ogType: 'article', body, jsonld });
  }

  const privacy = chrome(lang, `/${lang}/privacy/`);
  const blocks = p.privacy.blocks.map((block) => `<section><h2>${esc(block.h)}</h2>${block.p.map((para) => `<p>${esc(para)}</p>`).join('')}</section>`).join('');
  addPage({ lang, id: 'privacy', path: `/${lang}/privacy/`, out: `${lang}/privacy/index.html`, index: true, title: p.privacy.title, description: p.privacy.description, script: 'boot', body: fill(await read('privacy.html'), { ...privacy, h1: esc(p.privacy.h1), blocks }) });
}

const rootPack = packs.en.pages;
addPage({
  lang: 'en',
  htmlLang: 'en',
  id: 'root',
  path: '/',
  out: 'index.html',
  index: true,
  title: rootPack.root.title,
  description: rootPack.root.description,
  body: fill(await read('root.html'), { h1: esc(rootPack.root.h1), lead: esc(rootPack.root.lead) }),
  jsonld: software('en', '/', rootPack.root.description),
});
addPage({
  lang: 'en',
  id: 'missing',
  path: '/404.html',
  out: '404.html',
  index: false,
  title: rootPack.notFound.title,
  description: rootPack.notFound.description,
  script: 'boot',
  body: fill(await read('404.html'), { h1: esc(rootPack.notFound.h1), lead: esc(rootPack.notFound.lead) }),
});

for (const page of pages) {
  const file = path.join(dist, page.out);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, page.html);
}

const urls = new Set(['/', '/index.html', '/404.html', '/favicon.svg', '/mark.png', '/manifest.webmanifest', '/og.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png', `/assets/${cssName}`, `/assets/${localizeFile}`, `/assets/${rootLangFile}`]);
for (const lang of ['fr', 'en']) for (const file of Object.values(bundles[lang])) urls.add(`/assets/${file}`);
for (const page of pages) {
  if (page.path.endsWith('.html')) urls.add(page.path);
  else {
    urls.add(page.path);
    urls.add(`${page.path}index.html`);
  }
}
const version = `wodburner-${createHash('sha256').update([...urls].sort().join('\n')).digest('hex').slice(0, 12)}`;
const sw = `const VERSION=${JSON.stringify(version)};
const PRECACHE=${JSON.stringify([...urls])};
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const html = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  event.respondWith(html ? networkFirst(req) : cacheFirst(req));
});
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) await cache.put(req, fresh.clone());
    return fresh;
  } catch (error) {
    return (await caches.match(req)) || (await caches.match('/404.html')) || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
}
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh.ok) {
    const cache = await caches.open(VERSION);
    await cache.put(req, fresh.clone());
  }
  return fresh;
}
`;
await writeFile(path.join(dist, 'sw.js'), sw);

const headerCsp = contentSecurityPolicy(worker, false);
await writeFile(path.join(dist, '_headers'), `/*
  Content-Security-Policy: ${headerCsp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: ${permissionsPolicy()}
  X-Frame-Options: DENY

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/sw.js
  Cache-Control: no-cache
`);
await writeFile(path.join(dist, '_redirects'), `${redirectLines(heroes.map((wod) => wod.slug)).join('\n')}\n`);
await writeFile(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`);

const sitemap = [`<?xml version="1.0" encoding="UTF-8"?>`, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`];
for (const page of pages) if (page.indexable) sitemap.push(`  <url><loc>${page.canonical}</loc></url>`);
sitemap.push('</urlset>');
await writeFile(path.join(dist, 'sitemap.xml'), `${sitemap.join('\n')}\n`);

if (target === 'github') {
  await writeFile(path.join(dist, 'CNAME'), 'wodburner.app\n');
  for (const slug of ['generate', 'premium', 'hall-of-fame', 'open-stats']) {
    for (const prefix of ['', 'fr/', 'en/']) {
      const lang = prefix.startsWith('fr') ? 'fr' : 'en';
      const file = path.join(dist, prefix, slug, 'index.html');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>WODBurner</title><link rel="canonical" href="${site}/${lang}/"><meta http-equiv="refresh" content="0; url=/${lang}/"><meta name="robots" content="noindex"></head><body><p><a href="/${lang}/">WODBurner</a></p></body></html>\n`);
    }
  }
}

console.log(`built ${pages.length} pages → ${path.relative(root, dist)} (${target})`);
