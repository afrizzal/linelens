import { db } from "@/lib/db";

/**
 * GET /api/orders?day=YYYY-MM-DD — v_order_status rows due on that sim-day,
 * the day's v_difot summary (+ yesterday's, for the trend delta), and the
 * per-line v_difot_line contribution (packages/db/src/views.sql, 04-01-PLAN.md
 * Task 2/3).
 *
 * N/A semantics (project rule, enforced elsewhere at
 * apps/web/src/app/api/andon/route.ts): a due-day with zero orders due is
 * simply ABSENT from v_difot — `difot`/`difotYesterday` are `null` rather
 * than a false 0%; the UI must render N/A, never 0%.
 *
 * `day` binds as a plain calendar-date string (not a Date object), so the
 * Phase-02 "always bind ISO 'Z' strings, never Date objects" raw-pg rule
 * doesn't apply here — that rule is specifically about naive TIMESTAMP
 * columns' local-OS-TZ-dependent Date serialization; a bare date literal
 * compared via `::date` has no time-of-day component to misinterpret.
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

interface DifotRow {
  dueDay: string;
  totalDue: number;
  onTimeCount: number;
  difotPct: number | null;
}

interface DifotLineRow extends DifotRow {
  lineId: string;
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const day = searchParams.get("day");

  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json({ error: "day query param is required (YYYY-MM-DD)" }, { status: 400 });
  }

  const yesterday = new Date(`${day}T00:00:00.000Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const [orders, difotRows, difotYesterdayRows, byLineRows] = await Promise.all([
    db.$queryRaw<OrderStatusRow[]>`
      SELECT * FROM v_order_status
      WHERE "dueDate"::date = ${day}::date
      ORDER BY "dueDate" ASC, "orderId" ASC
    `,
    db.$queryRaw<DifotRow[]>`SELECT * FROM v_difot WHERE "dueDay" = ${day}`,
    db.$queryRaw<DifotRow[]>`SELECT * FROM v_difot WHERE "dueDay" = ${yesterdayStr}`,
    db.$queryRaw<DifotLineRow[]>`SELECT * FROM v_difot_line WHERE "dueDay" = ${day} ORDER BY "lineId" ASC`,
  ]);

  return Response.json({
    day,
    difot: difotRows[0] ?? null,
    difotYesterday: difotYesterdayRows[0] ?? null,
    byLine: byLineRows,
    orders,
  });
}
