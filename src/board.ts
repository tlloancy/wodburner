import { reflow } from './reflow';
import type { BoardPart, BoardRole, Format, TimerConfig } from './types';

export type { BoardPart, BoardRole };

export interface BoardInput {
  name: string;
  format: Format;
  timer: TimerConfig;
  text: string;
  parts?: BoardPart[];
}

interface Inferred {
  format: Format;
  timer: TimerConfig;
  explicit: boolean;
}

type Hint = BoardRole | 'warmup' | null;

interface RawBlock {
  role: Hint;
  lines: string[];
}

const HEAD = /^(?:(?:\d+|[a-d])\s*[.)\-:]\s*)?(skill|skills|technique|force|strength|renfo|renforcement|halterophilie|haltero|weightlifting|gymnastique|gymnastics|metcon|met-con|wod|conditioning|conditionnement|echauffement|warm-?up|warmup|mobilite|mobility|cooldown|cool-down|retour au calme)\b(.*)$/;

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/×/g, 'x');
}

function heading(line: string): { role: Hint; keep: boolean } | null {
  const match = HEAD.exec(fold(line).trim());
  if (!match) return null;
  const rest = (match[2] || '').trim();
  if (rest.split(/\s+/).filter(Boolean).length > 6) return null;
  const word = match[1];
  let role: Hint = 'metcon';
  if (/^(echauffement|warm-?up|warmup|mobilite|mobility|cooldown|cool-down|retour au calme)$/.test(word)) role = 'warmup';
  else if (/^(skill|skills|technique|force|strength|renfo|renforcement|halterophilie|haltero|weightlifting|gymnastique|gymnastics)$/.test(word)) role = 'skill';
  return { role, keep: rest.length > 0 };
}

function clockKind(line: string): 'amrap' | 'emom' | 'fortime' | 'tabata' | null {
  const t = fold(line).trim();
  if (/^amrap\b/.test(t) || /^\d{1,3}\s*(?::\d{2})?\s*min(?:ute)?s?\s+amrap\b/.test(t)) return 'amrap';
  if (/^e\d{1,2}(?:[.,]\d)?\s*mom\b/.test(t) || /^e\d{2,3}\s*s\b/.test(t) || /^emom\b/.test(t)) return 'emom';
  if (/^every\s+(?:\d|minute\b)/.test(t) || /^toutes les\s+\d/.test(t) || /^chaque minute\b/.test(t)) return 'emom';
  if (/^tabata\b/.test(t)) return 'tabata';
  if (/^for\s*time\b/.test(t) || /^rounds?\s+for\s+time\b/.test(t) || /^rft\b/.test(t) || /^contre la montre\b/.test(t) || /^pour le temps\b/.test(t) || /^ft$/.test(t)) return 'fortime';
  if (/\bfor\s*time\b/.test(t) && t.length < 120) return 'fortime';
  return null;
}

function hasBody(block: RawBlock): boolean {
  return block.lines.some((line) => line.trim() !== '' && !heading(line));
}

function blocksFrom(text: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  let current: RawBlock = { role: null, lines: [] };
  const flush = (): void => {
    const meaningful = current.lines.some((line) => {
      const head = heading(line);
      return line.trim() !== '' && (!head || head.keep);
    });
    if (meaningful && current.role !== 'warmup') blocks.push(current);
    current = { role: null, lines: [] };
  };
  for (const line of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    const head = heading(line);
    if (head) {
      if (current.lines.some((item) => item.trim() !== '')) flush();
      current.role = head.role;
      current.lines.push(line);
      continue;
    }
    if (clockKind(line) && hasBody(current)) flush();
    current.lines.push(line);
  }
  flush();
  return blocks;
}

function minutes(value: string, seconds?: string): number | null {
  const min = Number(value);
  const sec = seconds ? Number(seconds) : 0;
  if (!Number.isInteger(min) || min < 1 || min > 180 || sec > 59) return null;
  return min * 60 + sec;
}

