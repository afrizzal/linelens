import type { CalibrationParams, ShiftDef, TelemetryEvent } from '@linelens/contracts';
import { breaksWithin, shiftInstanceAt } from '@linelens/contracts';
import type { Rng } from './rng.js';

/**
 * Per-machine hand-rolled discriminated-union state machine (STACK.md: no
 * XState). The entire life of a machine is computed in SIM-TIME: this
 * module never reads Date.now()/new Date() — the caller (plant.ts / main.ts)
 * is the only place wall-clock feeds into `toSimMs`.
 *
 * Every emitted event's `simTime` is the sim instant it logically happened,
 * not "simNow at tick" — this is what makes the output speed-invariant
 * (same seed at speed 60 and 600 -> identical event sequence).
 */

export interface SimProduct {
  id: string;
  name: string;
  idealCycleTimeSec: number;
}

export interface MachineDef {
  id: string;
  lineId: string;
  productId: string;
}

export interface MachineRuntime {
  machineId: string;
  lineId: string;
  state: 'EXECUTE' | 'DOWN' | 'CHANGEOVER' | 'BREAK';
  stateSince: number;
  /** Internal sim-ms cursor — may advance within EXECUTE without stateSince changing (a state doesn't "restart" on cycle completion). */
  cursor: number;
  seq: number;
  goodTotal: number;
  rejectTotal: number;
  lastRecoveryAt: number | null;

  productIndex: number;
  productId: string;

  /** Execute-time-domain countdown budgets (only decrement while state === EXECUTE). */
  remainingToFailureMs: number;
  remainingToChangeoverMs: number;
  remainingToMicrostopMs: number;

  cycleProgressMs: number;
  effectiveCycleMs: number;

  downUntil: number | null;
  changeoverUntil: number | null;
  changeoverDeferred: boolean;

  batchElapsedMs: number;
  batchGoodAccum: number;
  batchRejectAccum: number;
  batchLastRejectReason: string | null;
}

export interface MachineCtx {
  calib: CalibrationParams;
  products: readonly SimProduct[];
  shifts: ShiftDef[];
  rng: Rng;
}

const MS_PER_MIN = 60_000;
const BATCH_MS = 5_000;
const DAY_MS = 24 * 60 * MS_PER_MIN;

const iso = (ms: number): string => new Date(ms).toISOString();

/** Weighted pick from `[value, weight][]` pairs using a single rng draw. */
const pickWeighted = <T>(rng: Rng, options: Array<[T, number]>): T => {
  const total = options.reduce((s, [, w]) => s + w, 0);
  let x = rng.next() * total;
  for (const [value, weight] of options) {
    if (x < weight) return value;
    x -= weight;
  }
  return options[options.length - 1]![0];
};

const drawFailureBudget = (calib: CalibrationParams, rng: Rng): number =>
  rng.exponential(calib.mtbfMin * MS_PER_MIN);

const drawMicrostopBudget = (calib: CalibrationParams, rng: Rng): number =>
  calib.microstopsPerHour > 0
    ? rng.exponential((3600 / calib.microstopsPerHour) * 1000)
    : Number.POSITIVE_INFINITY;

const drawChangeoverBudget = (calib: CalibrationParams): number => calib.changeoverEveryMin * MS_PER_MIN;

const drawEffectiveCycleMs = (idealCycleTimeSec: number, calib: CalibrationParams, rng: Rng): number =>
  idealCycleTimeSec * 1000 * calib.slowCycleFactor * rng.uniform(0.97, 1.06);

/** Is `simMs` inside an EXECUTE-eligible calendar window (inside a shift, not inside a break)? */
const isExecuteAllowed = (simMs: number, shifts: ShiftDef[]): boolean => {
  const inst = shiftInstanceAt(simMs, shifts);
  if (!inst) return false;
  const breaks = breaksWithin(inst, shifts);
  return !breaks.some((b) => simMs >= b.startMs && simMs < b.endMs);
};

const nextShiftStartAfter = (simMs: number, shifts: ShiftDef[]): number => {
  const midnight = Math.floor(simMs / DAY_MS) * DAY_MS;
  const minuteOfDay = (simMs - midnight) / MS_PER_MIN;
  const startsAheadToday = shifts
    .map((s) => s.startMin)
    .filter((m) => m > minuteOfDay)
    .sort((a, b) => a - b);
  if (startsAheadToday.length > 0) return midnight + startsAheadToday[0]! * MS_PER_MIN;
  const startsTomorrow = shifts.map((s) => s.startMin).sort((a, b) => a - b);
  return midnight + DAY_MS + startsTomorrow[0]! * MS_PER_MIN;
};

