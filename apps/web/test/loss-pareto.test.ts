import { describe, expect, it } from "vitest";
import { deriveParetoSeries, type LossParetoRowLike } from "../src/lib/loss-pareto";

/**
 * 04-03-PLAN.md Task 1 <verify>: "fixture reasons render sorted with
 * cumulative line reaching 100%; stack toggle by shift sums to the same
 * totals."
 */
const FIXTURE: LossParetoRowLike[] = [
  // BRK-MECH (UNPLANNED_STOPS): 40min S1 + 20min S2 = 60min total, biggest.
  { reasonCode: "BRK-MECH", category: "UNPLANNED_STOPS", reasonLabel: "Mechanical jam", shiftId: "S1", lostTimeSec: 2400, lostUnits: 0 },
  { reasonCode: "BRK-MECH", category: "UNPLANNED_STOPS", reasonLabel: "Mechanical jam", shiftId: "S2", lostTimeSec: 1200, lostUnits: 0 },
  // CO-PRODUCT (PLANNED_STOPS): 30min S1 only.
  { reasonCode: "CO-PRODUCT", category: "PLANNED_STOPS", reasonLabel: "Product changeover", shiftId: "S1", lostTimeSec: 1800, lostUnits: 0 },
  // RJ-DIM (PRODUCTION_REJECTS): 10min S2 only, smallest.
  { reasonCode: "RJ-DIM", category: "PRODUCTION_REJECTS", reasonLabel: "Dimensional defect", shiftId: "S2", lostTimeSec: 600, lostUnits: 12 },
];

describe("deriveParetoSeries", () => {
  it("sorts reasons descending by total lost time with a cumulative line reaching 100%", () => {
    const { shiftIds, buckets } = deriveParetoSeries(FIXTURE, "reason");

    expect(shiftIds).toEqual(["S1", "S2"]);
    expect(buckets.map((b) => b.key)).toEqual(["BRK-MECH", "CO-PRODUCT", "RJ-DIM"]);
    expect(buckets[0].lostTimeMin).toBeCloseTo(60, 6);
    expect(buckets[1].lostTimeMin).toBeCloseTo(30, 6);
    expect(buckets[2].lostTimeMin).toBeCloseTo(10, 6);

    // Cumulative %: 60/100=60, (60+30)/100=90, (60+30+10)/100=100.
    expect(buckets[0].cumulativePct).toBeCloseTo(60, 6);
    expect(buckets[1].cumulativePct).toBeCloseTo(90, 6);
    expect(buckets[2].cumulativePct).toBeCloseTo(100, 6);
  });

  it("per-shift breakdown sums to the bucket total (stack toggle by shift sums to the same totals)", () => {
    const { buckets } = deriveParetoSeries(FIXTURE, "reason");
    for (const bucket of buckets) {
      const shiftSum = Object.values(bucket.byShiftMin).reduce((a, b) => a + b, 0);
      expect(shiftSum).toBeCloseTo(bucket.lostTimeMin, 6);
    }
    const brkMech = buckets.find((b) => b.key === "BRK-MECH")!;
    expect(brkMech.byShiftMin.S1).toBeCloseTo(40, 6);
    expect(brkMech.byShiftMin.S2).toBeCloseTo(20, 6);
  });

  it("grouping by category reconciles to the SAME grand total as grouping by reason", () => {
    const byReason = deriveParetoSeries(FIXTURE, "reason");
    const byCategory = deriveParetoSeries(FIXTURE, "category");

    const reasonTotal = byReason.buckets.reduce((sum, b) => sum + b.lostTimeMin, 0);
    const categoryTotal = byCategory.buckets.reduce((sum, b) => sum + b.lostTimeMin, 0);
    expect(categoryTotal).toBeCloseTo(reasonTotal, 6);

    // Same 3 distinct categories as reasons in this fixture (1:1), so shape matches too.
    expect(byCategory.buckets).toHaveLength(3);
    expect(byCategory.buckets[byCategory.buckets.length - 1].cumulativePct).toBeCloseTo(100, 6);
  });

  it("returns an empty series (no divide-by-zero) for zero rows", () => {
    const { shiftIds, buckets } = deriveParetoSeries([], "reason");
    expect(shiftIds).toEqual([]);
    expect(buckets).toEqual([]);
  });

  it("aggregates lostUnits alongside lostTimeSec per bucket", () => {
    const { buckets } = deriveParetoSeries(FIXTURE, "reason");
    const rjDim = buckets.find((b) => b.key === "RJ-DIM")!;
    expect(rjDim.lostUnits).toBe(12);
  });
});