function amrapOf(line: string): number | null {
  const t = fold(line).trim();
  const same = /^amrap\b(?:\s+(?:de|of))?\s*(\d{1,3})(?:\s*:\s*(\d{2})|\s*['’′])?(?:\s*min(?:ute)?s?)?(?:\s+cap)?\s*$/.exec(t)
    || /^(\d{1,3})(?:\s*:\s*(\d{2}))?\s*min(?:ute)?s?\s+amrap\s*$/.exec(t);
  if (!same) return null;
  return minutes(same[1], same[2]);
}

function unitSeconds(amount: string, seconds: string | undefined, unit: string | undefined): number | null {
  if (seconds !== undefined) return minutes(amount, seconds);
  const n = Number(amount);
  if (!Number.isInteger(n) || n < 1 || n > 3600) return null;
  if (unit && /^s/.test(unit)) return n <= 3600 ? n : null;
  if (n > 15 && !unit) return null;
  return n * 60;
}

function emomOf(line: string): { intervalSec: number; rounds?: number } | null {
  const t = fold(line).trim();
  const everyMinute = /^every\s+minute(?:\s+on\s+the\s+minute)?(?:\s+for\s+(\d{1,3}))?\b/.exec(t);
  if (everyMinute) return { intervalSec: 60, ...(everyMinute[1] ? { rounds: Number(everyMinute[1]) } : {}) };
  const chaque = /^chaque minute(?:\s+pendant\s+(\d{1,3}))?\b/.exec(t);
  if (chaque) return { intervalSec: 60, ...(chaque[1] ? { rounds: Number(chaque[1]) } : {}) };
  const numbered = /^e(\d{1,2})(?:[.,](\d))?\s*mom\b(.*)$/.exec(t);
  if (numbered) {
    const whole = Number(numbered[1]);
    const frac = numbered[2] ? Number(numbered[2]) : 0;
    const intervalSec = whole * 60 + frac * 6;
    const rest = numbered[3].trim();
    const rounds = /^(?:(?:x|for|pendant)\s*)?(\d{1,3})\s*(?:rounds?|tours?|min(?:ute)?s?)?\s*$/.exec(rest);
    return intervalSec > 0 ? { intervalSec, ...(rounds ? { rounds: Number(rounds[1]) } : {}) } : null;
  }
  const short = /^e(\d{2,3})\s*s\b(?:\s*(?:x)?\s*(\d{1,3}))?/.exec(t);
  if (short) return { intervalSec: Number(short[1]), ...(short[2] ? { rounds: Number(short[2]) } : {}) };
  const every = /^every\s+(\d{1,3})(?:\s*:\s*(\d{2}))?\s*(min(?:ute)?s?|sec(?:ond)?s?|s)?(?:\s*(?:for|x)\s*(\d{1,3}))?/.exec(t);
  if (every) {
    const intervalSec = unitSeconds(every[1], every[2], every[3]);
    if (intervalSec) return { intervalSec, ...(every[4] ? { rounds: Number(every[4]) } : {}) };
  }
  const toutes = /^toutes les\s+(\d{1,3})(?:\s*:\s*(\d{2}))?\s*(min(?:ute)?s?|s(?:ec(?:onde)?s?)?)?(?:\s*(?:x|pendant|for)\s*(\d{1,3}))?/.exec(t);
  if (toutes) {
    const intervalSec = unitSeconds(toutes[1], toutes[2], toutes[3]);
    if (intervalSec) return { intervalSec, ...(toutes[4] ? { rounds: Number(toutes[4]) } : {}) };
  }
  const emom = /^emom\b(?:\s+(\d{1,3}))?/.exec(t);
  if (emom) return { intervalSec: 60, ...(emom[1] ? { rounds: Number(emom[1]) } : {}) };
  return null;
}

function findRounds(lines: string[]): number | undefined {
  for (const line of lines) {
    const t = fold(line).trim();
    const match = /^(?:x)\s*(\d{1,3})\b/.exec(t)
      || /^(\d{1,3})\s*(?:rounds?|tours?)\b/.exec(t)
      || /^(\d{1,3})\s*x\s*$/.exec(t)
      || /^pendant\s+(\d{1,3})\s*min\b/.exec(t)
      || /^for\s+(\d{1,3})\s*(?:min|rounds?)\b/.exec(t);
    if (!match) continue;
    const n = Number(match[1]);
    if (n >= 1 && n <= 500) return n;
  }
  return undefined;
}

function findCap(lines: string[]): number | undefined {
  for (const line of lines) {
    const t = fold(line).trim();
    const tc = /\btc\s*:?\s*(\d{1,3})(?:\s*:\s*(\d{2}))?\s*(?:['’′]|min(?:ute)?s?)?/.exec(t);
    if (tc) {
      const total = minutes(tc[1], tc[2]);
      if (total) return total;
    }
    const maximum = /\bmaximum\s+(\d{1,3})\s*['’′]/.exec(t);
    if (maximum) {
      const total = minutes(maximum[1]);
      if (total) return total;
    }
    const seconds = /\b(?:time\s*cap|cap|plafond)\s*(?:de\s*)?(\d{1,4})\s*s(?:ec(?:onde)?s?)?\b/.exec(t);
    if (seconds) {
      const n = Number(seconds[1]);
      if (n >= 1 && n <= 86_400) return n;
    }
    const clock = /\b(?:time\s*cap|cap|plafond)\s*(?:de\s*)?(\d{1,3})(?:\s*:\s*(\d{2}))?(?:\s*min(?:ute)?s?)?\b/.exec(t)
      || /^(\d{1,3})(?:\s*:\s*(\d{2}))?\s*min(?:ute)?s?\s*(?:time\s*)?cap\b/.exec(t);
    if (!clock) continue;
    const total = minutes(clock[1], clock[2]);
    if (total) return total;
  }
  return undefined;
}

function tabataOf(text: string): TimerConfig {
  const t = fold(text);
  const slash = /\b(\d{1,3})\s*\/\s*(\d{1,3})\b/.exec(t);
  const rounds = /\b(\d{1,2})\s*(?:rounds?|tours?)\b/.exec(t);
  const work = slash ? Number(slash[1]) : 20;
  const rest = slash ? Number(slash[2]) : 10;
  const count = rounds ? Number(rounds[1]) : 8;
  return {
    workSec: work >= 1 && work <= 3600 ? work : 20,
    restSec: rest >= 0 && rest <= 3600 ? rest : 10,
    rounds: count >= 1 && count <= 500 ? count : 8,
  };
}

function followingDuration(line: string): number | null {
  const t = fold(line).trim();
  const clock = /^(\d{1,3})\s*:\s*(\d{2})\s*$/.exec(t);
  if (clock) return minutes(clock[1], clock[2]);
  const withUnit = /^(\d{1,3})\s*(?:min(?:ute)?s?|['’′])\s*$/.exec(t);
  if (withUnit) return minutes(withUnit[1]);
  const only = /^(\d{1,3})\s*$/.exec(t);
  return only ? minutes(only[1]) : null;
}

function followingRounds(line: string): number | undefined {
  const t = fold(line).trim();
  if (t.includes(':')) return undefined;
  const match = /^(\d{1,3})\s*(?:min(?:ute)?s?|['’′])?\s*$/.exec(t);
  if (!match) return undefined;
  const n = Number(match[1]);
  return n >= 1 && n <= 500 ? n : undefined;
}

function readClock(text: string): Inferred | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kind = clockKind(line);
    if (kind === 'amrap') {
      let durationSec = amrapOf(line);
      const next = lines[i + 1];
      if (!durationSec && next && /^amrap\s*$/.test(fold(line).trim())) durationSec = followingDuration(next);
      if (!durationSec) continue;
      return { format: 'amrap', timer: { durationSec }, explicit: true };
    }
    if (kind === 'emom') {
      const parsed = emomOf(line);
      if (!parsed) continue;
      let rounds = parsed.rounds ?? findRounds(lines);
      const next = lines[i + 1];
      if (!rounds && next && /^(?:emom|every minute|chaque minute)\s*$/.test(fold(line).trim())) rounds = followingRounds(next);
      const timer: TimerConfig = { intervalSec: parsed.intervalSec };
      if (rounds) timer.rounds = rounds;
      return { format: 'emom', timer, explicit: true };
    }
    if (kind === 'tabata') return { format: 'tabata', timer: tabataOf(text), explicit: true };
    if (kind === 'fortime') {
      const capSec = findCap(lines);
      return { format: 'fortime', timer: capSec ? { capSec } : {}, explicit: true };
    }
  }
  const capSec = findCap(lines);
  if (capSec) return { format: 'fortime', timer: { capSec }, explicit: true };
  if (/\b\d{1,3}\s*-\s*\d{1,3}\s*-\s*\d{1,3}\b/.test(text)) return { format: 'fortime', timer: {}, explicit: false };
  const movements = lines.filter((line) => line.trim() && !heading(line) && !clockKind(line) && /[a-z]/i.test(line)).length;
  if (movements >= 2 && /^\s*\d{1,2}\s+rounds?\b/im.test(text)) return { format: 'fortime', timer: {}, explicit: false };
  return null;
}

function looksLikeStrength(text: string): boolean {
  const t = fold(text);
  return /\b\d{1,2}\s*x\s*\d{1,2}\b/.test(t) || /@\s*\d{1,3}\s*%/.test(t) || /\b\d{2,3}\s*%/.test(t) || /\brpe\b/.test(t) || /\bbuild to\b/.test(t) || /\b1\s*rm\b/.test(t) || /\bmonter en charge\b/.test(t) || /\blourd\b/.test(t) || /\bheavy\b/.test(t);
}

function movementCount(text: string): number {
  return text.split('\n').filter((line) => {
    const raw = line.trim();
    if (!raw || heading(raw) || clockKind(raw)) return false;
    const t = fold(raw);
    if (/^(cap|time cap|plafond|repos|rest)\b/.test(t)) return false;
    return /[a-z]/i.test(raw);
  }).length;
}

function preferTitle(name: string, text: string): string {
  const first = text.split('\n').map((line) => line.trim()).find(Boolean) || '';
  const clipped = first.length > 80 ? `${first.slice(0, 79)}…` : first;
  const compact = (value: string): string => value.replace(/…$/, '').replace(/\s+/g, '');
  if (!name.trim()) return clipped;
  const flatName = compact(name);
  if (flatName.length > 40 && compact(text).startsWith(flatName.slice(0, Math.min(flatName.length, 48)))) return clipped;
  return name.trim();
}

function deriveName(text: string, role: BoardRole): string {
  for (const line of text.split('\n')) {
    const raw = line.trim();
    if (!raw) continue;
    const head = heading(raw);
    if (head && !head.keep) continue;
    const clipped = raw.replace(/\s+/g, ' ');
    return clipped.length > 80 ? `${clipped.slice(0, 79)}…` : clipped;
  }
  return role === 'skill' ? 'Skill' : 'Metcon';
}

function resolveTimer(inferred: Inferred | null, solo: boolean, model: { format: Format; timer: TimerConfig }): { format: Format; timer: TimerConfig } {
  if (inferred?.explicit) return { format: inferred.format, timer: inferred.timer };
  if (solo) {
    if (inferred?.format === 'fortime' && model.format === 'fortime') return { format: 'fortime', timer: model.timer };
    if (!inferred) return { format: model.format, timer: model.timer };
  }
  if (inferred) return { format: inferred.format, timer: inferred.timer };
  return { format: 'other', timer: {} };
}

function assignRoles(blocks: Array<{ hint: Hint; text: string; inferred: Inferred | null }>): BoardRole[] {
  const roles: Array<BoardRole | null> = blocks.map((block) => (block.hint === 'skill' || block.hint === 'metcon' ? block.hint : null));
  const circuit = (block: { text: string; inferred: Inferred | null }): boolean => {
    const format = block.inferred?.format;
    if (format === 'amrap' || format === 'fortime' || format === 'tabata') return true;
    return format === 'emom' && movementCount(block.text) >= 3 && !looksLikeStrength(block.text);
  };
  const skillish = (block: { text: string; inferred: Inferred | null }): boolean => {
    if (looksLikeStrength(block.text) && block.inferred?.format !== 'amrap' && block.inferred?.format !== 'tabata') return true;
    return block.inferred?.format === 'emom' && movementCount(block.text) <= 2;
  };
  if (blocks.length === 1) {
    if (roles[0]) return [roles[0]];
    if (skillish(blocks[0]) && !circuit(blocks[0])) return ['skill'];
    return ['metcon'];
  }
  for (let i = 0; i < blocks.length; i++) {
    if (roles[i]) continue;
    if (skillish(blocks[i]) && blocks.some((block, index) => index !== i && circuit(block))) roles[i] = 'skill';
    else if (circuit(blocks[i])) roles[i] = 'metcon';
  }
  if (blocks.length === 2 && roles[0] === 'metcon' && roles[1] === 'metcon') {
    const first = blocks[0].inferred?.format;
    const second = blocks[1].inferred?.format;
    const secondIsMetcon = second === 'amrap' || second === 'fortime' || second === 'tabata';
    if (secondIsMetcon && (first === 'emom' || first == null || first === 'other')) roles[0] = 'skill';
  }
  for (let i = 0; i < blocks.length; i++) {
    if (roles[i]) continue;
    const otherMetcon = roles.some((role, index) => index !== i && role === 'metcon');
    roles[i] = otherMetcon && !circuit(blocks[i]) ? 'skill' : 'metcon';
  }
  for (let i = 0; i < blocks.length; i++) {
    const format = blocks[i].inferred?.format;
    const strengthOnly = looksLikeStrength(blocks[i].text) && format !== 'amrap' && format !== 'fortime' && format !== 'tabata' && format !== 'emom';
    if (roles[i] === 'metcon' && strengthOnly && roles.some((role, index) => index !== i && role === 'metcon' && circuit(blocks[index]))) roles[i] = 'skill';
    if (roles[i] === 'skill' && (format === 'amrap' || format === 'fortime' || format === 'tabata') && blocks.some((block, index) => index !== i && looksLikeStrength(block.text) && !circuit(block))) roles[i] = 'metcon';
  }
  return roles.map((role) => role || 'metcon');
}

function pieceFrom(text: string, role: BoardRole, inferred: Inferred | null, solo: boolean, model: { format: Format; timer: TimerConfig }, name: string): BoardPart | null {
  const body = text.trim();
  if (!body) return null;
  const timer = resolveTimer(inferred, solo, model);
  return { role, name, format: timer.format, timer: timer.timer, text: body };
}

export function arrangeBoard(input: BoardInput): { name: string; format: Format; timer: TimerConfig; parts: BoardPart[] } {
  const multi = Boolean(input.parts && input.parts.length >= 2 && blocksFrom(input.text).length < 2);
  const textIn = multi ? input.text : reflow(input.text);
  let raw = blocksFrom(textIn);
  if (multi && input.parts) {
    const fromParts = input.parts.flatMap((part) => {
      const inner = blocksFrom(reflow(part.text));
      const blocks = inner.length > 0 ? inner : [{ role: part.role, lines: part.text.split('\n') }];
      return blocks.map((block) => ({ role: block.role ?? part.role, lines: block.lines }));
    });
    if (fromParts.length >= 2) raw = fromParts;
  }
  if (raw.length === 0) raw = [{ role: null, lines: input.text.split('\n') }];

  const solo = raw.length === 1;
  const drafts = raw.map((block) => {
    const source = reflow(block.lines.join('\n')).trim();
    const text = solo ? textIn.trim() || source : source;
    return { hint: block.role, text, source, inferred: readClock(source || text) };
  }).filter((draft) => draft.text !== '');
  if (drafts.length === 0) {
    const only = resolveTimer(null, true, input);
    const name = input.name.trim() || 'Metcon';
    return { name, format: only.format, timer: only.timer, parts: [{ role: 'metcon', name, format: only.format, timer: only.timer, text: input.text }] };
  }

  const roles = assignRoles(drafts);
  const parts = drafts.flatMap((draft, index) => {
    const role = roles[index] ?? 'metcon';
    const named = preferTitle(solo ? input.name : '', draft.text) || deriveName(draft.source, role);
    const piece = pieceFrom(draft.text, role, draft.inferred, solo, input, named);
    return piece ? [piece] : [];
  });
  parts.sort((a, b) => (a.role === b.role ? 0 : a.role === 'skill' ? -1 : 1));
  const primary = [...parts].reverse().find((part) => part.role === 'metcon') ?? parts[0];
  return {
    name: preferTitle(input.name, parts.map((part) => part.text).join('\n')) || primary.name,
    format: primary.format,
    timer: primary.timer,
    parts,
  };
}

