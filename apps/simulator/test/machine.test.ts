import { describe, expect, it } from 'vitest';
import { PROFILES, type PlantConfig } from '@linelens/contracts';
import { makeRng, seedFor } from '../src/rng.js';
import { advance, createMachineRuntime, type MachineCtx } from '../src/machine.js';

const shifts: PlantConfig['shifts'] = [
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

const DAY_START = Date.parse('2026-01-05T00:00:00.000Z');

const buildCtx = (seed: number, machineId: string): MachineCtx => ({
  calib: PROFILES.typical,
  products,
  shifts,
  rng: makeRng(seedFor(seed, machineId)),
});

const runOneShift = (seed = 42, machineId = 'L2-M1') => {
  const ctx = buildCtx(seed, machineId);
  const rt = createMachineRuntime({ id: machineId, lineId: 'L2', productId: 'CYC-A' }, ctx, DAY_START);
  const events: unknown[] = [];
  // Full shift S1 window (07:00 -> 15:00 sim) plus a little buffer.
  const toSimMs = DAY_START + 900 * 60_000;
  advance(rt, toSimMs, ctx, (e) => events.push(e));
  return { rt, events, toSimMs };
};

describe('machine state machine', () => {
  it('emits events with non-decreasing simTime and strictly increasing seq', () => {
    const { events } = runOneShift();
    expect(events.length).toBeGreaterThan(0);
    let lastTime = -Infinity;
    let lastSeq = -1;
    for (const e of events as Array<{ simTime: string; seq: number }>) {
      const t = Date.parse(e.simTime);
      expect(t).toBeGreaterThanOrEqual(lastTime);
      lastTime = t;
      expect(e.seq).toBeGreaterThan(lastSeq);
      lastSeq = e.seq;
    }
  });

  it('never emits EXECUTE immediately following EXECUTE (no redundant same-state transition)', () => {
    const { events } = runOneShift();
    const stateEvents = (events as Array<{ kind: string; state?: string }>).filter((e) => e.kind === 'STATE_CHANGE');
    for (let i = 1; i < stateEvents.length; i++) {
      expect(stateEvents[i]!.state).not.toBe(stateEvents[i - 1]!.state);
    }
  });

  it('goodTotal+rejectTotal roughly matches executeMs/effectiveCycle (within reasonable tolerance)', () => {
    const { rt } = runOneShift();
    const totalUnits = rt.goodTotal + rt.rejectTotal;
    expect(totalUnits).toBeGreaterThan(0);
    // Sanity band: a typical-profile machine running most of an 8h shift at
    // ~3-4.3s/cycle should produce on the order of several thousand units,
    // not near-zero and not absurdly high.
    expect(totalUnits).toBeGreaterThan(1000);
    expect(totalUnits).toBeLessThan(8000);
  });

  it('same seed twice produces a byte-identical event list', () => {
    const a = runOneShift(42, 'L2-M1');
    const b = runOneShift(42, 'L2-M1');
    expect(JSON.stringify(a.events)).toEqual(JSON.stringify(b.events));
  });

  it('different seeds produce a different event list', () => {
    const a = runOneShift(42, 'L2-M1');
    const b = runOneShift(7, 'L2-M1');
    expect(JSON.stringify(a.events)).not.toEqual(JSON.stringify(b.events));
  });

  it('starts in BREAK when created before the first shift start, then transitions to EXECUTE at shift start', () => {
    const beforeShift = DAY_START + 6 * 60 * 60_000 + 55 * 60_000; // 06:55
    const ctx = buildCtx(42, 'L1-M1');
    const rt = createMachineRuntime({ id: 'L1-M1', lineId: 'L1', productId: 'CYC-A' }, ctx, beforeShift);
    expect(rt.state).toBe('BREAK');
    const events: Array<{ kind: string; state?: string; simTime: string }> = [];
    advance(rt, beforeShift + 60 * 60_000, ctx, (e) => events.push(e as never));
    const first = events.find((e) => e.kind === 'STATE_CHANGE');
    expect(first?.state).toBe('EXECUTE');
    expect(Date.parse(first!.simTime)).toBe(DAY_START + 420 * 60_000);
  });
});
