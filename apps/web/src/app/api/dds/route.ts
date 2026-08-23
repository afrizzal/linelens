import { db } from "@/lib/db";
import { deriveEscalations, generateDdsActions, type DdsDifotLineInput, type DdsEscalationLossInput, type DdsLossInput } from "@/lib/dds-actions";

/**
 * GET /api/dds?lineId? — DDS-01, the Daily Direction Setting content spec
 * (docs/00-domain-research.md §6): yesterday's safety/quality/delivery +
 * OEE + top loss, today's top-3 rule-generated actions, escalation status.
 * "Yesterday" = the last COMPLETED sim-day, resolved the same simple way
 * /api/orders resolves "yesterday" (sim-today's date minus 1 calendar day)
 * — this route's OWN sim-clock lookup (sim-tz-ok: the query below is
 * correctly `AT TIME ZONE 'UTC'`-cast), since there's no `day` query param
 * to derive it from.
 *
 * `lineId` is an OPTIONAL narrower scope for the sections that have real
 * per-line meaning (OEE aggregate, top loss, actions). Delivery (DIFOT) and
 * Escalations stay PLANT-WIDE regardless of `lineId` — the plan's own DDS
 * spec cites v_difot (plant-wide) for delivery, and a daily plant meeting
 * reviewing escalations wants the whole plant's exceptions, not one line's.
 *
 * PLANT OEE aggregation (04-03-PLAN.md Task 2): sums-of-components across
 * ALL machines for the day — A = Sum(run)/Sum(ppt), P = Sum(ict)/Sum(run),
 * Q = Sum(good)/Sum(total), OEE = A*P*Q — the SAME rule v_line_shift_oee
 * uses, just summed one level higher (both shifts, all lines/machines).
 * NEVER an average of per-line/per-shift ratios (that mis-weights a
 * machine/shift that ran for a different span than its peers).
 *
 * N/A NEVER 0 (project rule, apps/web/src/app/api/andon/route.ts): every
 * numeric field below is `null`, not `0`, when the underlying window has no
 * data (v_machine_shift_oee SUM() over zero rows returns NULL for every
 * column). The warm-start guarantees at least one completed sim-day, so
 * this should be rare in practice, but the payload contract still allows
 * it.
 */
export const dynamic = "force-dynamic";

// Warm-start day pinned by 01-03-PLAN.md / apps/worker/src/orders/generate.ts's
// WARM_START_DAY — duplicated here (not cross-app-imported, same class of
// issue Task 2's "WHERE actions.ts LIVES" note documents) because it is the
// synthetic safety counter's anchor date. Keep in sync if that pin ever moves.
const WARM_START_DAY = "2026-01-05";
// Seed 42 -> synthetic starting days-since-incident (04-03-PLAN.md Task 2):
// 147 on the pinned warm-start day, +1 per completed sim-day since. Labeled
// `synthetic: true` in the payload — this is demo data, never a real safety
// record.
const SAFETY_SEED_START_DAYS = 147;

interface PlantOeeAggRow {
  pptSec: number | null;
  runSec: number | null;
  ictSec: number | null;
  goodCnt: number | null;
  totalCnt: number | null;
}

interface PlantOee {
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  totalRejects: number | null;
}

function computePlantOee(agg: PlantOeeAggRow | undefined): PlantOee {
  if (!agg || agg.pptSec == null || agg.pptSec === 0) {
    return { availability: null, performance: null, quality: null, oee: null, totalRejects: null };
  }
  const runSec = agg.runSec ?? 0;
  const ictSec = agg.ictSec ?? 0;
  const goodCnt = agg.goodCnt ?? 0;
  const totalCnt = agg.totalCnt ?? 0;

  const availability = agg.pptSec > 0 ? runSec / agg.pptSec : null;
  const performance = runSec > 0 ? ictSec / runSec : null;
  const quality = totalCnt > 0 ? goodCnt / totalCnt : null;
  const oee = availability != null && performance != null && quality != null ? availability * performance * quality : null;
  const totalRejects = totalCnt > 0 ? totalCnt - goodCnt : null;

  return { availability, performance, quality, oee, totalRejects };
}

interface TopLossRow {
  lineId: string;
  category: string;
  reasonCode: string;
  reasonLabel: string;
  lostTimeSec: number;
}

