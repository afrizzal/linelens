import type { Logger } from 'pino';
import type { Db } from '@linelens/db';
import { processMachineBatch } from './intervals.js';
import { PrismaStore } from './prisma-store.js';
import type { DerivedEvent } from './types.js';

/**
 * The real poll loop (02-02-PLAN.md Task 2): every `intervalMs` (default
 * 200ms real), for each machine with pending machine_event rows, fetch
 * events ordered by seq past that machine's MachineCursor, and process them
 * in one transaction per (machine, tick) batch — the transaction commits
 * the interval close/open, every loss_event upsert, AND the cursor advance
 * atomically (exactly-once effect on a worker restart mid-batch: the
 * transaction either fully applied, in which case the cursor already moved
 * past these events, or it didn't, in which case they're re-read next tick).
 *
 * Deliberately queries per-machine (not a single global watermark query) —
 * this also naturally picks up events for machines with NO master-data row
 * (Finding 2 hardening: unknown machines are still discovered via DISTINCT
 * machineId, then skipped-and-logged inside processMachineBatch rather than
 * silently ignored forever).
 */
export interface DerivationLoopDeps {
  db: Db;
  logger: Logger;
  /** Real-ms between poll ticks. Default 200ms per plan. */
  intervalMs?: number;
  /** Max events fetched per machine per tick. */
  batchSize?: number;
  /** Called once per tick with every lineId that had at least one event processed (Task 4's NOTIFY coalescing input). */
  onLineIdsChanged?: (lineIds: string[]) => void;
}

export interface DerivationLoopHandle {
  stop: () => void;
  /** Run exactly one tick immediately — used by tests and by the notify-coalescing integration test (Task 4). */
  tick: () => Promise<void>;
}

const toDerivedEvent = (row: {
  id: bigint;
  machineId: string;
  lineId: string;
  kind: string;
  simTime: Date;
  seq: number;
  state: string | null;
  reasonCode: string | null;
  goodDelta: number | null;
  rejectDelta: number | null;
  rejectReason: string | null;
  idealCycleTimeSec: number | null;
  productId: string | null;
  durationSec: number | null;
  meta: unknown;
}): DerivedEvent => ({
  id: row.id,
  machineId: row.machineId,
  lineId: row.lineId,
  kind: row.kind as DerivedEvent['kind'],
  simTime: row.simTime,
  seq: row.seq,
  state: row.state,
  reasonCode: row.reasonCode,
  goodDelta: row.goodDelta,
  rejectDelta: row.rejectDelta,
  rejectReason: row.rejectReason,
  idealCycleTimeSec: row.idealCycleTimeSec,
  productId: row.productId,
  durationSec: row.durationSec,
  meta: row.meta as { injected?: boolean } | null,
});

const runTick = async (deps: DerivationLoopDeps): Promise<void> => {
  const { db, logger, batchSize = 500 } = deps;
  const changedLineIds = new Set<string>();

  const distinct = await db.machineEvent.findMany({ distinct: ['machineId'], select: { machineId: true } });

  for (const { machineId } of distinct) {
    const cursor = await db.machineCursor.findUnique({ where: { machineId } });
    const afterId = cursor?.lastEventId ?? 0n;
    const rows = await db.machineEvent.findMany({
      where: { machineId, id: { gt: afterId } },
      orderBy: { seq: 'asc' },
      take: batchSize,
    });
    if (rows.length === 0) continue;

    const events = rows.map(toDerivedEvent);
    try {
      await db.$transaction(async (tx) => {
        const store = new PrismaStore(tx);
        await processMachineBatch(store, logger, machineId, events);
      });
      for (const e of events) changedLineIds.add(e.lineId);
    } catch (err) {
      logger.error({ err, machineId, batchSize: events.length }, 'derive: batch transaction failed, will retry next tick');
    }
  }

  if (changedLineIds.size > 0) {
    deps.onLineIdsChanged?.([...changedLineIds]);
  }
};

export const startDerivationLoop = (deps: DerivationLoopDeps): DerivationLoopHandle => {
  const intervalMs = deps.intervalMs ?? 200;
  let running = false;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (running) return; // skip overlapping ticks — the next timer fires regardless
    running = true;
    try {
      await runTick(deps);
    } catch (err) {
      deps.logger.error({ err }, 'derive: poll tick failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  // Node timers keep the process alive by default; that's correct here (the
  // worker is a long-lived daemon), so no `timer.unref()`.

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    tick: async () => {
      if (stopped) return;
      await tick();
    },
  };
};
