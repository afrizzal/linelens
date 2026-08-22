import { describe, expect, it } from "vitest";
import { deriveWaterfallBuckets } from "../src/lib/oee-waterfall";

/**
 * 03-02-PLAN.md Task 3 <verify>: "Waterfall totals reconcile: PPT − a − p −
 * q = productive (assert in a component test with fixture data)". Golden
 * values hand-computed from the same three formulas views.sql uses
 * per-machine (03-02-SUMMARY.md deviation note / lib/oee-waterfall.ts).
 */
describe("deriveWaterfallBuckets", () => {
  it("reconciles PPT - aLoss - pLoss - qLoss = productive (hand-computed fixture)", () => {
    // 8h shift (480 min = 28800s); runSec = 24000s -> 4800s (80min) Availability loss.
    // ictSec (sum of per-event ICT*count) = 20000s -> 4000s (66.667min) Performance loss.
    // quality = 950/1000 = 0.95 -> qLossSec = 20000 * 0.05 = 1000s (16.667min).
    const line = { pptSec: 28800, runSec: 24000, ictSec: 20000, goodCnt: 950, totalCnt: 1000, quality: 0.95 };
    const buckets = deriveWaterfallBuckets(line);

    expect(buckets.pptMin).toBeCloseTo(480, 5);
    expect(buckets.aLossMin).toBeCloseTo(80, 5);
    expect(buckets.pLossMin).toBeCloseTo(66.6667, 3);
    expect(buckets.qLossMin).toBeCloseTo(16.6667, 3);
    expect(buckets.productiveMin).toBeCloseTo(316.6667, 3);

    // The mandatory identity.
    const reconciled = buckets.aLossMin + buckets.pLossMin + buckets.qLossMin + buckets.productiveMin;
    expect(reconciled).toBeCloseTo(buckets.pptMin, 6);

    expect(buckets.aLossPct).toBeCloseTo(16.6667, 3);
    expect(buckets.pLossPct).toBeCloseTo(13.8889, 3);
    expect(buckets.qLossPct).toBeCloseTo(3.4722, 3);
    expect(buckets.productivePct).toBeCloseTo(65.9722, 3);
  });

  it("never renders a false 0% — pct fields are null when pptSec is 0 (N/A shift)", () => {
    const line = { pptSec: 0, runSec: 0, ictSec: 0, goodCnt: 0, totalCnt: 0, quality: null };
    const buckets = deriveWaterfallBuckets(line);

    expect(buckets.aLossPct).toBeNull();
    expect(buckets.pLossPct).toBeNull();
    expect(buckets.qLossPct).toBeNull();
    expect(buckets.productivePct).toBeNull();
  });

  it("floors Performance loss at 0 when runSec < ictSec (ENG-05: never a negative loss)", () => {
    // Mirrors views.sql's GREATEST(0, runSec - ictSec) — an overcounted ICT
    // (misconfigured, performance > 100%) must not produce a negative bar.
    const line = { pptSec: 3600, runSec: 3000, ictSec: 3600, goodCnt: 100, totalCnt: 100, quality: 1 };
    const buckets = deriveWaterfallBuckets(line);

    expect(buckets.pLossMin).toBe(0);
  });
});
