// QR Code, byte mode, error correction L, versions 1 to 5. One block, mask 0.
// The sync link fits in version 4. Scanners accept any valid mask.

const DATA = [0, 19, 34, 55, 80, 108];
const ECC = [0, 7, 10, 15, 20, 26];
const ALIGN: number[][] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30]];

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function mul(a: number, b: number): number {
  return a && b ? EXP[(LOG[a] as number) + (LOG[b] as number)] : 0;
}

function reedSolomon(data: Uint8Array, ecLen: number): Uint8Array {
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array<number>(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j] as number;
      next[j + 1] ^= mul(gen[j] as number, EXP[i] as number);
    }
    gen = next;
  }
  const res = new Uint8Array(data.length + ecLen);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = res[i] as number;
    if (!factor) continue;
    for (let j = 0; j < gen.length; j++) res[i + j] ^= mul(gen[j] as number, factor);
  }
  return res.slice(data.length);
}

function versionFor(length: number): number {
  const used = 4 + 8 + length * 8;
  for (let version = 1; version <= 5; version++) if (used <= (DATA[version] as number) * 8) return version;
  throw new Error('qr');
}

function dataBytes(payload: Uint8Array, version: number): Uint8Array {
  const capacity = DATA[version] as number;
  const bits: number[] = [];
  const push = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(payload.length, 8);
  for (const byte of payload) push(byte, 8);
  const room = capacity * 8 - bits.length;
  push(0, Math.min(4, Math.max(0, room)));
  while (bits.length % 8) bits.push(0);
  const out = new Uint8Array(capacity);
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | (bits[i + j] as number);
    out[i / 8] = value;
  }
  const pads = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < capacity; i++, p++) out[i] = pads[p % 2] as number;
  return out;
}

function formatBits(mask: number): number {
  const data = (1 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function markFinder(mod: Uint8Array, func: Uint8Array, n: number, col: number, row: number): void {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const x = col + dx;
      const y = row + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      func[y * n + x] = 1;
      const on = dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
      mod[y * n + x] = on ? 1 : 0;
    }
  }
}

function markAlign(mod: Uint8Array, func: Uint8Array, n: number, col: number, row: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = col + dx;
      const y = row + dy;
      func[y * n + x] = 1;
      mod[y * n + x] = Math.max(Math.abs(dx), Math.abs(dy)) === 1 ? 0 : 1;
    }
  }
}

export function qrModules(text: string): { n: number; dark: Uint8Array } {
  const payload = new TextEncoder().encode(text);
  const version = versionFor(payload.length);
  const n = 17 + 4 * version;
  const mod = new Uint8Array(n * n);
  const func = new Uint8Array(n * n);
  markFinder(mod, func, n, 0, 0);
  markFinder(mod, func, n, n - 7, 0);
  markFinder(mod, func, n, 0, n - 7);
  for (let i = 0; i < n; i++) {
    if (!func[6 * n + i]) {
      func[6 * n + i] = 1;
      mod[6 * n + i] = i % 2 === 0 ? 1 : 0;
    }
    if (!func[i * n + 6]) {
      func[i * n + 6] = 1;
      mod[i * n + 6] = i % 2 === 0 ? 1 : 0;
    }
  }
  for (const row of ALIGN[version] as number[]) {
    for (const col of ALIGN[version] as number[]) {
      if (!func[row * n + col]) markAlign(mod, func, n, col, row);
    }
  }
  const darkRow = 4 * version + 9;
  func[darkRow * n + 8] = 1;
  mod[darkRow * n + 8] = 1;
  for (let i = 0; i < 9; i++) {
    func[8 * n + i] = 1;
    func[i * n + 8] = 1;
  }
  for (let i = 0; i < 8; i++) {
    func[8 * n + (n - 1 - i)] = 1;
    func[(n - 1 - i) * n + 8] = 1;
  }
  const body = dataBytes(payload, version);
  const codewords = new Uint8Array(body.length + (ECC[version] as number));
  codewords.set(body);
  codewords.set(reedSolomon(body, ECC[version] as number), body.length);
  const bits: number[] = [];
  for (const byte of codewords) for (let i = 7; i >= 0; i--) bits.push((byte >>> i) & 1);
  let bit = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? n - 1 - vert : vert;
        const at = row * n + col;
        if (func[at]) continue;
        let on = bit < bits.length ? (bits[bit] as number) : 0;
        bit++;
        if (((row + col) & 1) === 0) on ^= 1;
        mod[at] = on;
      }
    }
  }
  const bits15 = formatBits(0);
  const put = (col: number, row: number, index: number): void => {
    mod[row * n + col] = (bits15 >>> index) & 1;
  };
  for (let i = 0; i <= 5; i++) put(8, i, i);
  put(8, 7, 6);
  put(8, 8, 7);
  put(7, 8, 8);
  for (let i = 9; i < 15; i++) put(14 - i, 8, i);
  for (let i = 0; i < 8; i++) put(n - 1 - i, 8, i);
  for (let i = 8; i < 15; i++) put(8, n - 15 + i, i);
  return { n, dark: mod };
}
