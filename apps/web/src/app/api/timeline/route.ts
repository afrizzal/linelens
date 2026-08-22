import { db } from "@/lib/db";

/**
 * GET /api/timeline?lineId&shiftDate&shiftId — state_interval rows for a
 * line's machines, clamped to the shift window, plus the shift's window
 * bounds and break windows (03-03-PLAN.md Task 1 deviation, Rule 2: the
 * timeline's "hatched background bands ... from shift calendar via API
 * metadata" requirement has no other source — 03-01's original response
 * shape was a bare interval array with no calendar metadata).
 *
 * Response shape changed from a bare array to `{ shiftStart, shiftEnd,
 * effectiveEnd, breaks, intervals }` — this route has no consumer yet
 * besides 03-03's own timeline page, so widening the contract here (rather
 * than adding a second endpoint) is safe.
 *
 * Sim-time comparison rule (Phase-02 contract): every clamp against the
 * sim clock must go through `sim_now() AT TIME ZONE 'UTC'`. This query
 * never calls the sim clock function directly — it clamps against
 * v_shift_windows's "shiftStart"/"effectiveEnd" columns
 * (packages/db/src/views.sql), which already apply that cast. Reusing the
 * view keeps the cast logic in ONE place instead of re-deriving it here.
 */
export const dynamic = "force-dynamic";

interface TimelineRow {
  machineId: string;
  state: string;
  start: Date;
  end: Date | null;
  reasonCode: string | null;
  injected: boolean;
}

interface ShiftWindowRow {
  shiftStart: Date;
  shiftEnd: Date;
  effectiveEnd: Date;
}

interface BreakRow {
  start: Date;
  end: Date;
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const lineId = searchParams.get("lineId");
  const shiftDate = searchParams.get("shiftDate");
  const shiftId = searchParams.get("shiftId");

  if (!lineId || !shiftDate || !shiftId) {
    return Response.json(
      { error: "lineId, shiftDate, and shiftId query params are all required" },
      { status: 400 },
    );
  }

  const [rows, windowRows, breakRows] = await Promise.all([
    db.$queryRaw<TimelineRow[]>`
      SELECT
        si."machineId" AS "machineId",
        si.state AS state,
        GREATEST(si."startTime", sw."shiftStart") AS start,
        CASE WHEN si."endTime" IS NULL THEN NULL ELSE LEAST(si."endTime", sw."effectiveEnd") END AS "end",
        si."reasonCode" AS "reasonCode",
        si.injected AS injected
      FROM state_interval si
      JOIN v_shift_windows sw ON sw."shiftDate" = ${shiftDate} AND sw."shiftId" = ${shiftId}
      WHERE si."lineId" = ${lineId}
        AND si."startTime" < sw."effectiveEnd"
        AND COALESCE(si."endTime", sw."effectiveEnd") > sw."shiftStart"
      ORDER BY si."machineId" ASC, si."startTime" ASC
    `,
    db.$queryRaw<ShiftWindowRow[]>`
      SELECT "shiftStart", "shiftEnd", "effectiveEnd"
      FROM v_shift_windows
      WHERE "shiftDate" = ${shiftDate} AND "shiftId" = ${shiftId}
      LIMIT 1
    `,
    // Break windows as absolute sim-time ranges, reusing the exact
    // dayMidnight + make_interval(mins => ...) expansion views.sql's
    // break_overlap_seconds() uses internally — same computation, so the
    // timeline's hatched bands can never drift from the PPT calculation.
    db.$queryRaw<BreakRow[]>`
      SELECT
        (sw."dayMidnight" + make_interval(mins => (b->>'startMin')::int)) AS start,
        (sw."dayMidnight" + make_interval(mins => (b->>'endMin')::int)) AS "end"
      FROM v_shift_windows sw
      CROSS JOIN LATERAL jsonb_array_elements(sw."breaksJson") AS b
      WHERE sw."shiftDate" = ${shiftDate} AND sw."shiftId" = ${shiftId}
      ORDER BY start ASC
    `,
  ]);

  const shiftWindow = windowRows[0] ?? null;

  return Response.json({
    shiftStart: shiftWindow ? shiftWindow.shiftStart.toISOString() : null,
    shiftEnd: shiftWindow ? shiftWindow.shiftEnd.toISOString() : null,
    effectiveEnd: shiftWindow ? shiftWindow.effectiveEnd.toISOString() : null,
    breaks: breakRows.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString() })),
    intervals: rows.map((r) => ({
      machineId: r.machineId,
      state: r.state,
      start: r.start.toISOString(),
      end: r.end ? r.end.toISOString() : null,
      reasonCode: r.reasonCode,
      injected: r.injected,
    })),
  });
}
