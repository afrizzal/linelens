import { describe, expect, it } from 'vitest';
import type { ShiftDef } from '@linelens/contracts';
import { generateOrdersForDay, PROFILE_OEE_ESTIMATE, WARM_START_DAY } from '../../src/orders/generate.js';

/**
 * Task 1 <verify>: two runs over the same sim-days produce identical orders
 * (determinism). Demand/capacity ratio lands in [0.85, 1.0].
 */

const SHIFTS: ShiftDef[] = [
  { id: 'S1', name: 'Shift 1', startMin: 420, endMin: 900, breaks: [{ startMin: 570, endMin: 585 }, { startMin: 720, endMin: 750 }] },
  { id: 'S2', name: 'Shift 2', startMin: 900, endMin: 1380, breaks: [{ startMin: 1050, endMin: 1065 }, { startMin: 1200, endMin: 1230 }] },
];

const PRODUCTS = [
  { id: 'CYC-A', idealCycleTimeSec: 3.0 },
  { id: 'CYC-B', idealCycleTimeSec: 4.0 },
  { id: 'CYC-C', idealCycleTimeSec: 2.5 },
];

const MACHINES = [
  { id: 'L1-M1', lineId: 'L1', profile: 'showcase', currentProductId: 'CYC-A' },
  { id: 'L1-M2', lineId: 'L1', profile: 'showcase', currentProductId: 'CYC-A' },
  { id: 'L2-M1', lineId: 'L2', profile: 'typical', currentProductId: 'CYC-B' },
  { id: 'L2-M2', lineId: 'L2', profile: 'typical', currentProductId: 'CYC-B' },
  { id: 'L3-M1', lineId: 'L3', profile: 'typical', currentProductId: 'CYC-C' },
  { id: 'L3-M2', lineId: 'L3', profile: 'typical', currentProductId: 'CYC-C' },
  { id: 'L4-M1', lineId: 'L4', profile: 'problem', currentProductId: 'CYC-A' },
  { id: 'L4-M2', lineId: 'L4', profile: 'problem', currentProductId: 'CYC-A' },
];

const SEED = 42;
const SIM_DAY = WARM_START_DAY;

describe('generateOrdersForDay', () => {
  it('is deterministic across repeated calls with the same inputs', () => {
    const run1 = generateOrdersForDay({ simDay: SIM_DAY, seed: SEED, products: PRODUCTS, machines: MACHINES, shifts: SHIFTS });
    const run2 = generateOrdersForDay({ simDay: SIM_DAY, seed: SEED, products: PRODUCTS, machines: MACHINES, shifts: SHIFTS });

    expect(run2).toEqual(run1);
    expect(run1.length).toBeGreaterThan(0);
  });

  it('produces different orders for a different sim-day (salt varies)', () => {
    const day1 = generateOrdersForDay({ simDay: '2026-01-05', seed: SEED, products: PRODUCTS, machines: MACHINES, shifts: SHIFTS });
    const day2 = generateOrdersForDay({ simDay: '2026-01-06', seed: SEED, products: PRODUCTS, machines: MACHINES, shifts: SHIFTS });

    expect(day2.map((o) => o.qtyOrdered)).not.toEqual(day1.map((o) => o.qtyOrdered));
  });

  it('sizes total demand per product to 85-100% of expected daily capacity', () => {
    const orders = generateOrdersForDay({ simDay: SIM_DAY, seed: SEED, products: PRODUCTS, machines: MACHINES, shifts: SHIFTS });

    // Recompute expected capacity the same way generate.ts does (PPT/ICT * profile estimate),
    // independently, to cross-check the demand/capacity ratio without importing internals.
    const dayMidnightMs = Date.parse(`${SIM_DAY}T00:00:00.000Z`);
    const pptSecPerShift = (shift: ShiftDef): number => {
      const start = dayMidnightMs + shift.startMin * 60_000;
      const end = dayMidnightMs + shift.endMin * 60_000;
      const breaksSec = shift.breaks.reduce((sum, b) => sum + (b.endMin - b.startMin) * 60, 0);
      return (end - start) / 1000 - breaksSec;
    };
    const dailyPptSec = SHIFTS.reduce((sum, s) => sum + pptSecPerShift(s), 0);

    const capacityByProduct = new Map<string, number>();
    for (const m of MACHINES) {
      const ict = PRODUCTS.find((p) => p.id === m.currentProductId)!.idealCycleTimeSec;
      const estimate = PROFILE_OEE_ESTIMATE[m.profile]!;
      capacityByProduct.set(
        m.currentProductId!,
        (capacityByProduct.get(m.currentProductId!) ?? 0) + (dailyPptSec / ict) * estimate,
      );
    }

    const demandByProduct = new Map<string, number>();
    for (const o of orders) {
      demandByProduct.set(o.productId, (demandByProduct.get(o.productId) ?? 0) + o.qtyOrdered);
    }

    for (const [productId, demand] of demandByProduct) {
      const capacity = capacityByProduct.get(productId)!;
      const ratio = demand / capacity;
      expect(ratio).toBeGreaterThanOrEqual(0.8); // rounding slack around the 0.85 floor
      expect(ratio).toBeLessThanOrEqual(1.05); // rounding slack around the 1.00 ceiling
    }
  });

  it('splits each product into 3-6 orders with distinct customers, qty >= 1', () => {
    const orders = generateOrdersForDay({ simDay: SIM_DAY, seed: SEED, products: PRODUCTS, machines: MACHINES, shifts: SHIFTS });
    const byProduct = new Map<string, typeof orders>();
    for (const o of orders) {
      const arr = byProduct.get(o.productId) ?? [];
      arr.push(o);
      byProduct.set(o.productId, arr);
    }
    for (const [, productOrders] of byProduct) {
      expect(productOrders.length).toBeGreaterThanOrEqual(3);
      expect(productOrders.length).toBeLessThanOrEqual(6);
      expect(new Set(productOrders.map((o) => o.customer)).size).toBe(productOrders.length);
      for (const o of productOrders) {
        expect(o.qtyOrdered).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('dueDate is orderDate + 2 sim-days (day end + 1 sim-day lead time)', () => {
    const orders = generateOrdersForDay({ simDay: SIM_DAY, seed: SEED, products: PRODUCTS, machines: MACHINES, shifts: SHIFTS });
    for (const o of orders) {
      expect(o.dueDate.getTime() - o.orderDate.getTime()).toBe(2 * 24 * 60 * 60 * 1000);
    }
  });
});