interface ParetoRow {
  lineId: string;
  category: string;
  reasonCode: string;
  reasonLabel: string;
  lostTimeSec: number;
}

interface EscalationLossRow {
  lineId: string;
  reasonCode: string;
  reasonLabel: string;
  lostTimeSec: number;
}

interface DifotRow {
  totalDue: number;
  onTimeCount: number;
  difotPct: number | null;
}

interface DifotLineRow {
  lineId: string;
  difotPct: number | null;
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const lineId = searchParams.get("lineId");

  const nowRows = await db.$queryRaw<{ simNow: Date }[]>`SELECT (sim_now() AT TIME ZONE 'UTC') AS "simNow"`;
  const simNow = nowRows[0]?.simNow ?? null;
  if (!simNow) {
    return Response.json({ error: "sim clock not available yet" }, { status: 503 });
  }

  const currentSimDay = simNow.toISOString().slice(0, 10);
  const yesterdayDate = new Date(`${currentSimDay}T00:00:00.000Z`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);
  const dayBeforeDate = new Date(yesterdayDate);
  dayBeforeDate.setUTCDate(dayBeforeDate.getUTCDate() - 1);
  const dayBeforeStr = dayBeforeDate.toISOString().slice(0, 10);

  const [
    lines,
    oeeYesterdayRows,
    oeeDayBeforeRows,
    topLossRows,
    paretoRows,
    escalationLossRows,
    difotRows,
    lateOrderRows,
    difotLineRows,
  ] = await Promise.all([
    db.line.findMany({ select: { id: true, name: true } }),
    db.$queryRaw<PlantOeeAggRow[]>`
      SELECT
        SUM("pptSec")::double precision AS "pptSec",
        SUM("runSec")::double precision AS "runSec",
        SUM("ictSec")::double precision AS "ictSec",
        SUM("goodCnt")::double precision AS "goodCnt",
        SUM("totalCnt")::double precision AS "totalCnt"
      FROM v_machine_shift_oee
      WHERE "shiftDate" = ${yesterdayStr} AND (${lineId}::text IS NULL OR "lineId" = ${lineId}::text)
    `,
    db.$queryRaw<PlantOeeAggRow[]>`
      SELECT
        SUM("pptSec")::double precision AS "pptSec",
        SUM("runSec")::double precision AS "runSec",
        SUM("ictSec")::double precision AS "ictSec",
        SUM("goodCnt")::double precision AS "goodCnt",
        SUM("totalCnt")::double precision AS "totalCnt"
      FROM v_machine_shift_oee
      WHERE "shiftDate" = ${dayBeforeStr} AND (${lineId}::text IS NULL OR "lineId" = ${lineId}::text)
    `,
    db.$queryRaw<TopLossRow[]>`
      SELECT le."lineId" AS "lineId", le.category AS category, le."reasonCode" AS "reasonCode",
        COALESCE(rc.label, le."reasonCode") AS "reasonLabel", le."lostTimeSec" AS "lostTimeSec"
      FROM loss_event le
      LEFT JOIN reason_code rc ON rc.code = le."reasonCode"
      WHERE le."shiftDate" = ${yesterdayStr} AND (${lineId}::text IS NULL OR le."lineId" = ${lineId}::text)
      ORDER BY le."lostTimeSec" DESC
      LIMIT 1
    `,
    db.$queryRaw<ParetoRow[]>`
      SELECT lp."lineId" AS "lineId", lp.category AS category, lp."reasonCode" AS "reasonCode",
        COALESCE(rc.label, lp."reasonCode") AS "reasonLabel", lp."lostTimeSec" AS "lostTimeSec"
      FROM v_loss_pareto lp
      LEFT JOIN reason_code rc ON rc.code = lp."reasonCode"
      WHERE lp."shiftDate" = ${yesterdayStr} AND (${lineId}::text IS NULL OR lp."lineId" = ${lineId}::text)
    `,
    db.$queryRaw<EscalationLossRow[]>`
      SELECT le."lineId" AS "lineId", le."reasonCode" AS "reasonCode",
        COALESCE(rc.label, le."reasonCode") AS "reasonLabel", le."lostTimeSec" AS "lostTimeSec"
      FROM loss_event le
      LEFT JOIN reason_code rc ON rc.code = le."reasonCode"
      WHERE le."shiftDate" = ${yesterdayStr}
    `,
    db.$queryRaw<DifotRow[]>`SELECT "totalDue", "onTimeCount", "difotPct" FROM v_difot WHERE "dueDay" = ${yesterdayStr}`,
    db.$queryRaw<{ lateCount: number }[]>`
      SELECT COUNT(*)::int AS "lateCount" FROM v_order_status
      WHERE "dueDate"::date = ${yesterdayStr}::date AND status = 'LATE'
    `,
    db.$queryRaw<DifotLineRow[]>`SELECT "lineId", "difotPct" FROM v_difot_line WHERE "dueDay" = ${yesterdayStr}`,
  ]);

