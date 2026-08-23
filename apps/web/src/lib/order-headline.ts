/**
 * The money-shot headline sentence (04-02-PLAN.md Task 2) — pure, DB-free
 * template functions kept isolated from the page component (same
 * "pure-core / component-shell" split as lib/oee-waterfall.ts and
 * lib/timeline-data.ts) so the exact copy is unit-testable without
 * rendering React.
 *
 * LATE/AT_RISK: composeLateHeadline() renders the top-ranked loss +
 * shortfall as one sentence — the case-study quote, verbatim style from
 * the plan's must_haves truth: "Line 2 breakdown 14:20-15:05 cost ~180
 * units -> this order shipped 120 short of schedule."
 *
 * ON_TIME: composeFulfillmentStory() renders the contrast beat instead
 * ("Produced on L1, shipped 3h early") — the bridge sells harder when both
 * sides of the story are shown, not just the bad-news case.
 */

export interface HeadlineLossInput {
  lineName: string;
  reasonLabel: string;
  /** ISO sim-time timestamp. */
  windowStart: string;
  /** ISO sim-time timestamp. */
  windowEnd: string;
  estLostUnits: number;
}

export interface HeadlineOrderInput {
  status: "LATE" | "AT_RISK";
  shortUnits: number;
  /** True when the order has already shipped (late) — false for AT_RISK / still-open-past-due. */
  shipped: boolean;
}

/** HH:mm from an ISO sim-time string, UTC (sim-time has no local-TZ meaning — same convention as orders/[id]/page.tsx's formatSimTime). */
const formatHHmm = (iso: string): string => new Date(iso).toISOString().slice(11, 16);

/**
 * "{LineName} {reasonLabel} {HH:mm}-{HH:mm} cost ~{estLostUnits} units ->
 * this order {verb} {short} short of schedule." — verb varies with the
 * order's actual state so the sentence stays literally true: a shipped-late
 * order "shipped N short" (past tense, factual), a still-open past-due
 * order "is N short" (ongoing), an AT_RISK order (not yet due) "is
 * projected to ship N short" (forward-looking, honest about being a
 * projection per v_order_status's projectedFinish mechanic).
 */
export function composeLateHeadline(loss: HeadlineLossInput, order: HeadlineOrderInput): string {
  const start = formatHHmm(loss.windowStart);
  const end = formatHHmm(loss.windowEnd);
  const units = Math.round(loss.estLostUnits);
  const short = Math.round(order.shortUnits);
  const verb = order.status === "AT_RISK" ? "is projected to ship" : order.shipped ? "shipped" : "is currently";

  return `${loss.lineName} ${loss.reasonLabel} ${start}–${end} cost ~${units} units → this order ${verb} ${short} short of schedule.`;
}

export interface FulfillmentStoryInput {
  /** Distinct producing line display names, in first-appearance order (dedup already applied by the caller). */
  lineNames: string[];
  /** ISO sim-time timestamp. */
  dueDate: string;
  /** ISO sim-time timestamp — always present for ON_TIME orders. */
  shippedAt: string;
}

/** "Produced on {lines}, shipped {N}{unit} early/late." (or "right on schedule" for an exact match). */
export function composeFulfillmentStory(input: FulfillmentStoryInput): string {
  const lines = input.lineNames.length > 0 ? input.lineNames.join(", ") : "the plant";
  const dueMs = new Date(input.dueDate).getTime();
  const shippedMs = new Date(input.shippedAt).getTime();
  const diffMs = dueMs - shippedMs; // positive = shipped early
  const diffHours = Math.abs(diffMs) / 3_600_000;

  if (diffHours < 1 / 60) {
    return `Produced on ${lines}, shipped right on schedule.`;
  }

  const useMinutes = diffHours < 1;
  const amount = Math.round(useMinutes ? diffHours * 60 : diffHours);
  const unit = useMinutes ? "min" : "h";
  const earlyLate = diffMs >= 0 ? "early" : "late";

  return `Produced on ${lines}, shipped ${amount}${unit} ${earlyLate}.`;
}
