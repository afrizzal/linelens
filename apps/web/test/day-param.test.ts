import { describe, expect, it } from "vitest";
import { parseDayParam } from "../src/lib/day-param";

/**
 * quick/260823-o4c PLAN.md Task 1 -- regression coverage for T-04
 * (04-SECURITY.md). Two failure classes, live-confirmed against the
 * running compose stack before this fix existed:
 *
 *   - ROLLOVER class: "2026-02-30" satisfies the route's old
 *     `^\d{4}-\d{2}-\d{2}$` shape regex, but `new Date(...)` silently
 *     rolls it forward to Mar 2 -- reaches SQL, Postgres rejects the
 *     `::date` cast with 22008.
 *   - INVALID-DATE class: "2026-99-99" also satisfies the old shape
 *     regex, but produces an Invalid Date whose `.toISOString()` throws
 *     `RangeError: Invalid time value` BEFORE any SQL runs -- a
 *     DB-only try/catch would not have caught this class.
 *
 * These cases fail against pre-fix `main` because the route performed no
 * calendar validation at all -- both "2026-02-30" and "2026-99-99" were
 * accepted by the shape regex alone.
 */
describe("parseDayParam", () => {
  it("accepts a plain valid date and derives yesterday", () => {
    expect(parseDayParam("2026-01-05")).toEqual({ day: "2026-01-05", yesterday: "2026-01-04" });
  });

  it("derives yesterday across a non-leap-year month boundary (2026 is not a leap year)", () => {
    expect(parseDayParam("2026-03-01")).toEqual({ day: "2026-03-01", yesterday: "2026-02-28" });
  });

  it("derives yesterday across a leap-year boundary", () => {
    expect(parseDayParam("2024-03-01")).toEqual({ day: "2024-03-01", yesterday: "2024-02-29" });
  });

  it("derives yesterday across a year boundary", () => {
    expect(parseDayParam("2026-01-01")).toEqual({ day: "2026-01-01", yesterday: "2025-12-31" });
  });

  it("rejects a rollover date (2026-02-30 -- Feb has 28 days in 2026)", () => {
    expect(parseDayParam("2026-02-30")).toBeNull();
  });

  it("rejects an invalid-date input (2026-99-99 -- the class that throws RangeError pre-fix)", () => {
    expect(parseDayParam("2026-99-99")).toBeNull();
  });

  it("rejects an out-of-range month (2026-13-01)", () => {
    expect(parseDayParam("2026-13-01")).toBeNull();
  });

  it("rejects a zero month (2026-00-10)", () => {
    expect(parseDayParam("2026-00-10")).toBeNull();
  });

  it("rejects an out-of-range day (2026-01-32)", () => {
    expect(parseDayParam("2026-01-32")).toBeNull();
  });

  it("rejects Feb 29 in a non-leap year (2025-02-29)", () => {
    expect(parseDayParam("2025-02-29")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(parseDayParam("")).toBeNull();
  });

  it("rejects null", () => {
    expect(parseDayParam(null)).toBeNull();
  });

  it("rejects a non-date string", () => {
    expect(parseDayParam("notadate")).toBeNull();
  });

  it("rejects a shape that doesn't zero-pad (2026-1-5)", () => {
    expect(parseDayParam("2026-1-5")).toBeNull();
  });

  it("rejects a value with a time component (2026-01-05T00:00:00Z)", () => {
    expect(parseDayParam("2026-01-05T00:00:00Z")).toBeNull();
  });
});
