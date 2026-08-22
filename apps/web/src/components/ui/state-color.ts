import type { MachineState } from "@linelens/contracts";

/**
 * Single source of truth for state colors on the client (03-02-PLAN.md Task
 * 1: "components NEVER hardcode state hexes — the timeline/andon/Pareto
 * must agree"). DOM/Tailwind consumers should prefer the `--color-state-*`
 * Tailwind tokens registered in globals.css (e.g. `bg-state-down`); this
 * module exists for the cases that need a raw color VALUE — inline styles
 * and, critically, ECharts canvas series (03-03's timeline, this plan's
 * waterfall), which cannot resolve CSS custom properties at paint time.
 *
 * These hex values MUST stay in sync with apps/web/src/app/globals.css's
 * :root token block — there is no build-time link between the two files.
 */
export const STATE_COLORS: Record<MachineState, string> = {
  EXECUTE: "#22c55e",
  DOWN: "#ef4444",
  CHANGEOVER: "#f59e0b",
  BREAK: "#64748b",
};

/** Color for an unknown/absent state (no open interval, no telemetry yet). */
export const UNKNOWN_STATE_COLOR = "#64748b";

/**
 * A×P×Q waterfall loss-bucket colors (Availability=red, Performance=amber,
 * Quality=violet, productive=green) — 03-02-PLAN.md Task 3.
 */
export const LOSS_COLORS = {
  availability: "#ef4444",
  performance: "#f59e0b",
  quality: "#8b5cf6",
  productive: "#22c55e",
} as const;

/**
 * Human-facing label per MachineState. EXECUTE displays as "RUNNING" (the
 * plan's andon copy) even though the underlying union value stays EXECUTE
 * everywhere else (PackML-inspired subset, states.ts) — this is a display
 * mapping only, never used in derivation/comparison logic.
 */
export const STATE_LABELS: Record<MachineState, string> = {
  EXECUTE: "RUNNING",
  DOWN: "DOWN",
  CHANGEOVER: "CHANGEOVER",
  BREAK: "BREAK",
};

const isMachineState = (value: string): value is MachineState =>
  value === "EXECUTE" || value === "DOWN" || value === "CHANGEOVER" || value === "BREAK";

/** Raw color value for a state (or the muted "no data" color). */
export const stateColor = (state: string | null | undefined): string =>
  state && isMachineState(state) ? STATE_COLORS[state] : UNKNOWN_STATE_COLOR;

/** Display label for a state (or "NO DATA" when absent/unrecognized). */
export const stateLabel = (state: string | null | undefined): string =>
  state && isMachineState(state) ? STATE_LABELS[state] : "NO DATA";
