import { plannedProductionTimeMs, type ShiftDef, type ShiftInstance } from '@linelens/contracts';
import type { Db } from '@linelens/db';
import { makeDayRng, type Rng } from './rng.js';

/**
 * Order generation — 04-01-PLAN.md Task 1. A seeded order book sized so
 * healthy lines mostly ship on time and breakdowns push real orders late
 * (~85-95% of expected capacity, DIFOT-01's must-have truth). Pure core
 * (`generateOrdersForDay`) is DB-free and deterministic — two calls with the
 * same `simDay`/`seed`/master-data snapshot always produce byte-identical
 * orders; the thin wrapper below (`ensureOrderBookSeeded`) is the only part
 * that touches Postgres.
 *
 * profileOeeEstimate is an ENGINEERING PLANNING HEURISTIC (docs/00-domain-
 * research.md calibration bands), NOT a sourced industry claim — it only
 * sizes daily demand relative to a machine's calibrated OEE profile so the
 * order book is believable, never asserted to the user as a formula.
 */

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MIN;

export const PROFILE_OEE_ESTIMATE: Record<string, number> = {
  showcase: 0.85,
  typical: 0.58,
  problem: 0.4,
};

/**
 * Warm-start day pinned in 01-03-PLAN.md (SIM_START 2026-01-05T06:55 ->
 * GO_LIVE 2026-01-06T06:55) — the ONE prior sim-day the simulator replays
 * through on every boot. Backfilling orders for this exact date is what
 * gives DIFOT/DDS a completed day of history at go-live.
 */
export const WARM_START_DAY = '2026-01-05';

const CUSTOMERS = [
  'PT Surya Component',
  'CV Delta Plastik',
  'PT Cahaya Logam Jaya',
  'CV Mitra Presisi',
  'PT Nusantara Fastener',
  'CV Sinar Otomotif',
  'PT Graha Sparepart',
  'CV Bintang Manufaktur',
] as const;

export interface MachineSnapshot {
  id: string;
  lineId: string;
  profile: string;
  currentProductId: string | null;
}

export interface ProductSnapshot {
  id: string;
  idealCycleTimeSec: number;
}

export interface GeneratedOrder {
  id: string;
  productId: string;
  customer: string;
  qtyOrdered: number;
  orderDate: Date;
  dueDate: Date;
}

export interface GenerateOrdersParams {
  /** YYYY-MM-DD, sim calendar date. */
  simDay: string;
  /** plant.config.json's global seed (contracts PlantConfig.seed). */
  seed: number;
  products: ProductSnapshot[];
  machines: MachineSnapshot[];
  shifts: ShiftDef[];
}

/** Total Planned Production Time (seconds) across every shift for one full sim-day, breaks excluded (calendar.ts convention). */
const dailyPptSec = (dayMidnightMs: number, shifts: ShiftDef[]): number => {
  let totalMs = 0;
  for (const shift of shifts) {
    const inst: ShiftInstance = {
      shiftId: shift.id,
      date: new Date(dayMidnightMs).toISOString().slice(0, 10),
      startMs: dayMidnightMs + shift.startMin * MS_PER_MIN,
      endMs: dayMidnightMs + shift.endMin * MS_PER_MIN,
    };
    totalMs += plannedProductionTimeMs(inst, shifts);
  }
  return totalMs / 1000;
};

/** Expected daily capacity per product = Σ over machines currently running that product of (PPT_per_day_sec / ICT) × profileOeeEstimate. */
const capacityByProduct = (
  machines: MachineSnapshot[],
  ictByProduct: Map<string, number>,
  pptSecPerMachine: number,
): Map<string, number> => {
  const capacity = new Map<string, number>();
  for (const m of machines) {
    if (!m.currentProductId) continue;
    const ict = ictByProduct.get(m.currentProductId);
    if (!ict || ict <= 0) continue;
    const estimate = PROFILE_OEE_ESTIMATE[m.profile] ?? PROFILE_OEE_ESTIMATE.typical!;
    const machineCapacity = (pptSecPerMachine / ict) * estimate;
    capacity.set(m.currentProductId, (capacity.get(m.currentProductId) ?? 0) + machineCapacity);
  }
  return capacity;
};

