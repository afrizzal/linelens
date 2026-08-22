/**
 * Line-level A×P×Q waterfall bucket derivation (03-02-PLAN.md Task 3).
 *
 * v_line_shift_oee (packages/db/src/views.sql) exposes the AGGREGATE-OF-SUMS
 * pptSec/runSec/ictSec/goodCnt/totalCnt for a line/shift, but does NOT carry
 * aLossSec/pLossSec/qLossSec/ictMisconfigured columns — those only exist on
 * v_machine_shift_oee. Rather than adding line-level loss columns to the
 * credibility-gate SQL views (a schema/migration change, out of scope for a
 * UI plan — Rule 4 territory), this module applies the EXACT SAME three
 * formulas views.sql already uses per-machine to the line's own aggregated
 * sums:
 *   aLossSec = pptSec - runSec
 *   pLossSec = max(0, runSec - ictSec)
 *   qLossSec = ictSec * (1 - quality)
 * Because v_line_shift_oee sums pptSec/runSec/ictSec/goodCnt/totalCnt BEFORE
 * dividing (not an average of per-machine ratios), applying these formulas
 * to the summed inputs reconciles with the SAME identity the SQL view
 * documents: PPT - aLoss - pLoss - qLoss = productive (runSec, minus any
 * quality loss expressed in ICT-equivalent seconds).
 *
 * kept isolated from the ECharts rendering component per 03-02-PLAN.md
 * Task 3 ("keep chart code isolated in components") — this is pure
 * arithmetic, testable without a DOM/canvas.
 */

export interface LineOeeLike {
  pptSec: number;
  runSec: number;
  ictSec: number;
  goodCnt: number;
  totalCnt: number;
  quality: number | null;
}

export interface WaterfallBuckets {
  pptMin: number;
  aLossMin: number;
  pLossMin: number;
  qLossMin: number;
  productiveMin: number;
  /** Each loss bucket's share of PPT, 0-100 (null when pptSec is 0 — N/A shift). */
  aLossPct: number | null;
  pLossPct: number | null;
  qLossPct: number | null;
  productivePct: number | null;
}

const secToMin = (sec: number): number => sec / 60;

export const deriveWaterfallBuckets = (line: LineOeeLike): WaterfallBuckets => {
  const aLossSec = line.pptSec - line.runSec;
  const pLossSec = Math.max(0, line.runSec - line.ictSec);
  const qualityRatio = line.quality ?? (line.totalCnt > 0 ? line.goodCnt / line.totalCnt : 0);
  const qLossSec = line.ictSec * (1 - qualityRatio);
  const productiveSec = Math.max(0, line.pptSec - aLossSec - pLossSec - qLossSec);

  const pptPct = (sec: number): number | null => (line.pptSec > 0 ? (sec / line.pptSec) * 100 : null);

  return {
    pptMin: secToMin(line.pptSec),
    aLossMin: secToMin(aLossSec),
    pLossMin: secToMin(pLossSec),
    qLossMin: secToMin(qLossSec),
    productiveMin: secToMin(productiveSec),
    aLossPct: pptPct(aLossSec),
    pLossPct: pptPct(pLossSec),
    qLossPct: pptPct(qLossSec),
    productivePct: pptPct(productiveSec),
  };
};
