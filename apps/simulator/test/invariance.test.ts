import { describe, expect, it } from 'vitest';
import { PROFILES, type ShiftDef } from '@linelens/contracts';
import { makeRng, seedFor } from '../src/rng.js';
import { advance, createMachineRuntime, type MachineCtx } from '../src/machine.js';

/**
 * Speed-invariance (SIM-03 / ENG-06 upstream half): the machine's event
 * stream must depend only on sim-time, never on the real-time tick
 * granularity feeding `advance()`. We simulate two different "speeds" by
 * feeding advance() with different step sizes (mirroring what a 250ms
 * real-time loop would produce at speed 60 vs speed 600) and assert the
 * resulting event lists are byte-identical.
 */

const shifts: ShiftDef[] = [
  {
    id: 'S1',
    name: 'Shift 1',
    startMin: 420,
    endMin: 900,
    breaks: [
      { startMin: 570, endMin: 585 },
      { startMin: 720, endMin: 750 },
    ],
  },
  {
    id: 'S2',
    name: 'Shift 2',
    startMin: 900,
    endMin: 1380,
    breaks: [
      { startMin: 1050, endMin: 1065 },
      { startMin: 1200, endMin: 1230 },
    ],
  },
];

const products = [
  { id: 'CYC-A', name: 'Product A', idealCycleTimeSec: 3.0 },
  { id: 'CYC-B', name: 'Product B', idealCycleTimeSec: 4.0 },
];

const DAY_START = Date.parse('2026-01-05T07:00:00.000Z');
const FOUR_HOURS_MS = 4 * 60 * 60_000;

const runWithStep = (stepMs: number) => {
  const ctx: MachineCtx = {
    calib: PROFILES.typical,
    products,
    shifts,
    rng: makeRng(seedFor(42, 'L2-M1')),
  };
  const rt = createMachineRuntime({ id: 'L2-M1', lineId: 'L2', productId: 'CYC-A' }, ctx, DAY_START);
  const events: unknown[] = [];
  const horizon = DAY_START + FOUR_HOURS_MS;
  for (let toSimMs = DAY_START + stepMs; toSimMs < horizon; toSimMs += stepMs) {
    advance(rt, toSimMs, ctx, (e) => events.push(e));
  }
  advance(rt, horizon, ctx, (e) => events.push(e));
  return events;
};

describe('speed invariance', () => {
  it('produces an identical event list regardless of tick granularity (speed 60 vs speed 600)', () => {
    // At speed 60: a 250ms real tick advances sim-time by 250*60 = 15,000ms.
    // At speed 600: a 250ms real tick advances sim-time by 250*600 = 150,000ms.
    const eventsAtSpeed60 = runWithStep(15_000);
    const eventsAtSpeed600 = runWithStep(150_000);
    expect(JSON.stringify(eventsAtSpeed60)).toEqual(JSON.stringify(eventsAtSpeed600));
    expect(eventsAtSpeed60.length).toBeGreaterThan(0);
  });

  it('also matches a single one-shot advance to the same horizon', () => {
    const ctx: MachineCtx = {
      calib: PROFILES.typical,
      products,
      shifts,
      rng: makeRng(seedFor(42, 'L2-M1')),
    };
    const rt = createMachineRuntime({ id: 'L2-M1', lineId: 'L2', productId: 'CYC-A' }, ctx, DAY_START);
    const events: unknown[] = [];
    advance(rt, DAY_START + FOUR_HOURS_MS, ctx, (e) => events.push(e));
    const stepped = runWithStep(15_000);
    expect(JSON.stringify(events)).toEqual(JSON.stringify(stepped));
  });
});
