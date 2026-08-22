import { describe, expect, it, vi } from 'vitest';
import type { ShiftDef } from '@linelens/contracts';
import { processMachineBatch } from '../src/derive/intervals.js';
import { MemoryStore } from '../src/derive/store.js';
import type { DerivedEvent } from '../src/derive/types.js';

/**
 * Task 3 <verify>: hand-built fixtures per rule, incl. changeover
 * 15-of-20-min policy split, policy=false single row, microstop 45s,
 * full-shift slow-cycles residual, and replay-idempotency on every fixture.
 * EXACT RULES per 02-02-PLAN.md Task 3 (verified against
 * docs/00-domain-research.md §2-3) — hand-computed expectations below.
 */

const MACHINE_ID = 'M-01';
const LINE_ID = 'L-01';
const MIN = 60_000;
const silentLogger = { warn: vi.fn() };

const stateChange = (id: bigint, seq: number, atMs: number, state: string, reasonCode: string | null = null): DerivedEvent => ({
  id,
  machineId: MACHINE_ID,
  lineId: LINE_ID,
  kind: 'STATE_CHANGE',
  simTime: new Date(atMs),
  seq,
  state,
  reasonCode,
});

const alarm = (id: bigint, seq: number, atMs: number, reasonCode: string, durationSec: number): DerivedEvent => ({
  id,
  machineId: MACHINE_ID,
  lineId: LINE_ID,
  kind: 'ALARM',
  simTime: new Date(atMs),
  seq,
  reasonCode,
  durationSec,
});

const counts = (
  id: bigint,
  seq: number,
  atMs: number,
  params: { goodDelta: number; rejectDelta: number; rejectReason: string | null; idealCycleTimeSec: number; productId: string },
): DerivedEvent => ({
  id,
  machineId: MACHINE_ID,
  lineId: LINE_ID,
  kind: 'COUNTS',
  simTime: new Date(atMs),
  seq,
  ...params,
});

/** Replay-idempotency helper: re-run with only cursor-filtered (i.e. empty) events, assert the ledger is unchanged. */
const assertReplaySafe = async (store: MemoryStore, events: DerivedEvent[]): Promise<void> => {
  const beforeIntervals = store.getAllIntervals();
  const beforeLosses = store.getAllLossEvents();
  const cursor = store.getCursor(MACHINE_ID);
  const replay = events.filter((e) => e.id > (cursor?.lastEventId ?? 0n));
  expect(replay).toHaveLength(0); // sanity: cursor really is past every fixture event
  await processMachineBatch(store, silentLogger, MACHINE_ID, replay);
  expect(store.getAllIntervals()).toEqual(beforeIntervals);
  expect(store.getAllLossEvents()).toEqual(beforeLosses);
};

describe('rule 1 — DOWN interval closes -> UNPLANNED_STOPS', () => {
  it('emits one AVAILABILITY/UNPLANNED_STOPS loss_event spanning the full DOWN duration', async () => {
    const store = new MemoryStore();
    store.seedMachine({ id: MACHINE_ID, lineId: LINE_ID, changeoverTargetMin: 15, currentProductId: null });
    store.seedShifts([{ id: 'S1', name: 'S1', startMin: 0, endMin: 1440, breaks: [] }]);
    const T0 = Date.parse('2026-01-06T00:00:00.000Z');
    const events = [
      stateChange(1n, 0, T0, 'EXECUTE'),
      stateChange(2n, 1, T0 + 5 * MIN, 'DOWN', 'BRK-ELEC'),
      stateChange(3n, 2, T0 + 20 * MIN, 'EXECUTE'),
    ];

    await processMachineBatch(store, silentLogger, MACHINE_ID, events);

    const losses = store.getAllLossEvents();
    const unplanned = losses.filter((l) => l.category === 'UNPLANNED_STOPS');
    expect(unplanned).toHaveLength(1);
    expect(unplanned[0]).toMatchObject({
      factor: 'AVAILABILITY',
      reasonCode: 'BRK-ELEC',
      lostTimeSec: 15 * 60,
      sourceEventId: 0n,
    });

    await assertReplaySafe(store, events);
  });
});

