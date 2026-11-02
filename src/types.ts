export type Format = 'fortime' | 'amrap' | 'emom' | 'tabata' | 'other';

export interface TimerConfig {
  capSec?: number;
  durationSec?: number;
  intervalSec?: number;
  rounds?: number;
  workSec?: number;
  restSec?: number;
  sets?: number;
  setRestSec?: number;
  prepSec?: number;
}

export interface Result {
  at: string;
  kind: 'time' | 'rounds' | 'free';
  value: string;
  note?: string;
}

export type WodSource = 'scan' | 'manual' | 'hero';

export interface Wod {
  id: string;
  name: string;
  format: Format;
  timer: TimerConfig;
  text: string;
  createdAt: string;
  source: WodSource;
  hash: string;
  results: Result[];
}

export interface ScanResult {
  name: string;
  format: Format;
  timer: TimerConfig;
  text: string;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
}

export const FORMATS: readonly Format[] = ['fortime', 'amrap', 'emom', 'tabata', 'other'];
export const SOURCES: readonly WodSource[] = ['scan', 'manual', 'hero'];
