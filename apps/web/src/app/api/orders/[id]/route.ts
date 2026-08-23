import { db } from "@/lib/db";

/**
 * GET /api/orders/[id] — one order's v_order_status row, its allocation
 * list, AND the money-shot drill-down (04-02-PLAN.md Task 2): ranked
 * loss_event rows from order_loss_drilldown() (packages/db/src/views.sql,
 * Task 1) plus the order's shortUnits/totalEstLostUnits shortfall context,
 * enriched with human-readable line names (a cheap extra `line` lookup —
 * the SQL function deliberately stays scoped to the loss ledger + order
 * facts, not display strings).
 *
 * WEB CONVENTIONS (Phase 03, restated in 04-02-PLAN.md Task 2): reaches
 * Prisma through the lib/db.ts singleton (never a per-request
 * PrismaClient); no Date objects are bound as raw-pg parameters anywhere
 * in this file (only `id`, a plain string, is bound) so the CR-01
 * local-OS-TZ Date-serialization footgun doesn't apply here.
 */
export const dynamic = "force-dynamic";

interface OrderStatusRow {
  orderId: string;
  productId: string;
  customer: string;
  qtyOrdered: number;
  orderDate: Date;
  dueDate: Date;
  shippedAt: Date | null;
  allocatedQty: number;
  remainingQty: number;
  projectedFinish: Date;
  status: string;
}

interface AllocationRow {
  id: string;
  lineId: string;
  machineId: string;
  qty: number;
  producedAt: Date;
}

/**
 * Raw shape of order_loss_drilldown() — every row carries shortUnits/
 * totalEstLostUnits (denormalized, see views.sql doc); category/reasonLabel/
 * etc. are NULL on the single placeholder row a zero-loss order still
 * returns (the LEFT JOIN ctx guarantee documented on the function).
 */
interface DrilldownRow {
  category: string | null;
  reasonLabel: string | null;
  machineId: string | null;
  lineId: string | null;
  windowStart: Date | null;
  windowEnd: Date | null;
  lostTimeSec: number | null;
  estLostUnits: number | null;
  injected: boolean | null;
  shiftDate: string | null;
  shiftId: string | null;
  shortUnits: number;
  totalEstLostUnits: number;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;

  const [orderRows, allocations, drilldownRows] = await Promise.all([
    db.$queryRaw<OrderStatusRow[]>`SELECT * FROM v_order_status WHERE "orderId" = ${id}`,
    db.$queryRaw<AllocationRow[]>`
      SELECT id, "lineId", "machineId", qty, "producedAt"
      FROM allocation
      WHERE "orderId" = ${id}
      ORDER BY "producedAt" ASC
    `,
    db.$queryRaw<DrilldownRow[]>`SELECT * FROM order_loss_drilldown(${id})`,
  ]);

  const order = orderRows[0] ?? null;
  if (!order) {
    return Response.json({ error: "order not found" }, { status: 404 });
  }

  // Line display names — a handful of rows, cheap to fetch in full rather
  // than building an IN-list (the master `line` table never exceeds a
  // handful of rows in this appliance).
  const lines = await db.line.findMany({ select: { id: true, name: true } });
  const lineNameById = new Map(lines.map((l) => [l.id, l.name]));

  const losses = drilldownRows
    .filter((r): r is DrilldownRow & { category: string; lineId: string } => r.category !== null && r.lineId !== null)
    .map((r) => ({
      category: r.category,
      reasonLabel: r.reasonLabel,
      machineId: r.machineId,
      lineId: r.lineId,
      lineName: lineNameById.get(r.lineId) ?? r.lineId,
      windowStart: r.windowStart,
      windowEnd: r.windowEnd,
      lostTimeSec: r.lostTimeSec,
      estLostUnits: r.estLostUnits,
      injected: r.injected,
      shiftDate: r.shiftDate,
      shiftId: r.shiftId,
    }));

  // ctx (order_drilldown_context) always contributes at least one row via
  // the LEFT JOIN — shortUnits/totalEstLostUnits are populated regardless
  // of whether any loss rows matched.
  const shortUnits = drilldownRows[0]?.shortUnits ?? 0;
  const totalEstLostUnits = drilldownRows[0]?.totalEstLostUnits ?? 0;

  return Response.json({
    order,
    allocations: allocations.map((a) => ({ ...a, lineName: lineNameById.get(a.lineId) ?? a.lineId })),
    losses,
    shortUnits,
    totalEstLostUnits,
  });
}
