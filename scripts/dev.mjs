import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { contentSecurityPolicy, permissionsPolicy, redirectTarget } from './security.mjs';
import { readFileSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const config = JSON.parse(readFileSync(path.join(root, 'site.config.json'), 'utf8'));
const heroSlugs = JSON.parse(readFileSync(path.join(root, 'data/hero-wods.json'), 'utf8')).map((wod) => wod.slug);
const worker = process.env.WORKER_ORIGIN || config.workerOrigin;

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { stdio: 'inherit', cwd: root });
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build ${code}`))));
});

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

const security = {
  'content-security-policy': contentSecurityPolicy(worker, false),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': permissionsPolicy(),
  'x-frame-options': 'DENY',
};

const port = Number(process.env.PORT || 4173);
createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const dest = redirectTarget(url.pathname, heroSlugs);
    if (dest) {
      res.writeHead(301, { location: dest, ...security });
      res.end();
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.normalize(path.join(dist, pathname.replace(/^\/+/, '')));
    if (!file.startsWith(dist)) {
      res.writeHead(403);
      res.end('no');
      return;
    }
    let target = file;
    try {
      const info = await stat(target);
      if (info.isDirectory()) target = path.join(target, 'index.html');
    } catch {
      target = path.join(dist, '404.html');
      res.statusCode = 404;
    }
    const body = await readFile(target);
    const ext = path.extname(target);
    res.writeHead(res.statusCode || 200, { 'content-type': types[ext] || 'application/octet-stream', ...security });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end('error');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${port}`);
});