/** Next sim-ms at which the calendar's EXECUTE-allowed/disallowed status could change. */
const nextCalendarBoundary = (simMs: number, shifts: ShiftDef[]): number => {
  const inst = shiftInstanceAt(simMs, shifts);
  if (!inst) return nextShiftStartAfter(simMs, shifts);
  const breaks = breaksWithin(inst, shifts).sort((a, b) => a.startMs - b.startMs);
  for (const b of breaks) {
    if (simMs < b.startMs) return b.startMs;
    if (simMs >= b.startMs && simMs < b.endMs) return b.endMs;
  }
  return inst.endMs;
};

const currentProduct = (rt: MachineRuntime, ctx: MachineCtx): SimProduct => ctx.products[rt.productIndex]!;

export const createMachineRuntime = (def: MachineDef, ctx: MachineCtx, startSimMs: number): MachineRuntime => {
  const productIndex = Math.max(0, ctx.products.findIndex((p) => p.id === def.productId));
  const product = ctx.products[productIndex]!;
  const startsExecuting = isExecuteAllowed(startSimMs, ctx.shifts);
  return {
    machineId: def.id,
    lineId: def.lineId,
    state: startsExecuting ? 'EXECUTE' : 'BREAK',
    stateSince: startSimMs,
    cursor: startSimMs,
    seq: 0,
    goodTotal: 0,
    rejectTotal: 0,
    lastRecoveryAt: startSimMs,
    productIndex,
    productId: product.id,
    remainingToFailureMs: drawFailureBudget(ctx.calib, ctx.rng),
    remainingToChangeoverMs: drawChangeoverBudget(ctx.calib),
    remainingToMicrostopMs: drawMicrostopBudget(ctx.calib, ctx.rng),
    cycleProgressMs: 0,
    effectiveCycleMs: drawEffectiveCycleMs(product.idealCycleTimeSec, ctx.calib, ctx.rng),
    downUntil: null,
    changeoverUntil: null,
    changeoverDeferred: false,
    batchElapsedMs: 0,
    batchGoodAccum: 0,
    batchRejectAccum: 0,
    batchLastRejectReason: null,
  };
};

const emitStateChange = (
  rt: MachineRuntime,
  simMs: number,
  state: MachineRuntime['state'],
  reasonCode: string | null,
  emit: (e: TelemetryEvent) => void,
  injected?: boolean,
): void => {
  rt.state = state;
  rt.stateSince = simMs;
  emit({
    v: 1,
    machineId: rt.machineId,
    lineId: rt.lineId,
    simTime: iso(simMs),
    seq: rt.seq++,
    kind: 'STATE_CHANGE',
    state,
    reasonCode,
    ...(injected !== undefined ? { meta: { injected } } : {}),
  });
};

const flushCountBatch = (rt: MachineRuntime, simMs: number, ctx: MachineCtx, emit: (e: TelemetryEvent) => void): void => {
  if (rt.batchGoodAccum === 0 && rt.batchRejectAccum === 0) return;
  emit({
    v: 1,
    machineId: rt.machineId,
    lineId: rt.lineId,
    simTime: iso(simMs),
    seq: rt.seq++,
    kind: 'COUNTS',
    goodDelta: rt.batchGoodAccum,
    rejectDelta: rt.batchRejectAccum,
    rejectReason: rt.batchRejectAccum > 0 ? rt.batchLastRejectReason : null,
    idealCycleTimeSec: currentProduct(rt, ctx).idealCycleTimeSec,
    productId: rt.productId,
  });
  rt.batchGoodAccum = 0;
  rt.batchRejectAccum = 0;
  rt.batchLastRejectReason = null;
};

const resetRunBudgets = (rt: MachineRuntime, ctx: MachineCtx, atSimMs: number): void => {
  rt.lastRecoveryAt = atSimMs;
  rt.remainingToMicrostopMs = drawMicrostopBudget(ctx.calib, ctx.rng);
  rt.cycleProgressMs = 0;
  rt.effectiveCycleMs = drawEffectiveCycleMs(currentProduct(rt, ctx).idealCycleTimeSec, ctx.calib, ctx.rng);
};