describe('rule 2 — CHANGEOVER interval closes -> planned/unplanned split (ENG-04 policy)', () => {
  const buildEvents = (): DerivedEvent[] => {
    const T0 = Date.parse('2026-01-06T00:00:00.000Z');
    return [
      stateChange(1n, 0, T0, 'EXECUTE'),
      stateChange(2n, 1, T0 + 5 * MIN, 'CHANGEOVER', 'CO-PRODUCT'),
      stateChange(3n, 2, T0 + 25 * MIN, 'EXECUTE'), // 20-minute changeover, target 15
    ];
  };

  it('policy=true (default): 20min changeover vs 15min target -> exactly two rows (15min PLANNED_STOPS + 5min CO-OVERAGE UNPLANNED_STOPS)', async () => {
    const store = new MemoryStore();
    store.seedMachine({ id: MACHINE_ID, lineId: LINE_ID, changeoverTargetMin: 15, currentProductId: null });
    store.seedShifts([{ id: 'S1', name: 'S1', startMin: 0, endMin: 1440, breaks: [] }]);
    const events = buildEvents();

    await processMachineBatch(store, silentLogger, MACHINE_ID, events);

    const losses = store.getAllLossEvents();
    const planned = losses.filter((l) => l.category === 'PLANNED_STOPS');
    const overage = losses.filter((l) => l.category === 'UNPLANNED_STOPS' && l.reasonCode === 'CO-OVERAGE');
    expect(planned).toHaveLength(1);
    expect(overage).toHaveLength(1);
    expect(planned[0]).toMatchObject({ reasonCode: 'CO-PRODUCT', lostTimeSec: 15 * 60, sourceEventId: 0n });
    expect(overage[0]).toMatchObject({ lostTimeSec: 5 * 60, sourceEventId: 0n });
    // Total loss-event rows attributable to this changeover: exactly 2.
    expect(losses.filter((l) => l.category === 'PLANNED_STOPS' || l.category === 'UNPLANNED_STOPS')).toHaveLength(2);

    await assertReplaySafe(store, events);
  });

  it('policy=false: single 20-minute PLANNED_STOPS row, no overage split', async () => {
    const store = new MemoryStore();
    store.seedMachine({ id: MACHINE_ID, lineId: LINE_ID, changeoverTargetMin: 15, currentProductId: null });
    store.seedShifts([{ id: 'S1', name: 'S1', startMin: 0, endMin: 1440, breaks: [] }]);
    store.setEngineConfig({ changeoverAsPlanned: false });
    const events = buildEvents();

    await processMachineBatch(store, silentLogger, MACHINE_ID, events);

    const losses = store.getAllLossEvents().filter((l) => l.category === 'PLANNED_STOPS' || l.category === 'UNPLANNED_STOPS');
    expect(losses).toHaveLength(1);
    expect(losses[0]).toMatchObject({ category: 'PLANNED_STOPS', reasonCode: 'CO-PRODUCT', lostTimeSec: 20 * 60 });

    await assertReplaySafe(store, events);
  });
});

describe('rule 3 — ALARM MICROSTOP -> SMALL_STOPS (Performance, not Availability)', () => {
  it('a 45s microstop alarm emits one PERFORMANCE/SMALL_STOPS row, machine stays EXECUTE (no interval change)', async () => {
    const store = new MemoryStore();
    store.seedMachine({ id: MACHINE_ID, lineId: LINE_ID, changeoverTargetMin: 15, currentProductId: null });
    store.seedShifts([{ id: 'S1', name: 'S1', startMin: 0, endMin: 1440, breaks: [] }]);
    const T0 = Date.parse('2026-01-06T00:00:00.000Z');
    const events = [stateChange(1n, 0, T0, 'EXECUTE'), alarm(2n, 1, T0 + 10 * MIN, 'SS-MISFEED', 45)];

    await processMachineBatch(store, silentLogger, MACHINE_ID, events);

    const smallStops = store.getAllLossEvents().filter((l) => l.category === 'SMALL_STOPS');
    expect(smallStops).toHaveLength(1);
    expect(smallStops[0]).toMatchObject({ factor: 'PERFORMANCE', reasonCode: 'SS-MISFEED', lostTimeSec: 45, sourceEventId: 2n });
    // The machine's interval timeline is untouched by an ALARM — still one open EXECUTE interval.
    expect(store.getAllIntervals()).toHaveLength(1);
    expect(store.getAllIntervals()[0]).toMatchObject({ state: 'EXECUTE', endTime: null });

    await assertReplaySafe(store, events);
  });
});

describe('rule 3b — product freshness on COUNTS', () => {
  it('updates Machine.currentProductId in the same scan when a COUNTS event carries a different productId', async () => {
    const store = new MemoryStore();
    store.seedMachine({ id: MACHINE_ID, lineId: LINE_ID, changeoverTargetMin: 15, currentProductId: 'P0' });
    store.seedShifts([{ id: 'S1', name: 'S1', startMin: 0, endMin: 1440, breaks: [] }]);
    const T0 = Date.parse('2026-01-06T00:00:00.000Z');
    const events = [
      stateChange(1n, 0, T0, 'EXECUTE'),
      counts(2n, 1, T0 + MIN, { goodDelta: 1, rejectDelta: 0, rejectReason: null, idealCycleTimeSec: 3, productId: 'P1' }),
    ];

    await processMachineBatch(store, silentLogger, MACHINE_ID, events);

    await expect(store.getMachine(MACHINE_ID)).resolves.toMatchObject({ currentProductId: 'P1' });
  });
});

