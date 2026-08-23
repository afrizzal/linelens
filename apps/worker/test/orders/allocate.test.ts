import { describe, expect, it } from 'vitest';
import { planFifoAllocation, type OpenOrderCandidate } from '../../src/orders/allocate.js';

/**
 * Task 2 <verify>: capacity 100/day, demand 90 across 3 orders, inject a
 * 30%-output day -> exactly the earliest-due orders ship, the last order
 * flips LATE; allocations never exceed qtyOrdered; replay-idempotent.
 *
 * `planFifoAllocation` is the pure allocation substrate `v_order_status`
 * (packages/db/src/views.sql, Task 2) builds its ON_TIME/LATE/AT_RISK/OPEN
 * labels on top of — this test proves the substrate: after a 30%-output
 * day, the earliest-due order ships in full, the other two stay OPEN with
 * qty remaining (which the SQL view then classifies as LATE once their due
 * date has passed / AT_RISK before it).
 */

const day = (n: number): Date => new Date(Date.UTC(2026, 0, n));

describe('planFifoAllocation', () => {
  const openOrders: OpenOrderCandidate[] = [
    { id: 'ORD-A', qtyOrdered: 30, dueDate: day(6), allocatedQty: 0 },
    { id: 'ORD-B', qtyOrdered: 30, dueDate: day(7), allocatedQty: 0 },
    { id: 'ORD-C', qtyOrdered: 30, dueDate: day(8), allocatedQty: 0 },
  ];

  it('a 30%-output day (30 of 100 capacity) fully ships only the earliest-due order', () => {
    const plan = planFifoAllocation(openOrders, 30);

    expect(plan).toEqual([{ orderId: 'ORD-A', qty: 30, shipped: true }]);
  });

  it('never allocates more than an order`s remaining qty, even with pool to spare', () => {
    const plan = planFifoAllocation(openOrders, 1000);

    expect(plan).toEqual([
      { orderId: 'ORD-A', qty: 30, shipped: true },
      { orderId: 'ORD-B', qty: 30, shipped: true },
      { orderId: 'ORD-C', qty: 30, shipped: true },
    ]);
    const totalAllocated = plan.reduce((sum, p) => sum + p.qty, 0);
    expect(totalAllocated).toBe(90); // capped at total qtyOrdered, never the 1000-unit pool
  });

  it('is idempotent across repeated planning of the same (unchanged) open-order state', () => {
    const plan1 = planFifoAllocation(openOrders, 30);
    const plan2 = planFifoAllocation(openOrders, 30);

    expect(plan2).toEqual(plan1);
  });

  it('a partial output (15 units) allocates to the earliest-due order without shipping it', () => {
    const plan = planFifoAllocation(openOrders, 15);

    expect(plan).toEqual([{ orderId: 'ORD-A', qty: 15, shipped: false }]);
  });

  it('a subsequent allocation resumes from allocatedQty (order-level idempotency guard)', () => {
    const partiallyAllocated: OpenOrderCandidate[] = [
      { id: 'ORD-A', qtyOrdered: 30, dueDate: day(6), allocatedQty: 15 },
      { id: 'ORD-B', qtyOrdered: 30, dueDate: day(7), allocatedQty: 0 },
      { id: 'ORD-C', qtyOrdered: 30, dueDate: day(8), allocatedQty: 0 },
    ];
    const plan = planFifoAllocation(partiallyAllocated, 15);

    expect(plan).toEqual([{ orderId: 'ORD-A', qty: 15, shipped: true }]);
  });

  it('skips orders with no remaining qty (fully allocated but still passed in defensively)', () => {
    const mixed: OpenOrderCandidate[] = [
      { id: 'ORD-A', qtyOrdered: 30, dueDate: day(6), allocatedQty: 30 },
      { id: 'ORD-B', qtyOrdered: 30, dueDate: day(7), allocatedQty: 0 },
    ];
    const plan = planFifoAllocation(mixed, 10);

    expect(plan).toEqual([{ orderId: 'ORD-B', qty: 10, shipped: false }]);
  });
});
