import { db } from "@/lib/db";
import { parseDayParam } from "@/lib/day-param";

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
 *
 * Calendar validity (not just shape) is enforced upstream by
 * `parseDayParam()` (T-04, 04-SECURITY.md) — a calendar-invalid but
 * shape-matching value like `2026-02-30` is rejected with 400 before it
 * can reach the `::date` cast below, so that cast can no longer receive a
 * rollover value.
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
  const parsedDay = parseDayParam(searchParams.get("day"));

  if (!parsedDay) {
    return Response.json(
      { error: "day query param must be a real calendar date in YYYY-MM-DD form" },
      { status: 400 },
    );
  }

  const { day, yesterday } = parsedDay;

  const [orders, difotRows, difotYesterdayRows, byLineRows] = await Promise.all([
    db.$queryRaw<OrderStatusRow[]>`
      SELECT * FROM v_order_status
      WHERE "dueDate"::date = ${day}::date
      ORDER BY "dueDate" ASC, "orderId" ASC
    `,
    db.$queryRaw<DifotRow[]>`SELECT * FROM v_difot WHERE "dueDay" = ${day}`,
    db.$queryRaw<DifotRow[]>`SELECT * FROM v_difot WHERE "dueDay" = ${yesterday}`,
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
