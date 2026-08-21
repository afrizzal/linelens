import { breaksWithin, plannedProductionTimeMs, shiftInstanceAt, type ShiftDef, type ShiftInstance } from '@linelens/contracts';
import type { DerivationStore } from './store.js';
import type { IntervalRow, LossEventInput, MachineMaster } from './types.js';

/**
 * The Six Big Losses ledger emission rules (02-02-PLAN.md Task 3) — EXACT
 * RULES, verified against docs/00-domain-research.md §2-3. Do not
 * improvise: small stops are Performance (never Availability), changeover
 * stays inside Planned Production Time, ICT is per-event (never a global
 * constant).
 *
 * Every function here is a pure orchestration over `DerivationStore` — no
 * `Date.now()`/`new Date()` (all windows derive from event.simTime, already
 * a `Date` object handed in by the caller). This file, together with
 * intervals.ts, is covered by the static no-wall-clock-leak check in
 * no-date-now.test.ts.
 */

const tagShift = (shifts: ShiftDef[], ms: number): { shiftDate: string | null; shiftId: string | null } => {
  const inst = shiftInstanceAt(ms, shifts);
  return { shiftDate: inst?.date ?? null, shiftId: inst?.shiftId ?? null };
};

/** Rule 1: a closed DOWN interval -> one AVAILABILITY/UNPLANNED_STOPS loss_event spanning the full interval. */
export const emitUnplannedStopLoss = async (
  store: DerivationStore,
  shifts: ShiftDef[],
  closed: IntervalRow,
): Promise<void> => {
  const endTime = closed.endTime;
  if (!endTime) return; // defensive — callers only invoke this on a just-closed interval
  const lostTimeSec = (endTime.getTime() - closed.startTime.getTime()) / 1000;
  const row: LossEventInput = {
    machineId: closed.machineId,
    lineId: closed.lineId,
    factor: 'AVAILABILITY',
    category: 'UNPLANNED_STOPS',
    reasonCode: closed.reasonCode ?? 'UNKNOWN',
    windowStart: closed.startTime,
    windowEnd: endTime,
    lostTimeSec,
    lostUnits: 0,
    injected: closed.injected,
    sourceEventId: 0n,
    ...tagShift(shifts, closed.startTime.getTime()),
  };
  await store.upsertLossEvent(row);
};

/**
 * Rule 2: a closed CHANGEOVER interval -> planned/unplanned split per
 * EngineConfig.changeoverAsPlanned (ENG-04, docs §2 verified best practice
 * — planned->unplanned transition on overage). Changeover time ALWAYS
 * reduces Run Time; it stays inside Planned Production Time either way.
 */
export const emitChangeoverLoss = async (
  store: DerivationStore,
  shifts: ShiftDef[],
  machine: MachineMaster,
  closed: IntervalRow,
): Promise<void> => {
  const endTime = closed.endTime;
  if (!endTime) return;
  const targetSec = machine.changeoverTargetMin * 60;
  const durSec = (endTime.getTime() - closed.startTime.getTime()) / 1000;
  const { changeoverAsPlanned } = await store.getEngineConfig();
  const reasonCode = closed.reasonCode ?? 'CO-PRODUCT';

  if (!changeoverAsPlanned) {
    await store.upsertLossEvent({
      machineId: closed.machineId,
      lineId: closed.lineId,
      factor: 'AVAILABILITY',
      category: 'PLANNED_STOPS',
      reasonCode,
      windowStart: closed.startTime,
      windowEnd: endTime,
      lostTimeSec: durSec,
      lostUnits: 0,
      injected: closed.injected,
      sourceEventId: 0n,
      ...tagShift(shifts, closed.startTime.getTime()),
    });
    return;
  }

  const plannedSec = Math.min(durSec, targetSec);
  await store.upsertLossEvent({
    machineId: closed.machineId,
    lineId: closed.lineId,
    factor: 'AVAILABILITY',
    category: 'PLANNED_STOPS',
    reasonCode,
    windowStart: closed.startTime,
    windowEnd: new Date(closed.startTime.getTime() + plannedSec * 1000),
    lostTimeSec: plannedSec,
    lostUnits: 0,
    injected: closed.injected,
    sourceEventId: 0n,
    ...tagShift(shifts, closed.startTime.getTime()),
  });

  const overageSec = Math.max(0, durSec - targetSec);
  if (overageSec > 0) {
    const overageStart = new Date(closed.startTime.getTime() + targetSec * 1000);
    await store.upsertLossEvent({
      machineId: closed.machineId,
      lineId: closed.lineId,
      factor: 'AVAILABILITY',
      category: 'UNPLANNED_STOPS',
      reasonCode: 'CO-OVERAGE',
      windowStart: overageStart,
      windowEnd: endTime,
      lostTimeSec: overageSec,
      lostUnits: 0,
      injected: closed.injected,
      sourceEventId: 0n,
      ...tagShift(shifts, overageStart.getTime()),
    });
  }
};

