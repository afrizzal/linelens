import { describe, expect, it } from 'vitest';
import { breaksWithin, plannedProductionTimeMs, shiftInstanceAt, type ShiftDef } from '../src/calendar.js';

const SHIFTS: ShiftDef[] = [
  {
    id: 'S1',
    name: 'Shift 1',
    startMin: 420, // 07:00
    endMin: 900, // 15:00
    breaks: [
      { startMin: 570, endMin: 585 }, // 09:30-09:45
      { startMin: 720, endMin: 750 }, // 12:00-12:30
    ],
  },
  {
    id: 'S2',
    name: 'Shift 2',
    startMin: 900, // 15:00
    endMin: 1380, // 23:00
    breaks: [
      { startMin: 1050, endMin: 1065 }, // 17:30-17:45
      { startMin: 1200, endMin: 1230 }, // 20:00-20:30
    ],
  },
];

// A fixed sim-midnight: 2026-07-25T00:00:00.000Z
const MIDNIGHT_MS = Date.parse('2026-07-25T00:00:00.000Z');
const MS_PER_MIN = 60_000;

describe('shiftInstanceAt', () => {
  it('finds the shift containing a given sim instant', () => {
    const simMs = MIDNIGHT_MS + 500 * MS_PER_MIN; // 08:20, inside S1
    const inst = shiftInstanceAt(simMs, SHIFTS);
    expect(inst?.shiftId).toBe('S1');
    expect(inst?.date).toBe('2026-07-25');
  });

  it('returns null outside any shift (23:30 -> no shift, schedule loss)', () => {
    const simMs = MIDNIGHT_MS + 1410 * MS_PER_MIN; // 23:30
    expect(shiftInstanceAt(simMs, SHIFTS)).toBeNull();
  });
});

describe('plannedProductionTimeMs', () => {
  it('a full default shift = 435 minutes of PPT', () => {
    const simMs = MIDNIGHT_MS + 500 * MS_PER_MIN;
    const inst = shiftInstanceAt(simMs, SHIFTS)!;
    const pptMs = plannedProductionTimeMs(inst, SHIFTS);
    expect(pptMs).toBe(435 * MS_PER_MIN);
  });

  it('a clamp mid-break excludes only the elapsed break overlap', () => {
    const simMs = MIDNIGHT_MS + 500 * MS_PER_MIN;
    const inst = shiftInstanceAt(simMs, SHIFTS)!;
    // Clamp at 09:37 -- 7 minutes into the 09:30-09:45 break.
    const clampMs = MIDNIGHT_MS + 577 * MS_PER_MIN;
    const pptMs = plannedProductionTimeMs(inst, SHIFTS, clampMs);
    // Elapsed window: 07:00-09:37 = 157 min, minus 7 min elapsed break overlap = 150 min.
    expect(pptMs).toBe(150 * MS_PER_MIN);
  });

  it('breaksWithin resolves absolute sim-ms ranges for the instance', () => {
    const simMs = MIDNIGHT_MS + 500 * MS_PER_MIN;
    const inst = shiftInstanceAt(simMs, SHIFTS)!;
    const breaks = breaksWithin(inst, SHIFTS);
    expect(breaks).toEqual([
      { startMs: MIDNIGHT_MS + 570 * MS_PER_MIN, endMs: MIDNIGHT_MS + 585 * MS_PER_MIN },
      { startMs: MIDNIGHT_MS + 720 * MS_PER_MIN, endMs: MIDNIGHT_MS + 750 * MS_PER_MIN },
    ]);
  });
});
