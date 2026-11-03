import type { Wod } from './types';
import { workoutHash } from './hash';
import { parseExport, type ExportFile } from './validate';

export function exportDocument(wods: Wod[], now = new Date()): ExportFile {
  return { version: 1, exportedAt: now.toISOString(), wods };
}

function slot(wod: Wod): string {
  return `${wod.by ?? ''}:${wod.hash}`;
}

export function mergeByHash(existing: Wod[], incoming: Wod[]): { wods: Wod[]; added: number; merged: number } {
  const map = new Map<string, Wod>();
  for (const wod of existing) map.set(slot(wod), { ...wod, timer: { ...wod.timer }, results: [...wod.results] });
  const ids = new Set(existing.map((wod) => wod.id));
  let added = 0;
  let merged = 0;
  for (const wod of incoming) {
    const prev = map.get(slot(wod));
    if (!prev) {
      let id = wod.id;
      if (ids.has(id)) id = crypto.randomUUID();
      ids.add(id);
      map.set(slot(wod), { ...wod, id, timer: { ...wod.timer }, results: [...wod.results] });
      added += 1;
      continue;
    }
    if (prev.by) {
      prev.name = wod.name;
      prev.format = wod.format;
      prev.text = wod.text;
      prev.timer = { ...wod.timer };
      prev.source = wod.source;
      prev.createdAt = wod.createdAt;
      prev.who = wod.who;
      prev.results = wod.results.map((result) => ({ ...result }));
      merged += 1;
      continue;
    }
    const seen = new Set(prev.results.map((result) => `${result.at}\n${result.kind}\n${result.value}`));
    for (const result of wod.results) {
      const key = `${result.at}\n${result.kind}\n${result.value}`;
      if (!seen.has(key)) {
        prev.results.push(result);
        seen.add(key);
      }
    }
    if (wod.createdAt < prev.createdAt) prev.createdAt = wod.createdAt;
    merged += 1;
  }
  const wods = [...map.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { wods, added, merged };
}

export async function readWods(raw: unknown): Promise<Wod[]> {
  const file = parseExport(raw);
  const prepared: Wod[] = [];
  for (const wod of file.wods) prepared.push({ ...wod, hash: await workoutHash(wod.name, wod.format, wod.text) });
  return prepared;
}

export async function importDocument(existing: Wod[], raw: unknown): Promise<{ wods: Wod[]; added: number; merged: number }> {
  return mergeByHash(existing, await readWods(raw));
}
