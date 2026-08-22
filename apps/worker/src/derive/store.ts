import type { ShiftDef } from '@linelens/contracts';
import type {
  CountsWindowRow,
  EngineConfigState,
  IntervalRow,
  LossEventInput,
  MachineMaster,
  NewIntervalInput,
  SmallStopWindowRow,
} from './types.js';

/**
 * Storage abstraction the derivation core (intervals.ts, losses.ts) writes
 * through. Two implementations:
 *  - `MemoryStore` (this file) — an in-process fixture store for unit tests
 *    (Task 2/3 <verify>: "unit test with an in-memory event fixture", no
 *    Postgres required).
 *  - `PrismaStore` (prisma-store.ts) — wraps a `Prisma.TransactionClient`
 *    for the real poll loop.
 *
 * Every method here is synchronous by design in MemoryStore; PrismaStore's
 * equivalents are async — the derivation core (intervals.ts) always awaits,
 * so both implementations satisfy the same `DerivationStore` async contract.
 */
export interface DerivationStore {
  getMachine(machineId: string): Promise<MachineMaster | undefined>;
  getEngineConfig(): Promise<EngineConfigState>;
  getShifts(): Promise<ShiftDef[]>;

  getOpenInterval(machineId: string): Promise<IntervalRow | undefined>;
  closeInterval(machineId: string, endTime: Date): Promise<void>;
  openInterval(row: NewIntervalInput): Promise<void>;

  /** Idempotent on the natural key (machineId, category, reasonCode, windowStart, sourceEventId) — an upsert, never accumulate-on-conflict. */
  upsertLossEvent(row: LossEventInput): Promise<void>;

  setCurrentProduct(machineId: string, productId: string): Promise<void>;

  /**
   * Record a COUNTS event's numbers for rule 4's window query. PrismaStore
   * implements this as a no-op — the raw machine_event row was already
   * persisted by apps/worker/src/ingest.ts before derivation ever runs, so
   * `listCountsInWindow` queries that table directly. MemoryStore has no
   * backing raw-event table, so it logs the row itself.
   */
  recordCounts(machineId: string, row: CountsWindowRow): Promise<void>;

  /**
   * simTime (ms) of the most recently processed event for this machine,
   * BEFORE the current batch — used only to detect a shift-instance
   * transition that spans a batch boundary. `undefined` = no prior
   * processed event exists yet (this machine's very first batch).
   */
  getLastProcessedSimMs(machineId: string): Promise<number | undefined>;

  /**
   * Record the simTime (ms) just processed, for shift-transition detection
   * within a single batch call. PrismaStore implements this as a no-op —
   * the next batch recomputes `getLastProcessedSimMs` fresh from the
   * persisted MachineCursor + machine_event row, so nothing needs writing
   * mid-transaction. MemoryStore needs this to support multi-batch test
   * scenarios (replay, incremental polling simulation).
   */
  setLastProcessedSimMs(machineId: string, simMs: number): Promise<void>;

  /** DOWN/CHANGEOVER intervals overlapping [startMs, endMs) for rule 4's run-time subtraction. Open intervals (endTime null) are included. */
  listIntervalsOverlapping(machineId: string, startMs: number, endMs: number): Promise<IntervalRow[]>;
  /** COUNTS events with simTime in [startMs, endMs) for rule 4's ICT-time sum. */
  listCountsInWindow(machineId: string, startMs: number, endMs: number): Promise<CountsWindowRow[]>;
  /** SMALL_STOPS loss_event rows with windowStart in [startMs, endMs) for rule 4's residual subtraction. */
  listSmallStopsInWindow(machineId: string, startMs: number, endMs: number): Promise<SmallStopWindowRow[]>;

  setCursor(machineId: string, lastEventId: bigint, lastSeq: number): Promise<void>;
}

/** In-memory fixture store — no I/O. Mirrors the shape PrismaStore persists, for unit tests. */
export class MemoryStore implements DerivationStore {
  private machines = new Map<string, MachineMaster>();
  private engineConfig: EngineConfigState = { changeoverAsPlanned: true };
  private shifts: ShiftDef[] = [];
  private openIntervals = new Map<string, IntervalRow>();
  /** All intervals ever created (open + closed), for rule 4's window queries. */
  private allIntervals: IntervalRow[] = [];
  private lossEvents = new Map<string, LossEventInput>();
  private lastProcessedSimMs = new Map<string, number>();
  private countsLog: Array<{ machineId: string } & CountsWindowRow> = [];
  private cursors = new Map<string, { lastEventId: bigint; lastSeq: number }>();

