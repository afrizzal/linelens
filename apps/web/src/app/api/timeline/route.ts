import { db } from "@/lib/db";

/**
 * GET /api/timeline?lineId&shiftDate&shiftId — state_interval rows for a
 * line's machines, clamped to the shift window.
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

  const rows = await db.$queryRaw<TimelineRow[]>`
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
  `;

  return Response.json(
    rows.map((r) => ({
      machineId: r.machineId,
      state: r.state,
      start: r.start.toISOString(),
      end: r.end ? r.end.toISOString() : null,
      reasonCode: r.reasonCode,
      injected: r.injected,
    })),
  );
}