/** Advance one machine's internal state up to (and including) `toSimMs`, emitting contract events along the way. */
export const advance = (rt: MachineRuntime, toSimMs: number, ctx: MachineCtx, emit: (e: TelemetryEvent) => void): void => {
  while (rt.cursor < toSimMs) {
    if (rt.state === 'DOWN') {
      const target = Math.min(rt.downUntil ?? toSimMs, toSimMs);
      rt.cursor = target;
      if (rt.downUntil !== null && rt.cursor === rt.downUntil) {
        rt.downUntil = null;
        rt.remainingToFailureMs = drawFailureBudget(ctx.calib, ctx.rng);
        resetRunBudgets(rt, ctx, rt.cursor);
        const allowed = isExecuteAllowed(rt.cursor, ctx.shifts);
        emitStateChange(rt, rt.cursor, allowed ? 'EXECUTE' : 'BREAK', null, emit);
      }
      continue;
    }

    if (rt.state === 'BREAK') {
      const boundary = nextCalendarBoundary(rt.cursor, ctx.shifts);
      rt.cursor = Math.min(boundary, toSimMs);
      if (rt.cursor === boundary && isExecuteAllowed(boundary, ctx.shifts)) {
        if (rt.changeoverDeferred) {
          rt.changeoverDeferred = false;
          const dur = ctx.calib.changeoverDurMin * MS_PER_MIN * ctx.rng.triangular(0.8, 1.0, 1.4);
          rt.productIndex = (rt.productIndex + 1) % ctx.products.length;
          rt.productId = ctx.products[rt.productIndex]!.id;
          rt.changeoverUntil = rt.cursor + dur;
          emitStateChange(rt, rt.cursor, 'CHANGEOVER', 'CO-PRODUCT', emit);
        } else {
          emitStateChange(rt, rt.cursor, 'EXECUTE', null, emit);
        }
      }
      continue;
    }

    if (rt.state === 'CHANGEOVER') {
      const boundary = nextCalendarBoundary(rt.cursor, ctx.shifts);
      const changeoverEnd = rt.changeoverUntil ?? toSimMs;
      rt.cursor = Math.min(boundary, changeoverEnd, toSimMs);
      if (rt.cursor === changeoverEnd && changeoverEnd <= boundary) {
        rt.changeoverUntil = null;
        rt.remainingToChangeoverMs = drawChangeoverBudget(ctx.calib);
        resetRunBudgets(rt, ctx, rt.cursor);
        emitStateChange(rt, rt.cursor, 'EXECUTE', null, emit);
      } else if (rt.cursor === boundary && boundary < changeoverEnd) {
        // Guard: an in-progress changeover reaching a break boundary is
        // truncated at break start and treated as complete.
        rt.changeoverUntil = null;
        rt.remainingToChangeoverMs = drawChangeoverBudget(ctx.calib);
        resetRunBudgets(rt, ctx, rt.cursor);
        emitStateChange(rt, rt.cursor, 'BREAK', null, emit);
      }
      continue;
    }

    // EXECUTE
    const boundary = nextCalendarBoundary(rt.cursor, ctx.shifts);
    const batchRemaining = BATCH_MS - rt.batchElapsedMs;
    const cycleRemaining = rt.effectiveCycleMs - rt.cycleProgressMs;
    const step = Math.max(
      0,
      Math.min(
        boundary - rt.cursor,
        rt.remainingToFailureMs,
        rt.remainingToChangeoverMs,
        rt.remainingToMicrostopMs,
        cycleRemaining,
        batchRemaining,
        toSimMs - rt.cursor,
      ),
    );

    rt.cursor += step;
    rt.remainingToFailureMs -= step;
    rt.remainingToChangeoverMs -= step;
    rt.remainingToMicrostopMs -= step;
    rt.cycleProgressMs += step;
    rt.batchElapsedMs += step;

    // Resolve exactly what happened at rt.cursor, in priority order:
    // calendar boundary > failure > changeover > microstop > cycle-complete > batch-flush.
    if (rt.cursor === boundary) {
      flushCountBatch(rt, rt.cursor, ctx, emit);
      rt.batchElapsedMs = 0;
      if (!isExecuteAllowed(boundary, ctx.shifts)) {
        emitStateChange(rt, rt.cursor, 'BREAK', null, emit);
      }
      continue;
    }

    if (rt.remainingToFailureMs <= 0) {
      flushCountBatch(rt, rt.cursor, ctx, emit);
      rt.batchElapsedMs = 0;
      const reason = pickWeighted(ctx.rng, [
        ['BRK-MECH', 0.5],
        ['BRK-ELEC', 0.3],
        ['BRK-SENSOR', 0.2],
      ]);
      const repairMs = ctx.calib.mttrMeanMin * MS_PER_MIN * ctx.rng.triangular(0.5, 1.0, 1.8);
      rt.downUntil = rt.cursor + repairMs;
      emitStateChange(rt, rt.cursor, 'DOWN', reason, emit);
      continue;
    }

    if (rt.remainingToChangeoverMs <= 0) {
      const dur = ctx.calib.changeoverDurMin * MS_PER_MIN * ctx.rng.triangular(0.8, 1.0, 1.4);
      const boundaryFromNow = nextCalendarBoundary(rt.cursor, ctx.shifts);
      if (rt.cursor + dur <= boundaryFromNow) {
        flushCountBatch(rt, rt.cursor, ctx, emit);
        rt.batchElapsedMs = 0;
        rt.productIndex = (rt.productIndex + 1) % ctx.products.length;
        rt.productId = ctx.products[rt.productIndex]!.id;
        rt.changeoverUntil = rt.cursor + dur;
        emitStateChange(rt, rt.cursor, 'CHANGEOVER', 'CO-PRODUCT', emit);
      } else {
        // Defer to the first EXECUTE after the break.
        rt.changeoverDeferred = true;
        rt.remainingToChangeoverMs = Number.POSITIVE_INFINITY;
      }
      continue;
    }

    if (rt.remainingToMicrostopMs <= 0) {
      const reason = pickWeighted(ctx.rng, [
        ['SS-MISFEED', 0.4],
        ['SS-MATERIAL', 0.4],
        ['SS-SENSOR', 0.2],
      ]);
      const durationSec = ctx.calib.microstopMeanSec * ctx.rng.triangular(0.4, 1.0, 2.2);
      emit({
        v: 1,
        machineId: rt.machineId,
        lineId: rt.lineId,
        simTime: iso(rt.cursor),
        seq: rt.seq++,
        kind: 'ALARM',
        alarmType: 'MICROSTOP',
        reasonCode: reason,
        durationSec,
      });
      // Production pauses for durationSec; failure/changeover budgets keep
      // ticking (state stays EXECUTE) but cycle progress does not.
      const pauseMs = durationSec * 1000;
      rt.remainingToFailureMs -= pauseMs;
      rt.remainingToChangeoverMs -= pauseMs;
      rt.batchElapsedMs += pauseMs;
      rt.cursor += pauseMs;
      rt.remainingToMicrostopMs = drawMicrostopBudget(ctx.calib, ctx.rng);
      continue;
    }

    if (rt.cycleProgressMs >= rt.effectiveCycleMs) {
      rt.cycleProgressMs -= rt.effectiveCycleMs;
      const startupWindowMs = ctx.calib.startupWindowMin * MS_PER_MIN;
      const inStartup = rt.lastRecoveryAt !== null && rt.cursor - rt.lastRecoveryAt < startupWindowMs;
      const p = inStartup ? ctx.calib.startupRejectRate : ctx.calib.rejectRate;
      const isReject = ctx.rng.next() < p;
      if (isReject) {
        rt.rejectTotal += 1;
        rt.batchRejectAccum += 1;
        rt.batchLastRejectReason = inStartup
          ? 'RJ-STARTUP'
          : pickWeighted(ctx.rng, [
              ['RJ-DIM', 0.7],
              ['RJ-VISUAL', 0.3],
            ]);
      } else {
        rt.goodTotal += 1;
        rt.batchGoodAccum += 1;
      }
      rt.effectiveCycleMs = drawEffectiveCycleMs(currentProduct(rt, ctx).idealCycleTimeSec, ctx.calib, ctx.rng);
      continue;
    }

    if (rt.batchElapsedMs >= BATCH_MS) {
      flushCountBatch(rt, rt.cursor, ctx, emit);
      rt.batchElapsedMs = 0;
      continue;
    }

    // Reached toSimMs with nothing else due — loop condition will exit.
  }
};

/** Force an immediate DOWN transition (demo "inject breakdown" control). Only valid while EXECUTE. */
export const forceBreakdown = (
  rt: MachineRuntime,
  atSimMs: number,
  durationMs: number,
  ctx: MachineCtx,
  emit: (e: TelemetryEvent) => void,
): boolean => {
  if (rt.state !== 'EXECUTE') return false;
  flushCountBatch(rt, atSimMs, ctx, emit);
  rt.batchElapsedMs = 0;
  rt.downUntil = atSimMs + durationMs;
  rt.cursor = atSimMs;
  emitStateChange(rt, atSimMs, 'DOWN', 'BRK-MECH', emit, true);
  return true;
};
