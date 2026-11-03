import { GROUPS } from './synonyms';

// Pure search over a list of workouts. No DOM, no storage, no dependency.

export interface Folded {
  text: string;
  map: number[];
}

const MARKS = /\p{M}/gu;
const APOSTROPHES = new Set(['’', '‘', '`', '´']);
const SEPARATORS = /[\s\-_/ ]/;

// Lowercases, drops accents, turns hyphens, slashes and runs of spaces into one space.
// map[i] is the index in the original string of the character at folded index i.
export function fold(input: string): Folded {
  let text = '';
  const map: number[] = [];
  let spaced = true;
  let at = 0;
  for (const ch of input) {
    const start = at;
    at += ch.length;
    const plain = ch.normalize('NFD').replace(MARKS, '').toLowerCase().replace(/ß/g, 'ss').replace(/œ/g, 'oe').replace(/æ/g, 'ae');
    for (const raw of plain) {
      let c = APOSTROPHES.has(raw) ? "'" : raw;
      if (SEPARATORS.test(c)) c = ' ';
      if (c === ' ') {
        if (spaced) continue;
        spaced = true;
      } else {
        spaced = false;
      }
      text += c;
      for (let unit = 0; unit < c.length; unit++) map.push(start);
    }
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}

export function normalize(input: string): string {
  return fold(input).text;
}

export interface Query {
  // One entry per typed word. Each entry lists the folded alternatives, the typed word first.
  tokens: string[][];
  // The whole query folded, used to reward results that contain it as typed.
  phrase: string;
}

const MULTI = GROUPS.flatMap((group) => group.filter((term) => term.includes(' ')).map((term) => ({ term, words: term.split(' '), group })))
  .sort((a, b) => b.words.length - a.words.length);

function related(word: string): string[] {
  const found: string[] = [];
  for (const group of GROUPS) {
    const hit = group.some((term) => term === word || (word.length >= 3 && term.startsWith(word)) || (term.length >= 4 && word.startsWith(term)));
    if (hit) for (const term of group) if (term !== word && !found.includes(term)) found.push(term);
  }
  return found;
}

export function parseQuery(raw: string): Query {
  const phrase = normalize(raw);
  const words = phrase ? phrase.split(' ') : [];
  const tokens: string[][] = [];
  for (let i = 0; i < words.length; ) {
    const multi = MULTI.find((entry) => entry.words.every((word, k) => words[i + k] === word || words[i + k] === `${word}s`));
    if (multi) {
      tokens.push([multi.term, ...multi.group.filter((term) => term !== multi.term)]);
      i += multi.words.length;
      continue;
    }
    const word = words[i] as string;
    tokens.push([word, ...related(word)]);
    i += 1;
  }
  return { tokens, phrase };
}

export function isEmpty(query: Query): boolean {
  return query.tokens.length === 0;
}

export interface Doc {
  name: string;
  text: string;
  meta: string;
}

export interface Indexed<T> {
  item: T;
  name: string;
  text: string;
  meta: string;
  // Name, text and meta with every space removed, so "pullups" finds "pull-ups".
  all: string;
}

export function buildIndex<T>(items: readonly T[], read: (item: T) => Doc): Indexed<T>[] {
  return items.map((item) => {
    const doc = read(item);
    const name = normalize(doc.name);
    const text = normalize(doc.text);
    const meta = normalize(doc.meta);
    return { item, name, text, meta, all: `${name} ${text} ${meta}`.replace(/ /g, '') };
  });
}

export interface Hit<T> {
  item: T;
  score: number;
}

function tokenScore<T>(doc: Indexed<T>, alts: readonly string[]): number {
  let best = 0;
  for (const alt of alts) {
    let score = 0;
    if (doc.name.startsWith(alt)) score = 100;
    else if (doc.name.includes(` ${alt}`)) score = 80;
    else if (doc.name.includes(alt)) score = 60;
    else if (doc.text.includes(alt)) score = 30;
    else if (doc.meta.includes(alt)) score = 10;
    else if (alt.length >= 4 && !alt.includes(' ') && doc.all.includes(alt)) score = 5;
    if (score > best) best = score;
    if (best === 100) break;
  }
  return best;
}

// Every typed word must be found (AND). Within a word, any synonym counts. Results come back
// in the order of the input list when scores tie, so a list sorted newest-first stays that way.
export function search<T>(index: readonly Indexed<T>[], query: Query): Hit<T>[] {
  if (isEmpty(query)) return index.map((entry) => ({ item: entry.item, score: 0 }));
  const hits: Hit<T>[] = [];
  for (const doc of index) {
    let total = 0;
    let all = true;
    for (const alts of query.tokens) {
      const score = tokenScore(doc, alts);
      if (score === 0) {
        all = false;
        break;
      }
      total += score;
    }
    if (!all) continue;
    if (query.tokens.length > 1 && (doc.name.includes(query.phrase) || doc.text.includes(query.phrase))) total += 50;
    hits.push({ item: doc.item, score: total });
  }
  return hits.sort((a, b) => b.score - a.score);
}

// Ranges [start, end) in the original text that match a typed word or one of its synonyms.
export function matchRanges(original: string, query: Query): [number, number][] {
  if (isEmpty(query) || !original) return [];
  const folded = fold(original);
  const found: [number, number][] = [];
  for (const alts of query.tokens) {
    for (const alt of alts) {
      if (!alt) continue;
      for (let from = folded.text.indexOf(alt); from !== -1; from = folded.text.indexOf(alt, from + alt.length)) {
        const first = folded.map[from];
        const last = folded.map[from + alt.length - 1];
        if (first === undefined || last === undefined) continue;
        const lastChar = original.codePointAt(last);
        found.push([first, last + (lastChar !== undefined && lastChar > 0xffff ? 2 : 1)]);
      }
    }
  }
  found.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const range of found) {
    const prev = merged[merged.length - 1];
    if (prev && range[0] <= prev[1]) prev[1] = Math.max(prev[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

export type SortMode = 'recent' | 'name';

// "recent" keeps the relevance order, then the input order. "name" sorts A to Z.
export function sortHits<T>(hits: Hit<T>[], mode: SortMode, name: (item: T) => string): Hit<T>[] {
  if (mode !== 'name') return hits;
  return [...hits].sort((a, b) => normalize(name(a.item)).localeCompare(normalize(name(b.item))));
}
