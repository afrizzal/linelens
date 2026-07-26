import { describe, expect, it } from 'vitest';
import { PROFILES, type CalibrationProfile, type ShiftDef } from '@linelens/contracts';
import { makeRng, seedFor } from '../src/rng.js';
import { advance, createMachineRuntime, type MachineCtx } from '../src/machine.js';

/**
 * Calibration acceptance test (SIM-06): run 3 full sim-days per profile
 * (pure, no MQTT) and compute a SIMPLIFIED reference OEE inline (A from
 * state durations vs a PPT approximation, P from ideal-time/RunTime, Q from
 * good/total). This is a simplified reference implementation for band
 * calibration only — the real engine lands in Phase 2 (02-02).
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

const DAY_START = Date.parse('2026-01-05T00:00:00.000Z');
const THREE_DAYS_MS = 3 * 24 * 60 * 60_000;

interface StateEvt {
  kind: string;
  state?: string;
  simTime: string;
}
interface CountsEvt {
  kind: string;
  simTime: string;
  goodDelta: number;
  rejectDelta: number;
  idealCycleTimeSec: number;
}

const runProfile = (profile: CalibrationProfile, machineId: string) => {
  const ctx: MachineCtx = {
    calib: PROFILES[profile],
    products,
    shifts,
    rng: makeRng(seedFor(42, machineId)),
  };
  const rt = createMachineRuntime({ id: machineId, lineId: 'L-TEST', productId: 'CYC-A' }, ctx, DAY_START);
  const events: Array<StateEvt | CountsEvt> = [];
  const horizon = DAY_START + THREE_DAYS_MS;
  advance(rt, horizon, ctx, (e) => events.push(e as never));
  return { events, horizon };
};

/** Reconstruct per-state duration (ms) between consecutive STATE_CHANGE events, clipped to [from, to]. */
const stateDurations = (events: Array<StateEvt | CountsEvt>, from: number, to: number): Record<string, number> => {
  const stateEvents = (events.filter((e) => e.kind === 'STATE_CHANGE') as StateEvt[]).sort(
    (a, b) => Date.parse(a.simTime) - Date.parse(b.simTime),
  );
  const durations: Record<string, number> = { EXECUTE: 0, DOWN: 0, CHANGEOVER: 0, BREAK: 0 };
  for (let i = 0; i < stateEvents.length; i++) {
    const cur = stateEvents[i]!;
    const start = Math.max(Date.parse(cur.simTime), from);
    const endRaw = i + 1 < stateEvents.length ? Date.parse(stateEvents[i + 1]!.simTime) : to;
    const end = Math.min(endRaw, to);
    if (end > start) durations[cur.state!] = (durations[cur.state!] ?? 0) + (end - start);
  }
  return durations;
};

const computeOee = (events: Array<StateEvt | CountsEvt>, from: number, to: number): number => {
  const durations = stateDurations(events, from, to);
  const executeMs = durations.EXECUTE ?? 0;
  const downMs = durations.DOWN ?? 0;
  const changeoverMs = durations.CHANGEOVER ?? 0;
  const ppt = executeMs + downMs + changeoverMs; // approx PPT: everything except BREAK/no-shift
  if (ppt === 0) return 0;
  const availability = executeMs / ppt;

  const counts = events.filter((e) => e.kind === 'COUNTS' && Date.parse(e.simTime) >= from && Date.parse(e.simTime) <= to) as CountsEvt[];
  let good = 0;
  let reject = 0;
  let idealMs = 0;
  for (const c of counts) {
    good += c.goodDelta;
    reject += c.rejectDelta;
    idealMs += (c.goodDelta + c.rejectDelta) * c.idealCycleTimeSec * 1000;
  }
  const total = good + reject;
  if (total === 0 || executeMs === 0) return 0;
  const performance = Math.min(idealMs / executeMs, 1); // guard, matches the engine's P<=100% rule intent
  const quality = good / total;
  return availability * performance * quality * 100;
};

const stddev = (xs: number[]): number => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
};

/** Absolute shift window start/end (ms) for a given sim-day offset (0-indexed). */
const shiftWindow = (dayOffset: number, shift: ShiftDef): [number, number] => {
  const midnight = DAY_START + dayOffset * 24 * 60 * 60_000;
  return [midnight + shift.startMin * 60_000, midnight + shift.endMin * 60_000];
};

describe('calibration acceptance', () => {
  it('showcase profile lands in the verified 78-92% OEE band', () => {
    const { events, horizon } = runProfile('showcase', 'CAL-SHOWCASE');
    const oee = computeOee(events, DAY_START, horizon);
    expect(oee).toBeGreaterThanOrEqual(78);
    expect(oee).toBeLessThanOrEqual(92);
  });

  it('typical profile lands in the verified 48-67% OEE band', () => {
    const { events, horizon } = runProfile('typical', 'CAL-TYPICAL');
    const oee = computeOee(events, DAY_START, horizon);
    expect(oee).toBeGreaterThanOrEqual(48);
    expect(oee).toBeLessThanOrEqual(67);
  });

  it('problem profile lands in the verified 28-44% OEE band (hard ceiling <45%)', () => {
    const { events, horizon } = runProfile('problem', 'CAL-PROBLEM');
    const oee = computeOee(events, DAY_START, horizon);
    expect(oee).toBeGreaterThanOrEqual(28);
    expect(oee).toBeLessThan(45);
  });

  it('shows per-shift jitter (stddev > 1.5 pts) rather than a too-perfect flatline', () => {
    const { events } = runProfile('typical', 'CAL-TYPICAL-JITTER');
    const perShiftOee: number[] = [];
    for (let day = 0; day < 3; day++) {
      for (const shift of shifts) {
        const [from, to] = shiftWindow(day, shift);
        perShiftOee.push(computeOee(events, from, to));
      }
    }
    expect(stddev(perShiftOee)).toBeGreaterThan(1.5);
  });
});
