import { describe, expect, it, vi } from 'vitest';
import type { ShiftDef } from '@linelens/contracts';
import { processMachineBatch } from '../src/derive/intervals.js';
import { MemoryStore } from '../src/derive/store.js';
import type { DerivedEvent } from '../src/derive/types.js';

/**
 * Task 2 <verify>: an in-memory event fixture EXECUTE->DOWN->EXECUTE->
 * CHANGEOVER->EXECUTE yields 5 intervals with exact start/end times, the
 * last one open; replaying the (cursor-filtered) fixture leaves rows
 * unchanged.
 */

const MACHINE_ID = 'M-01';
const LINE_ID = 'L-01';
const T0 = Date.parse('2026-01-06T07:00:00.000Z');
const MIN = 60_000;

const SHIFTS: ShiftDef[] = [
  { id: 'S1', name: 'Shift 1', startMin: 0, endMin: 1440, breaks: [] }, // a single all-day shift so the fixture never crosses a shift boundary
];

const stateChange = (id: bigint, seq: number, atMs: number, state: string): DerivedEvent => ({
  id,
  machineId: MACHINE_ID,
  lineId: LINE_ID,
  kind: 'STATE_CHANGE',
  simTime: new Date(atMs),
  seq,
  state,
  reasonCode: state === 'DOWN' ? 'BRK-MECH' : state === 'CHANGEOVER' ? 'CO-PRODUCT' : null,
});

const buildStore = (): MemoryStore => {
  const store = new MemoryStore();
  store.seedMachine({ id: MACHINE_ID, lineId: LINE_ID, changeoverTargetMin: 15, currentProductId: null });
  store.seedShifts(SHIFTS);
  return store;
};

const silentLogger = { warn: vi.fn() };

describe('processMachineBatch — close-on-next-event interval derivation', () => {
  it('EXECUTE->DOWN->EXECUTE->CHANGEOVER->EXECUTE yields 5 intervals, last open', async () => {
    const store = buildStore();
    const events: DerivedEvent[] = [
      stateChange(1n, 0, T0, 'EXECUTE'),
      stateChange(2n, 1, T0 + 10 * MIN, 'DOWN'),
      stateChange(3n, 2, T0 + 25 * MIN, 'EXECUTE'),
      stateChange(4n, 3, T0 + 40 * MIN, 'CHANGEOVER'),
      stateChange(5n, 4, T0 + 55 * MIN, 'EXECUTE'),
    ];

    await processMachineBatch(store, silentLogger, MACHINE_ID, events);

    const intervals = store.getAllIntervals();
    expect(intervals).toHaveLength(5);

    expect(intervals[0]).toMatchObject({ state: 'EXECUTE', startTime: new Date(T0), endTime: new Date(T0 + 10 * MIN) });
    expect(intervals[1]).toMatchObject({
      state: 'DOWN',
      startTime: new Date(T0 + 10 * MIN),
      endTime: new Date(T0 + 25 * MIN),
      reasonCode: 'BRK-MECH',
    });
    expect(intervals[2]).toMatchObject({ state: 'EXECUTE', startTime: new Date(T0 + 25 * MIN), endTime: new Date(T0 + 40 * MIN) });
    expect(intervals[3]).toMatchObject({
      state: 'CHANGEOVER',
      startTime: new Date(T0 + 40 * MIN),
      endTime: new Date(T0 + 55 * MIN),
      reasonCode: 'CO-PRODUCT',
    });
    expect(intervals[4]).toMatchObject({ state: 'EXECUTE', startTime: new Date(T0 + 55 * MIN), endTime: null });
  });

  it('replaying only cursor-filtered (already-processed) events is a no-op — rows unchanged', async () => {
    const store = buildStore();
    const events: DerivedEvent[] = [
      stateChange(1n, 0, T0, 'EXECUTE'),
      stateChange(2n, 1, T0 + 10 * MIN, 'DOWN'),
      stateChange(3n, 2, T0 + 25 * MIN, 'EXECUTE'),
      stateChange(4n, 3, T0 + 40 * MIN, 'CHANGEOVER'),
      stateChange(5n, 4, T0 + 55 * MIN, 'EXECUTE'),
    ];

    await processMachineBatch(store, silentLogger, MACHINE_ID, events);
    const before = store.getAllIntervals();
    const beforeLosses = store.getAllLossEvents();

    // Mirror runner.ts's real behavior: the poll loop only ever hands
    // processMachineBatch events with id > cursor.lastEventId. After the
    // first pass, the cursor is past all 5 fixture events, so "replaying"
    // the fixture is this — an empty filtered batch.
    const cursor = store.getCursor(MACHINE_ID);
    expect(cursor?.lastEventId).toBe(5n);
    const replay = events.filter((e) => e.id > (cursor?.lastEventId ?? 0n));
    expect(replay).toHaveLength(0);

    await processMachineBatch(store, silentLogger, MACHINE_ID, replay);

    expect(store.getAllIntervals()).toEqual(before);
    expect(store.getAllLossEvents()).toEqual(beforeLosses);
  });

  it('Finding 2 hardening: an event for a machine with no master-data row is skipped-and-logged, not thrown', async () => {
    const store = new MemoryStore();
    store.seedShifts(SHIFTS);
    // Deliberately NOT seeding a machine — mirrors a leaked/unseeded machineId
    // landing in machine_event (no FK, per schema.prisma design).
    const warn = vi.fn();
    const events: DerivedEvent[] = [stateChange(1n, 0, T0, 'EXECUTE')];

    await expect(processMachineBatch(store, { warn }, 'UNKNOWN-M', events)).resolves.not.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ machineId: 'UNKNOWN-M' });
    expect(store.getAllIntervals()).toHaveLength(0);
    expect(store.getAllLossEvents()).toHaveLength(0);
  });
});
