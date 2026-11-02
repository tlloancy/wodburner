import { gzipSync } from 'node:zlib';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const rows = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else {
      const bytes = await readFile(full);
      const gzip = gzipSync(bytes).length;
      rows.push({ file: path.relative(dist, full), raw: bytes.length, gzip });
    }
  }
}

await walk(dist);
rows.sort((a, b) => a.file.localeCompare(b.file));
let total = 0;
let totalGzip = 0;
for (const row of rows) {
  total += row.raw;
  totalGzip += row.gzip;
  console.log(`${row.gzip.toString().padStart(8)} gzip  ${row.raw.toString().padStart(8)} raw  ${row.file}`);
}
console.log(`${totalGzip.toString().padStart(8)} gzip  ${total.toString().padStart(8)} raw  TOTAL ${rows.length} files`);

function budgetFor(file) {
  if (file.includes('/scan/')) return 30 * 1024;
  if (/\/timers\/(for-time|amrap|emom|tabata)\//.test(file) || file.includes('/wod/')) return 25 * 1024;
  return 10 * 1024;
}

const failures = [];
let cssGzip = 0;
for (const row of rows) {
  if (row.file.endsWith('.css')) cssGzip += row.gzip;
}
if (cssGzip > 8 * 1024) failures.push(`CSS ${cssGzip} bytes gzip > 8192`);

for (const row of rows.filter((item) => item.file.endsWith('.html'))) {
  const html = await readFile(path.join(dist, row.file), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  const styles = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((match) => match[1]);
  const js = scripts.reduce((sum, src) => sum + (rows.find((item) => item.file === src.slice(1))?.gzip || 0), 0);
  const css = styles.reduce((sum, src) => sum + (rows.find((item) => item.file === src.slice(1))?.gzip || 0), 0);
  const transfer = row.gzip + js + css;
  const jsBudget = budgetFor(row.file);
  console.log(`page ${row.file}: js ${js} gzip, css ${css} gzip, html+css+js ${transfer} gzip`);
  if (js > jsBudget) failures.push(`${row.file} JS ${js} > ${jsBudget}`);
  if (transfer > 100 * 1024) failures.push(`${row.file} transfer ${transfer} > 102400`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('budgets ok');
