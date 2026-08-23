import { db } from "@/lib/db";

/**
 * GET /api/losses?lineId&day — v_loss_pareto rows for one line/sim-day,
 * grouped per (category, reasonCode, shiftId) with a human reasonLabel
 * joined from `reason_code` (packages/db/src/views.sql, same table
 * order_loss_drilldown() already joins for the exact same purpose — 04-03-
 * PLAN.md Task 1, DASH-02).
 *
 * Sorting/cumulative-% math happens client-side in lib/loss-pareto.ts (the
 * caller needs BOTH "by reason" and "by category" groupings from the same
 * raw rows for the toggle, so it's cheaper to derive both client-side than
 * to run two SQL queries).
 *
 * N/A semantics (project rule, apps/web/src/app/api/andon/route.ts): a
 * line/day with zero loss_event rows just returns an empty `rows` array —
 * the page renders the "let the plant run" empty state, never a false 0.
 */
export const dynamic = "force-dynamic";

interface LossParetoRow {
  lineId: string;
  category: string;
  reasonCode: string;
  reasonLabel: string;
  shiftId: string;
  lostTimeSec: number;
  lostUnits: number | null;
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const lineId = searchParams.get("lineId");
  const day = searchParams.get("day");

  if (!lineId || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return Response.json({ error: "lineId and day (YYYY-MM-DD) query params are required" }, { status: 400 });
  }

  const rows = await db.$queryRaw<LossParetoRow[]>`
    SELECT
      lp."lineId" AS "lineId",
      lp.category AS category,
      lp."reasonCode" AS "reasonCode",
      COALESCE(rc.label, lp."reasonCode") AS "reasonLabel",
      lp."shiftId" AS "shiftId",
      lp."lostTimeSec" AS "lostTimeSec",
      lp."lostUnits" AS "lostUnits"
    FROM v_loss_pareto lp
    LEFT JOIN reason_code rc ON rc.code = lp."reasonCode"
    WHERE lp."lineId" = ${lineId} AND lp."shiftDate" = ${day}
    ORDER BY lp."reasonCode" ASC, lp."shiftId" ASC
  `;

  return Response.json({ lineId, day, rows });
}