/** Split one product's daily demand into 3-6 orders, qty via a triangular-shaped weight draw, customers from the seeded 8-name pool (no repeats within a day, since numOrders <= 6 < 8). */
const splitIntoOrders = (
  rng: Rng,
  totalQty: number,
  orderDate: Date,
  dueDate: Date,
  productId: string,
  idPrefix: string,
): GeneratedOrder[] => {
  if (totalQty <= 0) return [];
  const numOrders = Math.max(3, Math.min(6, Math.round(rng.uniform(3, 6))));
  const weights = Array.from({ length: numOrders }, () => rng.triangular(0.5, 1, 1.5));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const customerPool = [...CUSTOMERS];
  const orders: GeneratedOrder[] = [];
  let allocated = 0;
  for (let i = 0; i < numOrders; i++) {
    const isLast = i === numOrders - 1;
    const share = isLast ? totalQty - allocated : Math.round((weights[i]! / weightSum) * totalQty);
    const qty = Math.max(1, share);
    allocated += qty;

    const custIdx = Math.floor(rng.next() * customerPool.length);
    const customer = customerPool.splice(custIdx, 1)[0]!;

    orders.push({ id: `${idPrefix}-${i}`, productId, customer, qtyOrdered: qty, orderDate, dueDate });
  }
  return orders;
};

/**
 * Pure, DB-free core: generate the deterministic order book for one sim-day.
 * orderDate = day start; dueDate = day end + 1 sim-day lead time (i.e. day
 * start + 2 days).
 */
export const generateOrdersForDay = (params: GenerateOrdersParams): GeneratedOrder[] => {
  const { simDay, seed, products, machines, shifts } = params;
  const dayMidnightMs = Date.parse(`${simDay}T00:00:00.000Z`);
  const pptSecPerMachine = dailyPptSec(dayMidnightMs, shifts);
  const ictByProduct = new Map(products.map((p) => [p.id, p.idealCycleTimeSec]));
  const capacity = capacityByProduct(machines, ictByProduct, pptSecPerMachine);

  const orderDate = new Date(dayMidnightMs);
  const dueDate = new Date(dayMidnightMs + 2 * MS_PER_DAY);

  const rng = makeDayRng(seed, simDay);
  const orders: GeneratedOrder[] = [];
  for (const product of products) {
    const cap = capacity.get(product.id) ?? 0;
    if (cap <= 0) continue;
    const demand = Math.round(cap * rng.uniform(0.85, 1.0));
    if (demand <= 0) continue;
    orders.push(...splitIntoOrders(rng, demand, orderDate, dueDate, product.id, `ORD-${simDay}-${product.id}`));
  }
  return orders;
};

/** Persist a generated order book — upsert by deterministic id, so re-running generation for an already-seeded day is idempotent (never duplicates rows). */
export const persistGeneratedOrders = async (db: Db, orders: GeneratedOrder[]): Promise<void> => {
  for (const o of orders) {
    const data = {
      productId: o.productId,
      customer: o.customer,
      qtyOrdered: o.qtyOrdered,
      orderDate: o.orderDate,
      dueDate: o.dueDate,
    };
    await db.customerOrder.upsert({ where: { id: o.id }, create: { id: o.id, ...data }, update: data });
  }
};

/** Generate + persist one sim-day's order book, unless it already exists (checked via orderDate presence — cheap indexed count, safe to call on every clock-poll tick). */
export const ensureOrdersGeneratedForDay = async (
  db: Db,
  simDay: string,
  seed: number,
): Promise<{ generated: boolean; count: number }> => {
  const orderDate = new Date(`${simDay}T00:00:00.000Z`);
  const existing = await db.customerOrder.count({ where: { orderDate } });
  if (existing > 0) return { generated: false, count: existing };

  const [products, machines, shifts] = await Promise.all([
    db.product.findMany({ select: { id: true, idealCycleTimeSec: true } }),
    db.machine.findMany({ select: { id: true, lineId: true, profile: true, currentProductId: true } }),
    db.shift.findMany(),
  ]);
  interface ShiftRow {
    id: string;
    name: string;
    startMin: number;
    endMin: number;
    breaks: unknown;
  }
  const shiftDefs: ShiftDef[] = (shifts as ShiftRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    startMin: s.startMin,
    endMin: s.endMin,
    breaks: s.breaks as { startMin: number; endMin: number }[],
  }));

  const orders = generateOrdersForDay({ simDay, seed, products, machines, shifts: shiftDefs });
  await persistGeneratedOrders(db, orders);
  return { generated: true, count: orders.length };
};

/**
 * Called on every worker clock-poll tick (main.ts). Backfills the pinned
 * warm-start day (2026-01-05) once, then ensures the current sim-day's
 * order book exists — both checks are cheap idempotent existence queries,
 * so calling this repeatedly is safe and is how "runs when a new sim-day
 * starts" is satisfied without a dedicated day-change event.
 */
export const ensureOrderBookSeeded = async (db: Db, seed: number, currentSimDay: string): Promise<void> => {
  if (currentSimDay !== WARM_START_DAY) {
    await ensureOrdersGeneratedForDay(db, WARM_START_DAY, seed);
  }
  await ensureOrdersGeneratedForDay(db, currentSimDay, seed);
};
