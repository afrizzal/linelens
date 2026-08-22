import { db } from "@/lib/db";

/**
 * GET /api/andon — per line: current state + reasonCode + since, good count
 * this shift, and target count (verified Vorne TAED-style andon minimum:
 * state + good + target, PITFALLS.md UX baseline).
 *
 * Each line has MULTIPLE machines (plant.config.json: 2 per line) producing
 * IN PARALLEL, so:
 *   - "line state" = the WORST open state_interval across its machines
 *     (DOWN > CHANGEOVER > BREAK > EXECUTE), tie-broken by earliest start —
 *     standard andon convention: a line reads as down if any machine is
 *     down, matching "downtime = broken customer promises".
 *   - "target count" = SUM over the line's machines of
 *     floor(PPT_elapsed_sec / machine_current_ICT) — a single-ICT-per-line
 *     formula would undercount target ~2x and pin the andon progress bar
 *     above 100% (03-01-PLAN.md Task 2). This is a demo pacing target, not
 *     a claimed industry-standard metric.
 *
 * "Current shift" is resolved as the shift instance whose [shiftStart,
 * shiftEnd) window contains the current sim time — this is the ONE place
 * in this route that compares directly against the sim clock function, so
 * it carries the Phase-02 `sim_now() AT TIME ZONE 'UTC'` cast (see
 * views.sql, same line as the query below). If no
 * shift is currently active (between shifts), goodCount/targetCount are
 * `null` (N/A) rather than a false 0.
 *
 * 03-02-PLAN.md Task 2 deviation (Rule 2 - missing critical functionality):
 * the andon tile's "machines strip: small per-machine state dots" needs
 * every open interval per machine, not just the collapsed per-line worst
 * state this route originally returned. Rather than a second DISTINCT-ON
 * query, the open-interval query below now returns ALL open intervals (one
 * per machine — cheap, a handful of rows at demo scale) and the worst-state
 * reduction moves into JS, preserving the exact same priority ordering
 * (DOWN > CHANGEOVER > BREAK > EXECUTE, earliest-start tie-break) while also
 * exposing the full per-machine array as `machines`.
 */
export const dynamic = "force-dynamic";

interface CurrentShiftRow {
  shiftDate: string;
  shiftId: string;
  shiftStart: Date;
  effectiveEnd: Date;
  pptSec: number;
}

interface OpenIntervalRow {
  lineId: string;
  machineId: string;
  state: string;
  reasonCode: string | null;
  since: Date;
}

interface GoodCountRow {
  lineId: string;
  goodCnt: number | null;
}

export async function GET(): Promise<Response> {
  const [currentShiftRows, lines, openIntervals, machines] = await Promise.all([
    db.$queryRaw<CurrentShiftRow[]>`
      SELECT "shiftDate", "shiftId", "shiftStart", "effectiveEnd", "pptSec"
      FROM v_shift_windows
      WHERE "shiftStart" <= (sim_now() AT TIME ZONE 'UTC')
        AND "shiftEnd" > (sim_now() AT TIME ZONE 'UTC')
      LIMIT 1
    `,
    db.line.findMany({ orderBy: { id: "asc" } }),
    db.$queryRaw<OpenIntervalRow[]>`
      SELECT
        si."lineId" AS "lineId", si."machineId" AS "machineId", si.state AS state,
        si."reasonCode" AS "reasonCode", si."startTime" AS since
      FROM state_interval si
      WHERE si."endTime" IS NULL
      ORDER BY si."lineId", si."machineId"
    `,
    db.machine.findMany({
      select: { id: true, lineId: true, product: { select: { idealCycleTimeSec: true } } },
    }),
  ]);

  const currentShift = currentShiftRows[0] ?? null;

  let goodCounts: GoodCountRow[] = [];
  if (currentShift) {
    goodCounts = await db.$queryRaw<GoodCountRow[]>`
      SELECT "lineId" AS "lineId", SUM(COALESCE("goodDelta", 0))::double precision AS "goodCnt"
      FROM machine_event
      WHERE kind = 'COUNTS'
        AND "simTime" >= ${currentShift.shiftStart}
        AND "simTime" < ${currentShift.effectiveEnd}
      GROUP BY "lineId"
    `;
  }

  const STATE_PRIORITY: Record<string, number> = { DOWN: 0, CHANGEOVER: 1, BREAK: 2, EXECUTE: 3 };
  const worstOf = (rows: OpenIntervalRow[]): OpenIntervalRow | null => {
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => {
      const pa = STATE_PRIORITY[a.state] ?? 4;
      const pb = STATE_PRIORITY[b.state] ?? 4;
      if (pa !== pb) return pa - pb;
      return a.since.getTime() - b.since.getTime();
    })[0];
  };

  const goodByLine = new Map(goodCounts.map((r) => [r.lineId, r.goodCnt ?? 0]));
  const openIntervalsByLine = new Map<string, OpenIntervalRow[]>();
  for (const row of openIntervals) {
    const arr = openIntervalsByLine.get(row.lineId) ?? [];
    arr.push(row);
    openIntervalsByLine.set(row.lineId, arr);
  }
  const ictsByLine = new Map<string, number[]>();
  for (const m of machines) {
    const ict = m.product?.idealCycleTimeSec;
    if (ict == null) continue;
    const arr = ictsByLine.get(m.lineId) ?? [];
    arr.push(ict);
    ictsByLine.set(m.lineId, arr);
  }

  const result = lines.map((line) => {
    const lineIntervals = openIntervalsByLine.get(line.id) ?? [];
    const open = worstOf(lineIntervals);
    const icts = ictsByLine.get(line.id) ?? [];
    const targetCount = currentShift
      ? icts.reduce((sum, ict) => sum + (ict > 0 ? Math.floor(currentShift.pptSec / ict) : 0), 0)
      : null;

    return {
      lineId: line.id,
      lineName: line.name,
      state: open?.state ?? null,
      reasonCode: open?.reasonCode ?? null,
      since: open?.since ? open.since.toISOString() : null,
      goodCount: currentShift ? (goodByLine.get(line.id) ?? 0) : null,
      targetCount,
      shiftDate: currentShift?.shiftDate ?? null,
      shiftId: currentShift?.shiftId ?? null,
      // Machines strip (03-02-PLAN.md Task 2 deviation, see file header).
      machines: lineIntervals
        .slice()
        .sort((a, b) => a.machineId.localeCompare(b.machineId))
        .map((m) => ({ machineId: m.machineId, state: m.state })),
    };
  });

  return Response.json(result);
}
