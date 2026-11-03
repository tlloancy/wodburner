import { arrangeBoard, type BoardPart } from './board';
import { FORMATS, SOURCES, type BoardRole, type Format, type Result, type ScanResult, type TimerConfig, type Wod, type WodSource } from './types';

export class DataError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DataError';
  }
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalInt(value: unknown, min: number, max: number, code: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new DataError(code);
  return value;
}

export function parseTimer(value: unknown): TimerConfig {
  if (!isObj(value)) throw new DataError('invalid-timer');
  const timer: TimerConfig = {};
  const capSec = optionalInt(value.capSec, 1, 86_400, 'invalid-timer');
  const durationSec = optionalInt(value.durationSec, 1, 86_400, 'invalid-timer');
  const intervalSec = optionalInt(value.intervalSec, 1, 3_600, 'invalid-timer');
  const rounds = optionalInt(value.rounds, 1, 500, 'invalid-timer');
  const workSec = optionalInt(value.workSec, 1, 3_600, 'invalid-timer');
  const restSec = optionalInt(value.restSec, 0, 3_600, 'invalid-timer');
  const sets = optionalInt(value.sets, 1, 40, 'invalid-timer');
  const setRestSec = optionalInt(value.setRestSec, 0, 3_600, 'invalid-timer');
  const prepSec = optionalInt(value.prepSec, 0, 120, 'invalid-timer');
  if (capSec !== undefined) timer.capSec = capSec;
  if (durationSec !== undefined) timer.durationSec = durationSec;
  if (intervalSec !== undefined) timer.intervalSec = intervalSec;
  if (rounds !== undefined) timer.rounds = rounds;
  if (workSec !== undefined) timer.workSec = workSec;
  if (restSec !== undefined) timer.restSec = restSec;
  if (sets !== undefined) timer.sets = sets;
  if (setRestSec !== undefined) timer.setRestSec = setRestSec;
  if (prepSec !== undefined) timer.prepSec = prepSec;
  return timer;
}

export function parseScanResult(value: unknown): ScanResult {
  if (!isObj(value)) throw new DataError('invalid-scan');
  if (typeof value.name !== 'string' || value.name.length > 160) throw new DataError('invalid-name');
  if (typeof value.format !== 'string' || !FORMATS.includes(value.format as Format)) throw new DataError('invalid-format');
  if (typeof value.text !== 'string' || value.text.length > 20_000) throw new DataError('invalid-text');
  if (value.confidence !== 'high' && value.confidence !== 'medium' && value.confidence !== 'low') throw new DataError('invalid-confidence');
  if (!Array.isArray(value.warnings) || value.warnings.length > 40) throw new DataError('invalid-warnings');
  const warnings: string[] = [];
  for (const warning of value.warnings) {
    if (typeof warning !== 'string' || warning.length > 300) throw new DataError('invalid-warnings');
    warnings.push(warning);
  }
  const arranged = arrangeBoard({
    name: value.name.trim(),
    format: value.format as Format,
    timer: parseTimer(value.timer ?? {}),
    text: value.text,
    parts: parseParts(value.parts),
  });
  return {
    name: arranged.name,
    format: arranged.format,
    timer: arranged.timer,
    text: value.text,
    confidence: value.confidence,
    warnings,
    parts: arranged.parts,
  };
}

function parseParts(value: unknown): BoardPart[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new DataError('invalid-scan');
  const parts: BoardPart[] = [];
  for (const item of value) {
    if (!isObj(item)) throw new DataError('invalid-scan');
    if (item.role !== 'skill' && item.role !== 'metcon') continue;
    if (typeof item.name !== 'string' || item.name.length > 160) throw new DataError('invalid-scan');
    if (typeof item.format !== 'string' || !FORMATS.includes(item.format as Format)) throw new DataError('invalid-scan');
    if (typeof item.text !== 'string' || item.text.length > 20_000) throw new DataError('invalid-scan');
    parts.push({
      role: item.role as BoardRole,
      name: item.name.trim(),
      format: item.format as Format,
      timer: parseTimer(item.timer ?? {}),
      text: item.text,
    });
  }
  return parts;
}

function parseResult(value: unknown): Result {
  if (!isObj(value)) throw new DataError('invalid-result');
  if (typeof value.at !== 'string' || Number.isNaN(Date.parse(value.at))) throw new DataError('invalid-result');
  if (value.kind !== 'time' && value.kind !== 'rounds' && value.kind !== 'free') throw new DataError('invalid-result');
  if (typeof value.value !== 'string' || value.value.length === 0 || value.value.length > 200) throw new DataError('invalid-result');
  const result: Result = { at: value.at, kind: value.kind, value: value.value };
  if (value.note !== undefined) {
    if (typeof value.note !== 'string' || value.note.length > 500) throw new DataError('invalid-result');
    result.note = value.note;
  }
  return result;
}

export function parseWod(value: unknown): Wod {
  if (!isObj(value)) throw new DataError('invalid-wod');
  if (typeof value.id !== 'string' || value.id.length < 1 || value.id.length > 80) throw new DataError('invalid-wod');
  if (typeof value.name !== 'string' || value.name.length > 160) throw new DataError('invalid-wod');
  if (typeof value.format !== 'string' || !FORMATS.includes(value.format as Format)) throw new DataError('invalid-wod');
  if (typeof value.text !== 'string' || value.text.length > 20_000) throw new DataError('invalid-wod');
  if (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) throw new DataError('invalid-wod');
  if (typeof value.source !== 'string' || !SOURCES.includes(value.source as WodSource)) throw new DataError('invalid-wod');
  if (typeof value.hash !== 'string' || !/^[0-9a-f]{64}$/.test(value.hash)) throw new DataError('invalid-wod');
  if (!Array.isArray(value.results) || value.results.length > 500) throw new DataError('invalid-wod');
  if (value.by !== undefined && (typeof value.by !== 'string' || !/^[0-9a-f]{40}$/.test(value.by))) throw new DataError('invalid-wod');
  if (value.who !== undefined && (typeof value.who !== 'string' || value.who.trim().length === 0 || value.who.trim().length > 40)) throw new DataError('invalid-wod');
  const wod: Wod = {
    id: value.id,
    name: value.name,
    format: value.format as Format,
    timer: parseTimer(value.timer ?? {}),
    text: value.text,
    createdAt: value.createdAt,
    source: value.source as WodSource,
    hash: value.hash,
    results: value.results.map(parseResult),
  };
  if (typeof value.by === 'string') wod.by = value.by;
  if (typeof value.who === 'string') wod.who = value.who.trim();
  return wod;
}

export interface ExportFile {
  version: 1;
  exportedAt: string;
  wods: Wod[];
}

export function parseExport(value: unknown): ExportFile {
  if (!isObj(value)) throw new DataError('invalid-file');
  if (value.version !== 1) throw new DataError('invalid-version');
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt))) throw new DataError('invalid-file');
  if (!Array.isArray(value.wods) || value.wods.length > 5_000) throw new DataError('invalid-file');
  return { version: 1, exportedAt: value.exportedAt, wods: value.wods.map(parseWod) };
}
