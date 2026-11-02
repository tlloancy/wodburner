import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
};

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function png(width, height, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const o = row + 1 + x * 3;
      raw[o] = pixels[i];
      raw[o + 1] = pixels[i + 1];
      raw[o + 2] = pixels[i + 2];
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function create(width, height, color) {
  const px = new Uint8Array(width * height * 3);
  const [r, g, b] = rgb(color);
  for (let i = 0; i < px.length; i += 3) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  }
  return px;
}

function set(px, width, height, x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const i = (y * width + x) * 3;
  px[i] = color[0];
  px[i + 1] = color[1];
  px[i + 2] = color[2];
}

function fillCircle(px, width, height, cx, cy, radius, color) {
  const r2 = radius * radius;
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) set(px, width, height, x, y, color);
    }
  }
}

function text(px, width, height, message, x, y, scale, color) {
  let cursor = x;
  for (const ch of message) {
    const glyph = FONT[ch] || FONT[' '];
    const cols = glyph[0].length;
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < cols; col++) {
        if (glyph[row][col] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) set(px, width, height, cursor + col * scale + sx, y + row * scale + sy, color);
        }
      }
    }
    cursor += (cols + 1) * scale;
  }
}

function textWidth(message, scale) {
  let width = 0;
  for (const ch of message) width += ((FONT[ch] || FONT[' '])[0].length + 1) * scale;
  return width;
}

function clock(size, background, ring, hand) {
  const px = create(size, size, background);
  const c = size / 2;
  fillCircle(px, size, size, c, c, size * 0.34, rgb(ring));
  fillCircle(px, size, size, c, c, size * 0.27, rgb(background));
  const ink = rgb(hand);
  for (let t = 0; t < size * 0.16; t++) set(px, size, size, Math.round(c), Math.round(c - t), ink);
  for (let t = 0; t < size * 0.1; t++) set(px, size, size, Math.round(c + t * 0.6), Math.round(c + t * 0.45), ink);
  return png(size, size, px);
}

export async function paintAssets(dir) {
  await mkdir(path.join(dir, 'icons'), { recursive: true });
  await writeFile(path.join(dir, 'icons', 'icon-192.png'), clock(192, '#10120f', '#ff7a2f', '#f3f0e6'));
  await writeFile(path.join(dir, 'icons', 'icon-512.png'), clock(512, '#10120f', '#ff7a2f', '#f3f0e6'));
  await writeFile(path.join(dir, 'icons', 'icon-maskable-512.png'), clock(512, '#ff7a2f', '#10120f', '#f3f0e6'));
  const width = 1200;
  const height = 630;
  const px = create(width, height, '#10120f');
  const accent = rgb('#ff7a2f');
  for (let y = 0; y < height; y++) for (let x = 0; x < 28; x++) set(px, width, height, x, y, accent);
  const title = 'WODBURNER';
  const scale = 11;
  text(px, width, height, title, Math.round((width - textWidth(title, scale)) / 2), 210, scale, rgb('#f3f0e6'));
  const sub = 'FOR TIME  AMRAP  EMOM  TABATA';
  text(px, width, height, sub, Math.round((width - textWidth(sub, 4)) / 2), 380, 4, accent);
  await writeFile(path.join(dir, 'og.png'), png(width, height, px));
}
