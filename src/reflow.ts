import type { Format, TimerConfig } from './types';

const GLUE: readonly RegExp[] = [
  /(?<=\S)(?=(?:for\s*time|amrap|tabata)\b)/gi,
  /(?<=\S)(?=emom\b)/gi,
  /(?<=\S)(?=e\d{1,2}(?:[.,]\d)?\s*mom\b)/gi,
  /(?<=\S)(?=consignes?\b)/gi,
  /(?<=\S)(?=athlete\s+[a-z]\b)/gi,
  /(?<=\S)(?=(?:rx|inter|scale)\s*:)/gi,
  /(?<=\S)(?=maximum\b)/gi,
  /(?<=\S)(?=->|→)/g,
  /(?<=rounds\s*:)(?=\S)/gi,
  /(?<=['’′])(?=\d)/g,
  /(?<=[A-Za-z])(?=\d+\s*rounds?\s*:)/gi,
  /(?<=[A-Za-z)])(?=\d{1,2}\s*:(?!\d))/g,
  /(?<=[A-Za-z])(?=\d+(?:\/\d+)?\s*(?:cal|kcal)\b)/gi,
  /(?<=[A-Za-z])(?=\d+\s*m\b)/gi,
  /(?<=[A-Za-z])(?=\d+\s*['’′]\s*(?:rest|repos)\b)/gi,
];

export function reflow(text: string): string {
  let lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    const next: string[] = [];
    for (const line of lines) {
      let value = line;
      for (const rule of GLUE) value = value.replace(new RegExp(rule.source, rule.flags.includes('g') ? rule.flags : `${rule.flags}g`), '\n');
      if (value !== line) changed = true;
      next.push(...value.split('\n'));
    }
    lines = next;
    if (!changed) break;
  }
  return lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function minutes(value: string): number | null {
  const min = Number(value);
  if (!Number.isInteger(min) || min < 1 || min > 180) return null;
  return min * 60;
}

function clock(text: string): { format: Format; timer: TimerConfig } | null {
  const lines = text.split('\n');
  let format: Format | null = null;
  let timer: TimerConfig = {};
  for (const line of lines) {
    const t = fold(line).trim();
    if (!format && (/^amrap\b/.test(t) || /^\d{1,3}\s*min(?:ute)?s?\s+amrap\b/.test(t))) {
      const found = /^amrap\b(?:\s+(?:de|of))?\s*(\d{1,3})/.exec(t) || /^(\d{1,3})\s*min(?:ute)?s?\s+amrap\b/.exec(t);
      const duration = found ? minutes(found[1]) : null;
      if (duration) {
        format = 'amrap';
        timer = { durationSec: duration };
      }
    } else if (!format && (/^emom\b/.test(t) || /^e\d{1,2}(?:[.,]\d)?\s*mom\b/.test(t))) {
      const numbered = /^e(\d{1,2})(?:[.,](\d))?\s*mom\b/.exec(t);
      const plain = /^emom\b(?:\s+(\d{1,3}))?/.exec(t);
      if (numbered) {
        const rounds = /(?:x|for|pendant)\s*(\d{1,3})/.exec(t.slice(numbered[0].length));
        timer = { intervalSec: Number(numbered[1]) * 60 + (numbered[2] ? Number(numbered[2]) * 6 : 0) };
        if (rounds) timer.rounds = Number(rounds[1]);
        format = 'emom';
      } else if (plain) {
        timer = { intervalSec: 60 };
        if (plain[1]) timer.rounds = Number(plain[1]);
        format = 'emom';
      }
    } else if (!format && /^tabata\b/.test(t)) {
      format = 'tabata';
      timer = { workSec: 20, restSec: 10, rounds: 8 };
    } else if (!format && (/\bfor\s*time\b/.test(t) || /^rft\b/.test(t) || /^pour le temps\b/.test(t) || /^contre la montre\b/.test(t))) {
      format = 'fortime';
    }
    const tc = /\btc\s*:?\s*(\d{1,3})\s*['’′]?/.exec(t);
    const maximum = /\bmaximum\s+(\d{1,3})\s*['’′]/.exec(t);
    const cap = tc || maximum;
    if (cap) {
      const total = minutes(cap[1]);
      if (total) {
        format = format || 'fortime';
        if (format === 'fortime') timer = { ...timer, capSec: total };
      }
    }
  }
  return format ? { format, timer } : null;
}

function title(name: string, text: string): string {
  const kept = name.trim();
  const flat = (value: string): string => value.replace(/…$/, '').replace(/\s+/g, '');
  const generated = !kept || (flat(kept).length > 40 && flat(text).startsWith(flat(kept).slice(0, Math.min(flat(kept).length, 48))));
  if (!generated) return kept;
  const bits: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || isHeader(line) || isAside(line)) continue;
    const bit = line.replace(/:\s*$/, '').replace(/^\d{1,2}\s*:\s+/, '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    if (!bit) continue;
    const next = bits.length ? `${bits.join(' · ')} · ${bit}` : bit;
    if (bits.length && next.length > 36) break;
    bits.push(bit);
    if (bits.length === 2) break;
  }
  if (bits.length) return bits.join(' · ');
  const first = text.split('\n').map((line) => line.trim()).find(Boolean) || kept;
  return first.length > 36 ? `${first.slice(0, 35)}…` : first;
}

function isHeader(line: string): boolean {
  const t = fold(line).replace(/:\s*$/, '').trim();
  return /^wod\b/.test(t) || /^skill\b/.test(t) || /^(for time|amrap|tabata|rft|pour le temps|contre la montre)$/.test(t);
}

function isAside(line: string): boolean {
  const t = fold(line).trim();
  return /^(?:->|→)/.test(line.trim()) || /^athlete\s+[a-z]\b/.test(t) || /^(consignes?|rx|inter|scale)\b/.test(t) || /^\d+\s*rounds?\s*:?\s*$/.test(t) || /^\d+\s*['’′]\s*(?:rest|repos)\b/.test(t);
}

function withoutTitle(name: string, text: string): string {
  const lines = text.split('\n');
  let start = lines[0]?.trim() === name.trim() ? 1 : 0;
  while (lines[start] && isHeader(lines[start])) start += 1;
  return lines.slice(start).join('\n').trim();
}

interface Presented {
  name: string;
  shown: string;
  found: { format: Format; timer: TimerConfig } | null;
}

// The reading of a stored text never changes, so it is done once per text. A long history is redrawn often.
const seen = new Map<string, Presented>();

function present(name: string, source: string): Presented {
  const key = `${name}\u0000${source}`;
  const hit = seen.get(key);
  if (hit) return hit;
  const text = reflow(source);
  const found = clock(text);
  const shownName = title(name, text);
  const made: Presented = { name: shownName, shown: withoutTitle(shownName, text), found };
  if (seen.size >= 3000) seen.clear();
  seen.set(key, made);
  return made;
}

export function presentStored<T extends { name: string; format: Format; timer: TimerConfig; text: string }>(wod: T): T {
  const { name, shown, found } = present(wod.name, wod.text);
  if (!found || (wod.format !== 'other' && wod.format !== found.format)) return { ...wod, name, text: shown };
  const timer = wod.format === found.format ? { ...wod.timer, ...found.timer } : { ...found.timer };
  return { ...wod, name, text: shown, format: found.format, timer };
}
