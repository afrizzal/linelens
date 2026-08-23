import type { Prisma } from '@linelens/db';

/**
 * FIFO good-production allocation — 04-01-PLAN.md Task 2. Called as an
 * INLINE HOOK from apps/worker/src/derive/intervals.ts's handleCounts, for
 * every COUNTS event with goodDelta>0, inside the SAME transaction that
 * PrismaStore governs for that machine's batch (no second cursor/scan —
 * `apps/worker/src/derive/prisma-store.ts`'s `allocateGoodProduction`
 * delegates here with its own `tx`).
 */

export interface AllocateGoodProductionParams {
  productId: string;
  lineId: string;
  machineId: string;
  goodDelta: number;
  /** Sim-time of the source COUNTS event — becomes Allocation.producedAt / CustomerOrder.shippedAt. */
  simTime: Date;
  sourceEventId: bigint;
}

export interface OpenOrderCandidate {
  id: string;
  qtyOrdered: number;
  dueDate: Date;
  /** Already-allocated quantity from prior COUNTS events, summed. */
  allocatedQty: number;
}

export interface AllocationPlanEntry {
  orderId: string;
  /** Units allocated to this order from the current goodDelta pool. */
  qty: number;
  /** True when this allocation brings the order's Σqty to qtyOrdered (ship it). */
  shipped: boolean;
}

/**
 * Pure FIFO-split core — no I/O, so the Task 2 <verify> fixture (capacity
 * 100/day, demand 90 across 3 orders, inject a 30%-output day -> earliest-due
 * orders ship, last order flips LATE; allocations never exceed qtyOrdered)
 * runs without Postgres. `openOrders` MUST already be sorted by (dueDate,
 * id) — FIFO by due date, tie-broken by id (ARCHITECTURE.md "simplest
 * credible model").
 */
export const planFifoAllocation = (
  openOrders: OpenOrderCandidate[],
  goodDelta: number,
): AllocationPlanEntry[] => {
  const plan: AllocationPlanEntry[] = [];
  let remainingPool = goodDelta;
  for (const order of openOrders) {
    if (remainingPool <= 0) break;
    const orderRemaining = order.qtyOrdered - order.allocatedQty;
    if (orderRemaining <= 0) continue; // already fully allocated (shouldn't normally appear — shippedAt would exclude it — defensive)
    const take = Math.min(orderRemaining, remainingPool);
    remainingPool -= take;
    plan.push({ orderId: order.id, qty: take, shipped: take === orderRemaining });
  }
  return plan;
};

/**
 * I/O wrapper: read open orders for `productId` (FIFO by dueDate, id) with
 * their current allocated qty, plan the split, then write Allocation rows
 * (idempotent upsert on [orderId, sourceEventId] — safe to re-run within a
 * replayed/retried transaction) and flip `shippedAt` for any order the plan
 * fully allocates, all inside the caller's transaction.
 */
export const allocateGoodProduction = async (
  tx: Prisma.TransactionClient,
  params: AllocateGoodProductionParams,
): Promise<void> => {
  const { productId, lineId, machineId, goodDelta, simTime, sourceEventId } = params;
  if (goodDelta <= 0) return;

  interface CandidateRow {
    id: string;
    qtyOrdered: number;
    dueDate: Date;
    allocations: { qty: number }[];
  }
  const candidates: CandidateRow[] = await tx.customerOrder.findMany({
    where: { productId, shippedAt: null },
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    include: { allocations: { select: { qty: true } } },
  });
  const openOrders: OpenOrderCandidate[] = candidates.map((o) => ({
    id: o.id,
    qtyOrdered: o.qtyOrdered,
    dueDate: o.dueDate,
    allocatedQty: o.allocations.reduce((sum: number, a: { qty: number }) => sum + a.qty, 0),
  }));

  const plan = planFifoAllocation(openOrders, goodDelta);

  for (const entry of plan) {
    await tx.allocation.upsert({
      where: { orderId_sourceEventId: { orderId: entry.orderId, sourceEventId } },
      create: { orderId: entry.orderId, lineId, machineId, qty: entry.qty, producedAt: simTime, sourceEventId },
      update: { lineId, machineId, qty: entry.qty, producedAt: simTime },
    });
    if (entry.shipped) {
      await tx.customerOrder.update({ where: { id: entry.orderId }, data: { shippedAt: simTime } });
    }
  }
};
