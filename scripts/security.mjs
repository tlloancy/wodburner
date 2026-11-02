export function contentSecurityPolicy(workerOrigin, meta = false) {
  const rules = [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    `connect-src 'self' ${workerOrigin} https://challenges.cloudflare.com`,
    "img-src 'self' data: blob:",
    "style-src 'self'",
    "frame-src https://challenges.cloudflare.com",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ];
  if (!meta) rules.push("frame-ancestors 'none'");
  return rules.join('; ');
}

export function permissionsPolicy() {
  return [
    'accelerometer=()',
    'camera=(self)',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'payment=()',
    'usb=()',
    'interest-cohort=()',
    'browsing-topics=()',
    'screen-wake-lock=(self)',
    'fullscreen=(self)',
  ].join(', ');
}

export const LEGACY = ['generate', 'premium', 'hall-of-fame', 'open-stats'];
const TIMERS = ['for-time', 'amrap', 'emom', 'tabata'];

export function redirectTarget(pathname, heroSlugs = []) {
  const bare = (pathname.startsWith('/') ? pathname : `/${pathname}`).replace(/\/+$/, '') || '/';
  const legacy = bare.match(/^\/(?:(fr|en)\/)?(generate|premium|hall-of-fame|open-stats)$/);
  if (legacy && LEGACY.includes(legacy[2])) return `/${legacy[1] || 'en'}/`;
  if (bare === '/timers') return '/en/timers/';
  if (bare === '/dashboard') return '/en/dashboard/';
  if (bare === '/scan') return '/en/scan/';
  if (bare === '/hero-wods') return '/en/hero-wods/';
  const timer = bare.match(/^\/timers\/(for-time|amrap|emom|tabata)$/);
  if (timer) return `/en/timers/${timer[1]}/`;
  const hero = bare.match(/^\/hero-wods\/([a-z0-9-]+)$/);
  if (hero && heroSlugs.includes(hero[1])) return `/en/hero-wods/${hero[1]}/`;
  return '';
}

export function redirectLines(heroSlugs = []) {
  const pairs = [];
  const add = (from, to) => {
    pairs.push([from, to]);
    pairs.push([`${from}/`, to]);
  };
  for (const slug of LEGACY) {
    add(`/${slug}`, '/en/');
    for (const lang of ['fr', 'en']) add(`/${lang}/${slug}`, `/${lang}/`);
  }
  add('/timers', '/en/timers/');
  for (const slug of TIMERS) add(`/timers/${slug}`, `/en/timers/${slug}/`);
  add('/dashboard', '/en/dashboard/');
  add('/scan', '/en/scan/');
  add('/hero-wods', '/en/hero-wods/');
  for (const slug of heroSlugs) add(`/hero-wods/${slug}`, `/en/hero-wods/${slug}/`);
  return pairs.map(([from, to]) => `${from}    ${to}    301`);
}
