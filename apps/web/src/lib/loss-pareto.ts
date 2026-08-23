/**
 * v_loss_pareto rows -> Pareto bucket transform (04-03-PLAN.md Task 1,
 * DASH-02). Isolated from the ECharts rendering component (same
 * "pure-core / component-shell" split as lib/oee-waterfall.ts and
 * lib/timeline-data.ts) so the sorted-descending + cumulative-% + per-shift
 * stack math is testable without a DOM/canvas.
 *
 * Deliberately self-contained (no `@/components/...` or `@linelens/contracts`
 * imports) — same dependency discipline as lib/timeline-data.ts and
 * lib/order-headline.ts, so this module never depends on the Next.js `@/`
 * path alias or a workspace package resolving correctly under vitest.
 * Reason labels / category labels are resolved by the CALLER (the API route
 * joins `reason_code`, same pattern order_loss_drilldown() already uses;
 * the component carries its own CATEGORY_LABELS constant, same as
 * orders/[id]/page.tsx).
 */

export interface LossParetoRowLike {
  reasonCode: string;
  category: string;
  reasonLabel: string;
  shiftId: string;
  lostTimeSec: number;
  lostUnits: number | null;
}

export interface ParetoBucket {
  /** reasonCode when groupBy==="reason", category when groupBy==="category". */
  key: string;
  label: string;
  category: string;
  lostTimeMin: number;
  lostUnits: number;
  /** shiftId -> lost minutes, so the bars can stack per shift (verified "Pareto stackable per shift" pattern). */
  byShiftMin: Record<string, number>;
  /** Running share of the grand total, 0-100, after this bucket (classic Pareto cumulative line). */
  cumulativePct: number;
}

export interface ParetoSeries {
  /** Distinct shiftIds present in the input, sorted ascending (e.g. ["S1","S2"]). */
  shiftIds: string[];
  /** Sorted descending by lostTimeMin. */
  buckets: ParetoBucket[];
}

export type ParetoGroupBy = "reason" | "category";

const secToMin = (sec: number): number => sec / 60;

/**
 * Groups rows by reasonCode or category, sums lostTimeSec/lostUnits per
 * group AND per shift within the group, sorts descending by total, and
 * computes the running cumulative-% line. Grouping "by category" naturally
 * reconciles to the same grand total as "by reason" (same input rows, just
 * a coarser key) — this is what the plan's <verify> "stack toggle by shift
 * sums to the same totals" checks.
 */
export function deriveParetoSeries(rows: LossParetoRowLike[], groupBy: ParetoGroupBy): ParetoSeries {
  const shiftIds = Array.from(new Set(rows.map((r) => r.shiftId))).sort();

  const byKey = new Map<string, ParetoBucket>();
  for (const row of rows) {
    const key = groupBy === "reason" ? row.reasonCode : row.category;
    const label = groupBy === "reason" ? row.reasonLabel : row.category;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { key, label, category: row.category, lostTimeMin: 0, lostUnits: 0, byShiftMin: {}, cumulativePct: 0 };
      byKey.set(key, bucket);
    }
    const min = secToMin(row.lostTimeSec);
    bucket.lostTimeMin += min;
    bucket.lostUnits += row.lostUnits ?? 0;
    bucket.byShiftMin[row.shiftId] = (bucket.byShiftMin[row.shiftId] ?? 0) + min;
  }

  const buckets = Array.from(byKey.values()).sort((a, b) => b.lostTimeMin - a.lostTimeMin || a.key.localeCompare(b.key));
  const grandTotalMin = buckets.reduce((sum, b) => sum + b.lostTimeMin, 0);

  let runningMin = 0;
  for (const bucket of buckets) {
    runningMin += bucket.lostTimeMin;
    bucket.cumulativePct = grandTotalMin > 0 ? (runningMin / grandTotalMin) * 100 : 0;
  }

  return { shiftIds, buckets };
}
