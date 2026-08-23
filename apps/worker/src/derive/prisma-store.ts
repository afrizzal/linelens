import type { Prisma, StateInterval as StateIntervalRow } from '@linelens/db';
import type { ShiftDef } from '@linelens/contracts';
import { allocateGoodProduction } from '../orders/allocate.js';
import type { DerivationStore } from './store.js';
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
 * `DerivationStore` backed by a `Prisma.TransactionClient` — the real
 * derivation path, driven by the poll loop in intervals.ts. All reads/writes
 * go through the transaction handed in at construction, so a batch's
 * interval close/open + loss upserts + cursor advance commit atomically
 * (02-02-PLAN.md Task 2: "one transaction per batch... exactly-once effect").
 */
export class PrismaStore implements DerivationStore {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  private toIntervalRow = (row: StateIntervalRow): IntervalRow => ({
    machineId: row.machineId,
    lineId: row.lineId,
    state: row.state,
    startTime: row.startTime,
    endTime: row.endTime,
    reasonCode: row.reasonCode,
    injected: row.injected,
    sourceEventId: row.sourceEventId,
  });

  async getMachine(machineId: string): Promise<MachineMaster | undefined> {
    const m = await this.tx.machine.findUnique({ where: { id: machineId } });
    if (!m) return undefined;
    return {
      id: m.id,
      lineId: m.lineId,
      changeoverTargetMin: m.changeoverTargetMin,
      currentProductId: m.currentProductId,
    };
  }

  async getEngineConfig(): Promise<EngineConfigState> {
    const cfg = await this.tx.engineConfig.findUnique({ where: { id: 1 } });
    // No row yet = schema default (changeoverAsPlanned: true) — never force-create on a read.
    return { changeoverAsPlanned: cfg?.changeoverAsPlanned ?? true };
  }

  async getShifts(): Promise<ShiftDef[]> {
    const rows = await this.tx.shift.findMany();
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      startMin: s.startMin,
      endMin: s.endMin,
      breaks: s.breaks as { startMin: number; endMin: number }[],
    }));
  }

  async getOpenInterval(machineId: string): Promise<IntervalRow | undefined> {
    const row = await this.tx.stateInterval.findFirst({
      where: { machineId, endTime: null },
      orderBy: { startTime: 'desc' },
    });
    return row ? this.toIntervalRow(row) : undefined;
  }

  async closeInterval(machineId: string, endTime: Date): Promise<void> {
    await this.tx.stateInterval.updateMany({ where: { machineId, endTime: null }, data: { endTime } });
  }

  async openInterval(row: NewIntervalInput): Promise<void> {
    await this.tx.stateInterval.create({
      data: {
        machineId: row.machineId,
        lineId: row.lineId,
        state: row.state,
        startTime: row.startTime,
        reasonCode: row.reasonCode,
        injected: row.injected,
        sourceEventId: row.sourceEventId,
      },
    });
  }

  async upsertLossEvent(row: LossEventInput): Promise<void> {
    const data = {
      machineId: row.machineId,
      lineId: row.lineId,
      factor: row.factor,
      category: row.category,
      reasonCode: row.reasonCode,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
      lostTimeSec: row.lostTimeSec,
      lostUnits: row.lostUnits,
      injected: row.injected,
      sourceEventId: row.sourceEventId,
      shiftDate: row.shiftDate,
      shiftId: row.shiftId,
    };
    await this.tx.lossEvent.upsert({
      where: {
        machineId_category_reasonCode_windowStart_sourceEventId: {
          machineId: row.machineId,
          category: row.category,
          reasonCode: row.reasonCode,
          windowStart: row.windowStart,
          sourceEventId: row.sourceEventId,
        },
      },
      create: data,
      update: data,
    });
  }

  async setCurrentProduct(machineId: string, productId: string): Promise<void> {
    await this.tx.machine.update({ where: { id: machineId }, data: { currentProductId: productId } });
  }

  async getLastProcessedSimMs(machineId: string): Promise<number | undefined> {
    const cursor = await this.tx.machineCursor.findUnique({ where: { machineId } });
    if (!cursor) return undefined;
    const event = await this.tx.machineEvent.findUnique({ where: { id: cursor.lastEventId }, select: { simTime: true } });
    return event?.simTime.getTime();
  }

  // No-op — see DerivationStore doc: PrismaStore recomputes this fresh next
  // batch via getLastProcessedSimMs (cursor + machine_event), nothing to persist mid-transaction.
  async setLastProcessedSimMs(): Promise<void> {}

  // No-op — see DerivationStore doc: the raw COUNTS row is already
  // persisted in machine_event by ingest.ts; listCountsInWindow reads it directly.
  async recordCounts(): Promise<void> {}

  async listIntervalsOverlapping(machineId: string, startMs: number, endMs: number): Promise<IntervalRow[]> {
    const rows = await this.tx.stateInterval.findMany({
      where: {
        machineId,
        startTime: { lt: new Date(endMs) },
        OR: [{ endTime: null }, { endTime: { gt: new Date(startMs) } }],
      },
    });
    return rows.map(this.toIntervalRow);
  }

  async listCountsInWindow(machineId: string, startMs: number, endMs: number): Promise<CountsWindowRow[]> {
    const rows = await this.tx.machineEvent.findMany({
      where: { machineId, kind: 'COUNTS', simTime: { gte: new Date(startMs), lt: new Date(endMs) } },
      select: { simTime: true, goodDelta: true, rejectDelta: true, idealCycleTimeSec: true },
    });
    return rows.map((r) => ({
      simTimeMs: r.simTime.getTime(),
      goodDelta: r.goodDelta ?? 0,
      rejectDelta: r.rejectDelta ?? 0,
      idealCycleTimeSec: r.idealCycleTimeSec ?? 0,
    }));
  }

  async listSmallStopsInWindow(machineId: string, startMs: number, endMs: number): Promise<SmallStopWindowRow[]> {
    const rows = await this.tx.lossEvent.findMany({
      where: { machineId, category: 'SMALL_STOPS', windowStart: { gte: new Date(startMs), lt: new Date(endMs) } },
      select: { lostTimeSec: true },
    });
    return rows.map((r) => ({ lostTimeSec: r.lostTimeSec }));
  }

  async setCursor(machineId: string, lastEventId: bigint, lastSeq: number): Promise<void> {
    await this.tx.machineCursor.upsert({
      where: { machineId },
      create: { machineId, lastEventId, lastSeq },
      update: { lastEventId, lastSeq },
    });
  }

  // 04-01-PLAN.md Task 2: delegates to orders/allocate.ts using THIS store's
  // own `tx` — same transaction, same MachineCursor, no second scan.
  async allocateGoodProduction(params: {
    productId: string;
    lineId: string;
    machineId: string;
    goodDelta: number;
    simTime: Date;
    sourceEventId: bigint;
  }): Promise<void> {
    await allocateGoodProduction(this.tx, params);
  }
}