  seedMachine(m: MachineMaster): void {
    this.machines.set(m.id, m);
  }

  seedShifts(shifts: ShiftDef[]): void {
    this.shifts = shifts;
  }

  setEngineConfig(cfg: EngineConfigState): void {
    this.engineConfig = cfg;
  }

  recordCounts(machineId: string, row: CountsWindowRow): Promise<void> {
    this.countsLog.push({ machineId, ...row });
    return Promise.resolve();
  }

  getMachine(machineId: string): Promise<MachineMaster | undefined> {
    return Promise.resolve(this.machines.get(machineId));
  }

  getEngineConfig(): Promise<EngineConfigState> {
    return Promise.resolve(this.engineConfig);
  }

  getShifts(): Promise<ShiftDef[]> {
    return Promise.resolve(this.shifts);
  }

  getOpenInterval(machineId: string): Promise<IntervalRow | undefined> {
    return Promise.resolve(this.openIntervals.get(machineId));
  }

  closeInterval(machineId: string, endTime: Date): Promise<void> {
    const open = this.openIntervals.get(machineId);
    if (open) {
      open.endTime = endTime;
      this.openIntervals.delete(machineId);
    }
    return Promise.resolve();
  }

  openInterval(row: NewIntervalInput): Promise<void> {
    const full: IntervalRow = { ...row, endTime: null };
    this.openIntervals.set(row.machineId, full);
    this.allIntervals.push(full);
    return Promise.resolve();
  }

  upsertLossEvent(row: LossEventInput): Promise<void> {
    const key = `${row.machineId}|${row.category}|${row.reasonCode}|${row.windowStart.getTime()}|${row.sourceEventId}`;
    this.lossEvents.set(key, row);
    return Promise.resolve();
  }

  setCurrentProduct(machineId: string, productId: string): Promise<void> {
    const m = this.machines.get(machineId);
    if (m) m.currentProductId = productId;
    return Promise.resolve();
  }

  getLastProcessedSimMs(machineId: string): Promise<number | undefined> {
    return Promise.resolve(this.lastProcessedSimMs.get(machineId));
  }

  setLastProcessedSimMs(machineId: string, simMs: number): Promise<void> {
    this.lastProcessedSimMs.set(machineId, simMs);
    return Promise.resolve();
  }

  listIntervalsOverlapping(machineId: string, startMs: number, endMs: number): Promise<IntervalRow[]> {
    const rows = this.allIntervals.filter((iv) => {
      if (iv.machineId !== machineId) return false;
      const ivStart = iv.startTime.getTime();
      const ivEnd = iv.endTime ? iv.endTime.getTime() : Number.POSITIVE_INFINITY;
      return ivStart < endMs && ivEnd > startMs;
    });
    return Promise.resolve(rows);
  }

  listCountsInWindow(machineId: string, startMs: number, endMs: number): Promise<CountsWindowRow[]> {
    const rows = this.countsLog
      .filter((c) => c.machineId === machineId && c.simTimeMs >= startMs && c.simTimeMs < endMs)
      .map(({ simTimeMs, goodDelta, rejectDelta, idealCycleTimeSec }) => ({
        simTimeMs,
        goodDelta,
        rejectDelta,
        idealCycleTimeSec,
      }));
    return Promise.resolve(rows);
  }

  listSmallStopsInWindow(machineId: string, startMs: number, endMs: number): Promise<SmallStopWindowRow[]> {
    const rows = [...this.lossEvents.values()].filter(
      (r) =>
        r.machineId === machineId &&
        r.category === 'SMALL_STOPS' &&
        r.windowStart.getTime() >= startMs &&
        r.windowStart.getTime() < endMs,
    );
    return Promise.resolve(rows.map((r) => ({ lostTimeSec: r.lostTimeSec })));
  }

  setCursor(machineId: string, lastEventId: bigint, lastSeq: number): Promise<void> {
    this.cursors.set(machineId, { lastEventId, lastSeq });
    return Promise.resolve();
  }

  getCursor(machineId: string): { lastEventId: bigint; lastSeq: number } | undefined {
    return this.cursors.get(machineId);
  }

  /** Test assertion helpers. */
  getAllIntervals(): IntervalRow[] {
    return [...this.allIntervals];
  }

  getAllLossEvents(): LossEventInput[] {
    return [...this.lossEvents.values()];
  }
}
