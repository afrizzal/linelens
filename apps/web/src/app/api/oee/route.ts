import { db } from "@/lib/db";

/**
 * GET /api/oee?lineId&shiftDate&shiftId — line + machine rows from
 * v_line_shift_oee / v_machine_shift_oee (packages/db/src/views.sql), the
 * credibility-gate views: A/P/Q/OEE + waterfall buckets (a/p/q loss
 * seconds), ictMisconfigured (a FLAG, never a clamp — Performance is never
 * capped at 1.0 anywhere).
 *
 * N/A semantics (PITFALLS.md Pitfall 2): a (machine|line, shift) pair with
 * zero events is simply ABSENT from the view — never a zero-filled row.
 * `line` below is `null` when absent; the UI must render N/A, never 0%.
 */
export const dynamic = "force-dynamic";

interface LineOeeRow {
  lineId: string;
  shiftDate: string;
  shiftId: string;
  pptSec: number;
  downSec: number;
  changeoverSec: number;
  runSec: number;
  totalCnt: number;
  goodCnt: number;
  ictSec: number;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
}

interface MachineOeeRow extends LineOeeRow {
  machineId: string;
  ictMisconfigured: boolean | null;
  aLossSec: number;
  pLossSec: number;
  qLossSec: number;
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

  const [lineRows, machineRows] = await Promise.all([
    db.$queryRaw<LineOeeRow[]>`
      SELECT * FROM v_line_shift_oee
      WHERE "lineId" = ${lineId} AND "shiftDate" = ${shiftDate} AND "shiftId" = ${shiftId}
    `,
    db.$queryRaw<MachineOeeRow[]>`
      SELECT * FROM v_machine_shift_oee
      WHERE "lineId" = ${lineId} AND "shiftDate" = ${shiftDate} AND "shiftId" = ${shiftId}
      ORDER BY "machineId" ASC
    `,
  ]);

  return Response.json({
    line: lineRows[0] ?? null,
    machines: machineRows,
  });
}
