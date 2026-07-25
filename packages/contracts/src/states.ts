/**
 * Machine state union — PackML-INSPIRED simplified subset.
 *
 * This is NOT a claim of PackML/ISA-TR88.00.02-2015 compliance. The full
 * PackML state model (per community references, ~17 states) is explicitly
 * out of scope for LineLens (see PROJECT.md "Out of Scope"). This is a
 * deliberately simplified 4-state subset chosen for OEE-relevant modeling:
 *
 * - EXECUTE:    producing (machine has production intent, output being made)
 * - DOWN:       unplanned stop (Availability loss — Equipment Failure)
 * - CHANGEOVER: planned setup/changeover (Availability loss — Setup & Adjustments;
 *               stays INSIDE Planned Production Time, per docs/00-domain-research.md §2)
 * - BREAK:      schedule loss window — no production intent, EXCLUDED from
 *               Planned Production Time (see calendar.ts)
 *
 * Small stops (micro-stops) are NOT a separate machine state: they surface
 * as ALARM events (see events.ts) while the machine remains EXECUTE. This
 * is what makes SMALL_STOPS a Performance loss rather than an Availability
 * loss (docs/00-domain-research.md §3, anti-pattern §8.2 refuting any
 * duration-threshold approach).
 */
export const MACHINE_STATES = ['EXECUTE', 'DOWN', 'CHANGEOVER', 'BREAK'] as const;

export type MachineState = (typeof MACHINE_STATES)[number];