/** Rule 3: an ALARM MICROSTOP -> one PERFORMANCE/SMALL_STOPS loss_event. The machine STAYS EXECUTE (no interval change). */
export const emitMicrostopLoss = async (
  store: DerivationStore,
  shifts: ShiftDef[],
  params: { machineId: string; lineId: string; reasonCode: string; simTime: Date; durationSec: number; sourceEventId: bigint },
): Promise<void> => {
  const windowEnd = params.simTime;
  const windowStart = new Date(params.simTime.getTime() - params.durationSec * 1000);
  await store.upsertLossEvent({
    machineId: params.machineId,
    lineId: params.lineId,
    factor: 'PERFORMANCE',
    category: 'SMALL_STOPS',
    reasonCode: params.reasonCode,
    windowStart,
    windowEnd,
    lostTimeSec: params.durationSec,
    lostUnits: 0,
    injected: false,
    sourceEventId: params.sourceEventId,
    ...tagShift(shifts, windowStart.getTime()),
  });
};

/** Rule 5: a COUNTS event with rejectDelta>0 -> one QUALITY loss_event (STARTUP_REJECTS or PRODUCTION_REJECTS). Upsert, never accumulate. */
export const emitRejectLoss = async (
  store: DerivationStore,
  shifts: ShiftDef[],
  params: {
    machineId: string;
    lineId: string;
    rejectReason: string;
    rejectDelta: number;
    idealCycleTimeSec: number;
    simTime: Date;
    sourceEventId: bigint;
  },
): Promise<void> => {
  const category = params.rejectReason === 'RJ-STARTUP' ? 'STARTUP_REJECTS' : 'PRODUCTION_REJECTS';
  await store.upsertLossEvent({
    machineId: params.machineId,
    lineId: params.lineId,
    factor: 'QUALITY',
    category,
    reasonCode: params.rejectReason,
    windowStart: params.simTime,
    windowEnd: params.simTime,
    lostTimeSec: params.rejectDelta * params.idealCycleTimeSec,
    lostUnits: params.rejectDelta,
    injected: false,
    sourceEventId: params.sourceEventId,
    ...tagShift(shifts, params.simTime.getTime()),
  });
};

/**
 * Rule 4: residual slow-cycles for one fully-elapsed shift instance.
 * Computed entirely from already-persisted state_interval/machine_event/
 * loss_event rows — never accumulated incrementally in memory (that
 * wouldn't survive a worker restart and would break replay-idempotency).
 * Upserts exactly ONE loss_event per (machine, shift) — sourceEventId=0.
 *
 * runTimeSec = PPT - Sigma(DOWN) - Sigma(CHANGEOVER), each interval clamped to the
 *   shift window AND with any break-window overlap excluded (breaks are
 *   already outside PPT; counting them inside a DOWN/CHANGEOVER interval
 *   would double-subtract — PITFALLS.md "PPT vs calendar" class of bug).
 * pLossTotalSec = max(0, runTimeSec - Sigma(idealCycleTimeSec * (goodDelta+rejectDelta)))
 * slowCyclesSec = max(0, pLossTotalSec - Sigma smallStopsSec-in-window)
 */
