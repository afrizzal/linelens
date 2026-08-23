import type { Logger } from 'pino';
import type { ShiftDef } from '@linelens/contracts';
import {
  emitChangeoverLoss,
  emitMicrostopLoss,
  emitRejectLoss,
  emitUnplannedStopLoss,
  finalizeElapsedShifts,
} from './losses.js';
import type { DerivationStore } from './store.js';
import type { DerivedEvent } from './types.js';

/**
 * Interval derivation — close-on-next-event (02-02-PLAN.md Task 2).
 * `processMachineBatch` is the pure, testable core: given a store and an
 * ALREADY-ORDERED-BY-SEQ batch of events for ONE machine, it derives
 * state_interval transitions and dispatches to losses.ts for every rule.
 *
 * NO Date.now()/new Date() ANYWHERE in this file — every window/duration is
 * computed from `event.simTime` (a Date object handed in by the caller).
 * Enforced by the static check in test/no-date-now.test.ts.
 */

/** Finding 2 hardening: skip-and-log any event whose machine has no master-data row, rather than throw or invent a default (machine_event has no FK by design). */
export const processMachineBatch = async (
  store: DerivationStore,
  logger: Pick<Logger, 'warn'>,
  machineId: string,
  events: DerivedEvent[],
): Promise<void> => {
  if (events.length === 0) return;

  const machine = await store.getMachine(machineId);
  if (!machine) {
    logger.warn({ machineId, eventCount: events.length }, 'derive: skipping events for unknown machine (no master-data row)');
    const last = events[events.length - 1]!;
    await store.setCursor(machineId, last.id, last.seq);
    return;
  }

  const shifts: ShiftDef[] = await store.getShifts();
  const priorSimMs = await store.getLastProcessedSimMs(machineId);

  for (const event of events) {
    switch (event.kind) {
      case 'STATE_CHANGE':
        await handleStateChange(store, shifts, machineId, event);
        break;
      case 'COUNTS':
        await handleCounts(store, shifts, machineId, event);
        break;
      case 'ALARM':
        await handleAlarm(store, shifts, machineId, event);
        break;
    }
    await store.setLastProcessedSimMs(machineId, event.simTime.getTime());
  }

  // Refresh machine (currentProductId may have changed via rule 3b during this batch).
  const refreshedMachine = (await store.getMachine(machineId)) ?? machine;
  await finalizeElapsedShifts(
    store,
    shifts,
    refreshedMachine,
    priorSimMs,
    events.map((e) => e.simTime.getTime()),
  );

  const last = events[events.length - 1]!;
  await store.setCursor(machineId, last.id, last.seq);
};

const handleStateChange = async (
  store: DerivationStore,
  shifts: ShiftDef[],
  machineId: string,
  event: DerivedEvent,
): Promise<void> => {
  const newState = event.state ?? 'EXECUTE';
  const open = await store.getOpenInterval(machineId);

  // Idempotent replay safety guard: consecutive STATE_CHANGE events with an
  // unchanged state are a no-op (no close, no open, no loss).
  if (open && open.state === newState) return;

  if (open) {
    await store.closeInterval(machineId, event.simTime);
    const closed = { ...open, endTime: event.simTime };
    const machine = await store.getMachine(machineId);
    if (closed.state === 'DOWN') {
      await emitUnplannedStopLoss(store, shifts, closed);
    } else if (closed.state === 'CHANGEOVER' && machine) {
      await emitChangeoverLoss(store, shifts, machine, closed);
    }
  }

  await store.openInterval({
    machineId,
    lineId: event.lineId,
    state: newState,
    startTime: event.simTime,
    reasonCode: event.reasonCode ?? null,
    injected: event.meta?.injected ?? false,
    sourceEventId: event.id,
  });
};

const handleCounts = async (
  store: DerivationStore,
  shifts: ShiftDef[],
  machineId: string,
  event: DerivedEvent,
): Promise<void> => {
  const idealCycleTimeSec = event.idealCycleTimeSec ?? 0;
  const goodDelta = event.goodDelta ?? 0;
  const rejectDelta = event.rejectDelta ?? 0;

  // Rule 3b: product freshness — update Machine.currentProductId in the
  // same scan when a changeover has rotated the product being run.
  if (event.productId) {
    const machine = await store.getMachine(machineId);
    if (machine && machine.currentProductId !== event.productId) {
      await store.setCurrentProduct(machineId, event.productId);
    }
  }

  // Rule 4 input: log this COUNTS event's numbers (no-op on PrismaStore —
  // the raw row is already in machine_event; MemoryStore needs it logged).
  await store.recordCounts(machineId, {
    simTimeMs: event.simTime.getTime(),
    goodDelta,
    rejectDelta,
    idealCycleTimeSec,
  });

  // Rule 5: rejects.
  if (rejectDelta > 0) {
    await emitRejectLoss(store, shifts, {
      machineId,
      lineId: event.lineId,
      rejectReason: event.rejectReason ?? 'UNKNOWN',
      rejectDelta,
      idealCycleTimeSec,
      simTime: event.simTime,
      sourceEventId: event.id,
    });
  }

  // 04-01-PLAN.md Task 2: INLINE HOOK, not a second scan — FIFO-allocate
  // good production to open orders for this COUNTS event's product, in the
  // SAME transaction/batch this call is already part of (no second cursor).
  if (goodDelta > 0 && event.productId) {
    await store.allocateGoodProduction({
      productId: event.productId,
      lineId: event.lineId,
      machineId,
      goodDelta,
      simTime: event.simTime,
      sourceEventId: event.id,
    });
  }
};

const handleAlarm = async (
  store: DerivationStore,
  shifts: ShiftDef[],
  machineId: string,
  event: DerivedEvent,
): Promise<void> => {
  await emitMicrostopLoss(store, shifts, {
    machineId,
    lineId: event.lineId,
    reasonCode: event.reasonCode ?? 'UNKNOWN',
    simTime: event.simTime,
    durationSec: event.durationSec ?? 0,
    sourceEventId: event.id,
  });
};