  const lineNameById = new Map(lines.map((l) => [l.id, l.name]));
  const lineName = (id: string): string => lineNameById.get(id) ?? id;

  const yesterdayOee = computePlantOee(oeeYesterdayRows[0]);
  const dayBeforeOee = computePlantOee(oeeDayBeforeRows[0]);
  const oeeDelta = yesterdayOee.oee != null && dayBeforeOee.oee != null ? yesterdayOee.oee - dayBeforeOee.oee : null;

  const topLoss = topLossRows[0]
    ? {
        lineId: topLossRows[0].lineId,
        lineName: lineName(topLossRows[0].lineId),
        category: topLossRows[0].category,
        reasonCode: topLossRows[0].reasonCode,
        reasonLabel: topLossRows[0].reasonLabel,
        lostTimeMin: topLossRows[0].lostTimeSec / 60,
      }
    : null;

  const actionInputs: DdsLossInput[] = paretoRows.map((r) => ({
    reasonCode: r.reasonCode,
    category: r.category,
    reasonLabel: r.reasonLabel,
    lineId: r.lineId,
    lineName: lineName(r.lineId),
    lostTimeSec: r.lostTimeSec,
  }));
  const actions = generateDdsActions(actionInputs, 3);

  const escalationLossInputs: DdsEscalationLossInput[] = escalationLossRows.map((r) => ({
    lineId: r.lineId,
    lineName: lineName(r.lineId),
    reasonCode: r.reasonCode,
    reasonLabel: r.reasonLabel,
    lostTimeSec: r.lostTimeSec,
  }));
  const difotLineInputs: DdsDifotLineInput[] = difotLineRows.map((r) => ({
    lineId: r.lineId,
    lineName: lineName(r.lineId),
    difotPct: r.difotPct,
  }));
  const escalations = deriveEscalations(escalationLossInputs, difotLineInputs);

  const diffDays = Math.round(
    (new Date(`${yesterdayStr}T00:00:00.000Z`).getTime() - new Date(`${WARM_START_DAY}T00:00:00.000Z`).getTime()) /
      86_400_000,
  );
  const daysSinceIncident = SAFETY_SEED_START_DAYS + Math.max(0, diffDays);

  const difot = difotRows[0] ?? null;
  // N/A NEVER 0: COUNT(*) always returns a number (0), even when zero orders
  // were due yesterday -- unlike difotPct, which is genuinely absent (row-
  // absence) from v_difot on a zero-orders-due day. Gate lateCount on the
  // SAME "were any orders due" fact `difot` already encodes, so the tile
  // never shows a false "0 late orders" next to an honest DIFOT N/A (found
  // live against the docker stack: 2026-01-05 has zero orders due, since
  // due dates start a few days after the warm-start day).
  const lateCount = difot ? (lateOrderRows[0]?.lateCount ?? 0) : null;

  return Response.json({
    day: yesterdayStr,
    lineId: lineId ?? null,
    safety: { daysSinceIncident, synthetic: true },
    quality: { qualityPct: yesterdayOee.quality, totalRejects: yesterdayOee.totalRejects },
    delivery: {
      difotPct: difot?.difotPct ?? null,
      onTimeCount: difot?.onTimeCount ?? null,
      totalDue: difot?.totalDue ?? null,
      lateCount,
    },
    oee: { oee: yesterdayOee.oee, delta: oeeDelta },
    topLoss,
    actions,
    escalations,
  });
}
