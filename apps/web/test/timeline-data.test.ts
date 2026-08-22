import { describe, expect, it } from "vitest";
import { deriveBreakRanges, deriveGanttData } from "../src/lib/timeline-data";

/**
 * 03-03-PLAN.md Task 1 <verify>: "Component test with a fixture of 6
 * intervals renders 6 rects with correct token colors". The actual ECharts
 * canvas rendering isn't practically testable under vitest+jsdom (no real
 * canvas/getBoundingClientRect), so this exercises the pure
 * intervals->Gantt-row transform the renderItem/data pipeline is built on —
 * category-index resolution, open-interval extension to sim-time (never
 * Date.now()), and duration math. Token-color correctness is verified by
 * construction (the Gantt component calls the SAME stateColor() helper
 * andon/waterfall already use) plus the live-in-docker visual check.
 */
describe("deriveGanttData", () => {
  it("derives category indices, open-interval extension, and durations from a 6-interval fixture across 2 machines", () => {
    const shiftStartMs = Date.UTC(2026, 0, 6, 7, 0, 0);
    const min = 60_000;
    const intervals = [
      {
        machineId: "L2-M1",
        state: "EXECUTE",
        start: new Date(shiftStartMs).toISOString(),
        end: new Date(shiftStartMs + 30 * min).toISOString(),
        reasonCode: null,
        injected: false,
      },
      {
        machineId: "L2-M1",
        state: "DOWN",
        start: new Date(shiftStartMs + 30 * min).toISOString(),
        end: new Date(shiftStartMs + 45 * min).toISOString(),
        reasonCode: "BRK-ELEC",
        injected: false,
      },
      {
        machineId: "L2-M1",
        state: "EXECUTE",
        start: new Date(shiftStartMs + 45 * min).toISOString(),
        end: null,
        reasonCode: null,
        injected: false,
      },
      {
        machineId: "L2-M2",
        state: "EXECUTE",
        start: new Date(shiftStartMs).toISOString(),
        end: new Date(shiftStartMs + 60 * min).toISOString(),
        reasonCode: null,
        injected: false,
      },
      {
        machineId: "L2-M2",
        state: "CHANGEOVER",
        start: new Date(shiftStartMs + 60 * min).toISOString(),
        end: new Date(shiftStartMs + 75 * min).toISOString(),
        reasonCode: "CO-PRODUCT",
        injected: false,
      },
      {
        machineId: "L2-M2",
        state: "DOWN",
        start: new Date(shiftStartMs + 75 * min).toISOString(),
        end: null,
        reasonCode: "BRK-MECH",
        injected: true,
      },
    ];
    const openEndMs = shiftStartMs + 90 * min;

    const { machineIds, rows } = deriveGanttData(intervals, openEndMs);

    expect(machineIds).toEqual(["L2-M1", "L2-M2"]);
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.machineId === "L2-M1").every((r) => r.categoryIndex === 0)).toBe(true);
    expect(rows.filter((r) => r.machineId === "L2-M2").every((r) => r.categoryIndex === 1)).toBe(true);

    // Open intervals (end===null) extend to openEndMs (sim-time-derived), never Date.now().
    const openRunning = rows.find((r) => r.machineId === "L2-M1" && r.startMs === shiftStartMs + 45 * min);
    expect(openRunning?.endMs).toBe(openEndMs);

    const injectedRow = rows.find((r) => r.injected);
    expect(injectedRow?.machineId).toBe("L2-M2");
    expect(injectedRow?.reasonCode).toBe("BRK-MECH");
    expect(injectedRow?.endMs).toBe(openEndMs);

    // Durations reconcile with start/end (min-resolution fixture -> exact minutes).
    const downRow = rows.find((r) => r.reasonCode === "BRK-ELEC");
    expect(downRow?.durationMin).toBeCloseTo(15, 6);
    const changeoverRow = rows.find((r) => r.reasonCode === "CO-PRODUCT");
    expect(changeoverRow?.durationMin).toBeCloseTo(15, 6);
  });
});

describe("deriveBreakRanges", () => {
  it("converts ISO break windows to sorted absolute [start,end] ms pairs", () => {
    const breaks = [
      { start: "2026-01-06T09:30:00.000Z", end: "2026-01-06T09:45:00.000Z" },
      { start: "2026-01-06T07:30:00.000Z", end: "2026-01-06T07:45:00.000Z" },
    ];
    const ranges = deriveBreakRanges(breaks);
    expect(ranges).toEqual([
      [Date.parse("2026-01-06T07:30:00.000Z"), Date.parse("2026-01-06T07:45:00.000Z")],
      [Date.parse("2026-01-06T09:30:00.000Z"), Date.parse("2026-01-06T09:45:00.000Z")],
    ]);
  });
});