export const finalizeShiftSlowCycles = async (
  store: DerivationStore,
  shifts: ShiftDef[],
  machine: MachineMaster,
  shiftInst: ShiftInstance,
): Promise<void> => {
  const pptMs = plannedProductionTimeMs(shiftInst, shifts);
  const breaks = breaksWithin(shiftInst, shifts);

  const overlapping = await store.listIntervalsOverlapping(machine.id, shiftInst.startMs, shiftInst.endMs);
  let downChangeoverMs = 0;
  for (const iv of overlapping) {
    if (iv.state !== 'DOWN' && iv.state !== 'CHANGEOVER') continue;
    const ivStartMs = Math.max(iv.startTime.getTime(), shiftInst.startMs);
    const ivEndMs = Math.min(iv.endTime ? iv.endTime.getTime() : shiftInst.endMs, shiftInst.endMs);
    if (ivEndMs <= ivStartMs) continue;
    let dur = ivEndMs - ivStartMs;
    for (const brk of breaks) {
      const overlapStart = Math.max(brk.startMs, ivStartMs);
      const overlapEnd = Math.min(brk.endMs, ivEndMs);
      if (overlapEnd > overlapStart) dur -= overlapEnd - overlapStart;
    }
    downChangeoverMs += Math.max(0, dur);
  }

  const runTimeSec = Math.max(0, pptMs - downChangeoverMs) / 1000;

  const counts = await store.listCountsInWindow(machine.id, shiftInst.startMs, shiftInst.endMs);
  const ictTimeSec = counts.reduce((sum, c) => sum + c.idealCycleTimeSec * (c.goodDelta + c.rejectDelta), 0);

  const pLossTotalSec = Math.max(0, runTimeSec - ictTimeSec);

  const smallStops = await store.listSmallStopsInWindow(machine.id, shiftInst.startMs, shiftInst.endMs);
  const smallStopsSec = smallStops.reduce((sum, r) => sum + r.lostTimeSec, 0);

  const slowCyclesSec = Math.max(0, pLossTotalSec - smallStopsSec);

  await store.upsertLossEvent({
    machineId: machine.id,
    lineId: machine.lineId,
    factor: 'PERFORMANCE',
    category: 'SLOW_CYCLES',
    reasonCode: 'SL-SPEED',
    windowStart: new Date(shiftInst.startMs),
    windowEnd: new Date(shiftInst.endMs),
    lostTimeSec: slowCyclesSec,
    lostUnits: 0,
    injected: false,
    sourceEventId: 0n,
    shiftDate: shiftInst.date,
    shiftId: shiftInst.shiftId,
  });
};

/**
 * Detect shift-instance transitions across a machine's ordered event batch
 * (including the boundary with the PRIOR batch, via `priorSimMs`) and
 * finalize (rule 4) every shift instance that has now fully elapsed.
 * Returns the shift-instance key of the last event processed (or the prior
 * one, if the batch was empty) so the caller can persist nothing extra —
 * PrismaStore recomputes this fresh next batch from cursor+machine_event.
 */
export const finalizeElapsedShifts = async (
  store: DerivationStore,
  shifts: ShiftDef[],
  machine: MachineMaster,
  priorSimMs: number | undefined,
  orderedSimMsInBatch: number[],
): Promise<void> => {
  let priorInst = priorSimMs !== undefined ? shiftInstanceAt(priorSimMs, shifts) : undefined;
  let priorKey = priorSimMs !== undefined ? (priorInst ? `${priorInst.date}:${priorInst.shiftId}` : null) : undefined;

  for (const simMs of orderedSimMsInBatch) {
    const inst = shiftInstanceAt(simMs, shifts);
    const key = inst ? `${inst.date}:${inst.shiftId}` : null;
    if (priorKey !== undefined && key !== priorKey && priorInst) {
      await finalizeShiftSlowCycles(store, shifts, machine, priorInst);
    }
    priorInst = inst;
    priorKey = key;
  }
};