describe('rule 5 — rejects on COUNTS -> QUALITY loss', () => {
  it('RJ-STARTUP -> STARTUP_REJECTS; any other reject reason -> PRODUCTION_REJECTS; upsert keyed to the source event (never accumulated)', async () => {
    const store = new MemoryStore();
    store.seedMachine({ id: MACHINE_ID, lineId: LINE_ID, changeoverTargetMin: 15, currentProductId: null });
    store.seedShifts([{ id: 'S1', name: 'S1', startMin: 0, endMin: 1440, breaks: [] }]);
    const T0 = Date.parse('2026-01-06T00:00:00.000Z');
    const events = [
      stateChange(1n, 0, T0, 'EXECUTE'),
      counts(2n, 1, T0 + MIN, { goodDelta: 5, rejectDelta: 2, rejectReason: 'RJ-DIM', idealCycleTimeSec: 3, productId: 'P1' }),
      counts(3n, 2, T0 + 2 * MIN, { goodDelta: 0, rejectDelta: 1, rejectReason: 'RJ-STARTUP', idealCycleTimeSec: 3, productId: 'P1' }),
    ];

    await processMachineBatch(store, silentLogger, MACHINE_ID, events);

    const losses = store.getAllLossEvents();
    const prod = losses.filter((l) => l.category === 'PRODUCTION_REJECTS');
    const startup = losses.filter((l) => l.category === 'STARTUP_REJECTS');
    expect(prod).toHaveLength(1);
    expect(prod[0]).toMatchObject({ factor: 'QUALITY', reasonCode: 'RJ-DIM', lostUnits: 2, lostTimeSec: 6, sourceEventId: 2n });
    expect(startup).toHaveLength(1);
    expect(startup[0]).toMatchObject({ factor: 'QUALITY', reasonCode: 'RJ-STARTUP', lostUnits: 1, lostTimeSec: 3, sourceEventId: 3n });

    await assertReplaySafe(store, events);
  });
});

describe('rule 4 — residual slow cycles per fully-elapsed shift', () => {
  it('full-shift fixture: pLossTotal=20min, microstops=8min -> SLOW_CYCLES 12min, upserted once on shift transition', async () => {
    const store = new MemoryStore();
    store.seedMachine({ id: MACHINE_ID, lineId: LINE_ID, changeoverTargetMin: 15, currentProductId: null });
    // Two back-to-back 1-hour shifts, no breaks, so PPT for a fully-elapsed
    // S1 = 60min exactly and the S2 event is what proves S1 has elapsed.
    store.seedShifts([
      { id: 'S1', name: 'S1', startMin: 0, endMin: 60, breaks: [] },
      { id: 'S2', name: 'S2', startMin: 60, endMin: 120, breaks: [] },
    ]);
    const MIDNIGHT = Date.parse('2026-01-06T00:00:00.000Z');

    // Hand math: PPT=60min (3600s), no DOWN/CHANGEOVER -> runTime=3600s.
    // ICT time = 6s * (390 good + 10 reject) = 2400s (40min).
    // pLossTotal = max(0, 3600-2400) = 1200s (20min).
    // microstops = one 480s (8min) alarm.
    // slowCycles = max(0, 1200-480) = 720s (12min).
    const events = [
      stateChange(1n, 0, MIDNIGHT, 'EXECUTE'),
      alarm(2n, 1, MIDNIGHT + 30 * MIN, 'SS-MATERIAL', 480),
      counts(3n, 2, MIDNIGHT + 31 * MIN, {
        goodDelta: 390,
        rejectDelta: 10,
        rejectReason: 'RJ-DIM',
        idealCycleTimeSec: 6,
        productId: 'P1',
      }),
      // Proves S1 (0-60min) has fully elapsed — lands in S2 (60-120min).
      stateChange(4n, 3, MIDNIGHT + 61 * MIN, 'DOWN', 'BRK-MECH'),
    ];

    await processMachineBatch(store, silentLogger, MACHINE_ID, events);

    const slowCycles = store.getAllLossEvents().filter((l) => l.category === 'SLOW_CYCLES');
    expect(slowCycles).toHaveLength(1);
    expect(slowCycles[0]).toMatchObject({
      factor: 'PERFORMANCE',
      reasonCode: 'SL-SPEED',
      lostTimeSec: 12 * 60,
      sourceEventId: 0n,
      shiftId: 'S1',
      windowStart: new Date(MIDNIGHT),
      windowEnd: new Date(MIDNIGHT + 60 * MIN),
    });

    await assertReplaySafe(store, events);
  });
});
