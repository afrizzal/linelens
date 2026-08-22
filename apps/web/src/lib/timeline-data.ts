/**
 * Intervals -> Gantt-row pure transform (03-03-PLAN.md Task 1), isolated
 * from the ECharts custom-series rendering component (same "keep chart code
 * isolated" pattern as lib/oee-waterfall.ts — 03-02-SUMMARY.md) so the
 * plan's flagged-risk renderItem plumbing has a canvas-free, testable core.
 *
 * Deliberately self-contained (no `@/components/...` or `@linelens/contracts`
 * imports) — token colors and reason labels are resolved by the Gantt
 * component itself, at render time, from this module's plain machineId/state
 * output. This mirrors oee-waterfall.ts's own dependency discipline and
 * avoids depending on the Next.js `@/` path alias under vitest.
 */

export interface TimelineIntervalLike {
  machineId: string;
  state: string;
  start: string;
  end: string | null;
  reasonCode: string | null;
  injected: boolean;
}

export interface GanttRow {
  machineId: string;
  /** Index into the returned `machineIds` (sorted) — the custom series' y-category. */
  categoryIndex: number;
  state: string;
  reasonCode: string | null;
  injected: boolean;
  startMs: number;
  endMs: number;
  durationMin: number;
}

export interface GanttData {
  machineIds: string[];
  rows: GanttRow[];
}

/**
 * Pure intervals -> Gantt row transform. `openEndMs` is the timestamp an
 * open (end===null) interval extends to — callers pass sim-time (clamped to
 * the shift end), NEVER `Date.now()` (CLAUDE.md: "no Date.now() in
 * derivation code — event-time from the payload is the only 'now'
 * downstream").
 */
export function deriveGanttData(intervals: TimelineIntervalLike[], openEndMs: number): GanttData {
  const machineIds = Array.from(new Set(intervals.map((iv) => iv.machineId))).sort();
  const rows: GanttRow[] = intervals.map((iv) => {
    const startMs = new Date(iv.start).getTime();
    const endMs = iv.end ? new Date(iv.end).getTime() : openEndMs;
    return {
      machineId: iv.machineId,
      categoryIndex: machineIds.indexOf(iv.machineId),
      state: iv.state,
      reasonCode: iv.reasonCode,
      injected: iv.injected,
      startMs,
      endMs,
      durationMin: (endMs - startMs) / 60000,
    };
  });
  return { machineIds, rows };
}

export interface TimelineBreakLike {
  start: string;
  end: string;
}

/** Absolute [startMs,endMs] pairs for markArea break shading, sorted ascending. */
export function deriveBreakRanges(breaks: TimelineBreakLike[]): Array<[number, number]> {
  return breaks
    .map((b): [number, number] => [new Date(b.start).getTime(), new Date(b.end).getTime()])
    .sort((a, b) => a[0] - b[0]);
}
