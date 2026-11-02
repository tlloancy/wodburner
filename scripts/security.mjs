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

export function redirectLines() {
  const lines = [];
  for (const slug of LEGACY) {
    lines.push(`/${slug}    /en/    301`);
    lines.push(`/${slug}/    /en/    301`);
    for (const lang of ['fr', 'en']) {
      lines.push(`/${lang}/${slug}    /${lang}/    301`);
      lines.push(`/${lang}/${slug}/    /${lang}/    301`);
    }
  }
  return lines;
}
