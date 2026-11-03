import { describe, expect, it } from 'vitest';
import { arrangeBoard } from './board';
import { parseScanResult } from './validate';
import type { Format, TimerConfig } from './types';

function scan(text: string, format: Format = 'other', timer: TimerConfig = {}, name = '') {
  return parseScanResult({ name, format, timer, text, confidence: 'high', warnings: [] });
}

describe('arrangeBoard', () => {
  it('keeps a single for-time cap that is not written as a second piece', () => {
    const result = scan('21-15-9', 'fortime', { capSec: 900 }, 'Fran');
    expect(result.parts).toHaveLength(1);
    expect(result.format).toBe('fortime');
    expect(result.timer.capSec).toBe(900);
    expect(result.parts[0]?.role).toBe('metcon');
    expect(result.name).toBe('Fran');
  });

  it('overrides a wrong format when the only piece is an AMRAP', () => {
    const result = scan('AMRAP 12\n10 burpees\n15 box jumps', 'fortime', {});
    expect(result.parts).toHaveLength(1);
    expect(result.format).toBe('amrap');
    expect(result.timer).toEqual({ durationSec: 720 });
  });

  it('splits skill and metcon and does not reuse the metcon clock on the strength', () => {
    const result = scan('Back squat\n5x5 @ 80%\nRepos 2:00\n\nAMRAP 12\n10 wall balls\n8 toes to bar', 'emom', { intervalSec: 60, rounds: 12 });
    expect(result.parts.map((part) => part.role)).toEqual(['skill', 'metcon']);
    expect(result.parts[0]).toMatchObject({ name: 'Back squat', format: 'other', timer: {} });
    expect(result.parts[1]).toMatchObject({ name: 'AMRAP 12', format: 'amrap', timer: { durationSec: 720 } });
    expect(result.format).toBe('amrap');
    expect(result.timer).toEqual({ durationSec: 720 });
  });

  it('reads a skill EMOM and a capped for-time from headings', () => {
    const text = 'Skill\nEMOM 10\n1 power snatch\n\nMetcon\nFor time\n21-15-9\nThruster\nPull-up\nCap 10 min';
    const result = scan(text, 'amrap', { durationSec: 600 });
    expect(result.parts.map((part) => [part.role, part.format, part.timer])).toEqual([
      ['skill', 'emom', { intervalSec: 60, rounds: 10 }],
      ['metcon', 'fortime', { capSec: 600 }],
    ]);
    expect(result.parts[0]?.text).not.toContain('Thruster');
    expect(result.parts[1]?.text).not.toContain('power snatch');
  });

  it('reads French headings, every-2-minutes, and an AMRAP', () => {
    const text = 'Force\nToutes les 2 min x 5\n1 arraché\n\nMetcon\nAMRAP 14\n10 wall balls';
    const result = scan(text);
    expect(result.parts[0]).toMatchObject({ role: 'skill', format: 'emom', timer: { intervalSec: 120, rounds: 5 } });
    expect(result.parts[1]).toMatchObject({ role: 'metcon', format: 'amrap', timer: { durationSec: 840 } });
  });

  it('treats the first EMOM as the skill when a for-time follows', () => {
    const text = 'Every 2:00 x 6\n1 squat snatch\n\nFor time\n15-12-9\nthruster\npull-up\ncap 8 min';
    const result = scan(text, 'emom', { intervalSec: 60, rounds: 6 });
    expect(result.parts[0]).toMatchObject({ role: 'skill', format: 'emom', timer: { intervalSec: 120, rounds: 6 } });
    expect(result.parts[1]).toMatchObject({ role: 'metcon', format: 'fortime', timer: { capSec: 480 } });
  });

  it('drops the warm-up and keeps the two clocked pieces', () => {
    const text = 'Échauffement\n2 tours rameur\n\nSkill\nEMOM 8\n2 muscle-up\n\nWOD\nFor time\n50 burpees';
    const result = scan(text);
    expect(result.parts).toHaveLength(2);
    expect(result.parts.map((part) => part.role)).toEqual(['skill', 'metcon']);
    expect(result.parts[0]?.timer).toEqual({ intervalSec: 60, rounds: 8 });
    expect(result.parts[1]?.format).toBe('fortime');
    expect(result.parts.every((part) => !part.text.includes('rameur'))).toBe(true);
  });

  it('trusts separated parts when the model swapped the clocks', () => {
    const result = parseScanResult({
      name: 'Du jour',
      format: 'emom',
      timer: { intervalSec: 60, rounds: 10 },
      text: 'EMOM 10 1 snatch AMRAP 12',
      confidence: 'medium',
      warnings: [],
      parts: [
        { role: 'skill', name: 'Snatch', format: 'amrap', timer: { durationSec: 720 }, text: 'EMOM 10\n1 snatch' },
        { role: 'metcon', name: 'Burpees', format: 'emom', timer: { intervalSec: 60, rounds: 10 }, text: 'AMRAP 12\n10 burpees' },
      ],
    });
    expect(result.parts[0]).toMatchObject({ role: 'skill', format: 'emom', timer: { intervalSec: 60, rounds: 10 } });
    expect(result.parts[1]).toMatchObject({ role: 'metcon', format: 'amrap', timer: { durationSec: 720 } });
  });

  it('uses Tabata defaults only when the piece says Tabata', () => {
    const result = scan('Tabata\nburpees');
    expect(result.parts[0]).toMatchObject({ format: 'tabata', timer: { workSec: 20, restSec: 10, rounds: 8 } });
  });

  it('stays stable when arranged twice', () => {
    const text = 'Skill\nE2MOM 6\n1 squat clean\n\nMetcon\nAMRAP 9\n12 box jump';
    const once = scan(text, 'fortime', { capSec: 540 });
    const twice = arrangeBoard({ name: once.name, format: once.format, timer: once.timer, text: once.text, parts: once.parts });
    expect(twice.parts.map((part) => [part.role, part.format, part.timer])).toEqual(once.parts.map((part) => [part.role, part.format, part.timer]));
    expect(once.parts[0]?.timer).toEqual({ intervalSec: 120, rounds: 6 });
    expect(once.parts[1]?.timer).toEqual({ durationSec: 540 });
  });
});
