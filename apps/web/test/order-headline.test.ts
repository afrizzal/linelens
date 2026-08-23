import { describe, expect, it } from "vitest";
import { composeFulfillmentStory, composeLateHeadline } from "../src/lib/order-headline";

/**
 * 04-02-PLAN.md Task 2 <verify>: "Component test: LATE fixture renders
 * headline + ranked losses; ON_TIME fixture renders fulfillment story."
 * Same pure-function testing pattern as oee-waterfall.test.ts/
 * timeline-data.test.ts — the case-study quote's exact wording lives here,
 * unit-tested against the plan's must_haves truth verbatim.
 */
describe("composeLateHeadline", () => {
  it("renders the exact case-study sentence for a shipped-late order (LATE, shipped)", () => {
    const loss = {
      lineName: "Line 2",
      reasonLabel: "Mechanical jam",
      windowStart: "2026-01-06T14:20:00.000Z",
      windowEnd: "2026-01-06T15:05:00.000Z",
      estLostUnits: 180,
    };
    const order = { status: "LATE" as const, shortUnits: 120, shipped: true };

    const sentence = composeLateHeadline(loss, order);

    expect(sentence).toBe(
      "Line 2 Mechanical jam 14:20–15:05 cost ~180 units → this order shipped 120 short of schedule.",
    );
  });

  it("uses present tense for a LATE order that hasn't shipped yet (still open past due)", () => {
    const loss = {
      lineName: "Line 3",
      reasonLabel: "Blocked sensor",
      windowStart: "2026-01-06T08:00:00.000Z",
      windowEnd: "2026-01-06T08:10:00.000Z",
      estLostUnits: 42,
    };
    const order = { status: "LATE" as const, shortUnits: 15, shipped: false };

    const sentence = composeLateHeadline(loss, order);

    expect(sentence).toBe(
      "Line 3 Blocked sensor 08:00–08:10 cost ~42 units → this order is currently 15 short of schedule.",
    );
  });

  it("uses a forward-looking projection verb for AT_RISK orders", () => {
    const loss = {
      lineName: "Line 4",
      reasonLabel: "Running below rated speed",
      windowStart: "2026-01-06T10:00:00.000Z",
      windowEnd: "2026-01-06T11:00:00.000Z",
      estLostUnits: 30.4,
    };
    const order = { status: "AT_RISK" as const, shortUnits: 8.6, shipped: false };

    const sentence = composeLateHeadline(loss, order);

    // Rounded to whole units for readability, per the case-study copy style.
    expect(sentence).toBe(
      "Line 4 Running below rated speed 10:00–11:00 cost ~30 units → this order is projected to ship 9 short of schedule.",
    );
  });
});

describe("composeFulfillmentStory", () => {
  it("renders the ON_TIME contrast beat, shipped hours early", () => {
    const story = composeFulfillmentStory({
      lineNames: ["Line 1"],
      dueDate: "2026-01-07T15:00:00.000Z",
      shippedAt: "2026-01-07T12:00:00.000Z",
    });

    expect(story).toBe("Produced on Line 1, shipped 3h early.");
  });

  it("renders minutes when the margin is under an hour, and lists multiple producing lines", () => {
    const story = composeFulfillmentStory({
      lineNames: ["Line 1", "Line 2"],
      dueDate: "2026-01-07T15:00:00.000Z",
      shippedAt: "2026-01-07T14:40:00.000Z",
    });

    expect(story).toBe("Produced on Line 1, Line 2, shipped 20min early.");
  });

  it("is honest about a late-but-still-ON_TIME-classified edge (shipped after due -> 'late')", () => {
    // Should not normally happen for a real ON_TIME row (v_order_status
    // requires shippedAt <= dueDate for ON_TIME), but the function itself
    // must not silently lie if fed an inconsistent fixture -- it reports
    // exactly what the timestamps say.
    const story = composeFulfillmentStory({
      lineNames: ["Line 3"],
      dueDate: "2026-01-07T15:00:00.000Z",
      shippedAt: "2026-01-07T15:30:00.000Z",
    });

    expect(story).toBe("Produced on Line 3, shipped 30min late.");
  });

  it("renders 'right on schedule' for an exact due-date match", () => {
    const story = composeFulfillmentStory({
      lineNames: ["Line 1"],
      dueDate: "2026-01-07T15:00:00.000Z",
      shippedAt: "2026-01-07T15:00:00.000Z",
    });

    expect(story).toBe("Produced on Line 1, shipped right on schedule.");
  });

  it("falls back to 'the plant' when no producing lines are known", () => {
    const story = composeFulfillmentStory({
      lineNames: [],
      dueDate: "2026-01-07T15:00:00.000Z",
      shippedAt: "2026-01-07T12:00:00.000Z",
    });

    expect(story).toBe("Produced on the plant, shipped 3h early.");
  });
});
