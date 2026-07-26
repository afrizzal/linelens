/**
 * Shift calendar over SIM time (SIM-07). All functions are pure and operate
 * purely on sim-ms values passed in by the caller — this file never calls
 * Date.now(). `new Date(simMs)` is used only to decode calendar structure
 * (day boundaries, minute-of-day) from an explicit sim-ms value, which is
 * consistent with the standing rule in sim-clock.ts.
 *
 * Verified rule (docs/00-domain-research.md §2): breaks and windows with no
 * production intent (Schedule Loss) are EXCLUDED from Planned Production
 * Time. CHANGEOVER time is NOT excluded — it stays inside PPT as an
 * Availability loss (Setup & Adjustments).
 */

export interface ShiftDef {
  id: string;
  name: string;
  /** Minutes from sim-midnight (00:00) that the shift starts. */
  startMin: number;
  /** Minutes from sim-midnight (00:00) that the shift ends. */
  endMin: number;
  breaks: { startMin: number; endMin: number }[];
}

export interface ShiftInstance {
  shiftId: string;
  /** Sim date, YYYY-MM-DD. */
  date: string;
  startMs: number;
  endMs: number;
}

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MIN;

const simMidnightMs = (simMs: number): number => Math.floor(simMs / MS_PER_DAY) * MS_PER_DAY;

const simDateStr = (midnightMs: number): string => new Date(midnightMs).toISOString().slice(0, 10);

/** Find which shift instance (if any) contains the given sim-ms instant. Null = outside any shift (schedule loss). */
export const shiftInstanceAt = (simMs: number, shifts: ShiftDef[]): ShiftInstance | null => {
  const midnightMs = simMidnightMs(simMs);
  const minuteOfDay = (simMs - midnightMs) / MS_PER_MIN;

  for (const shift of shifts) {
    if (minuteOfDay >= shift.startMin && minuteOfDay < shift.endMin) {
      return {
        shiftId: shift.id,
        date: simDateStr(midnightMs),
        startMs: midnightMs + shift.startMin * MS_PER_MIN,
        endMs: midnightMs + shift.endMin * MS_PER_MIN,
      };
    }
  }
  return null;
};

/** Resolve a shift instance's break windows as absolute sim-ms ranges. */
export const breaksWithin = (
  inst: ShiftInstance,
  shifts: ShiftDef[],
): Array<{ startMs: number; endMs: number }> => {
  const shift = shifts.find((s) => s.id === inst.shiftId);
  if (!shift) return [];
  const midnightMs = inst.startMs - shift.startMin * MS_PER_MIN;
  return shift.breaks.map((b) => ({
    startMs: midnightMs + b.startMin * MS_PER_MIN,
    endMs: midnightMs + b.endMin * MS_PER_MIN,
  }));
};

/**
 * Planned Production Time for a shift instance, optionally clamped to
 * `clampToSimMs` (e.g. "now" in sim time, for a partial/in-progress shift).
 * = (min(shift end, clamp) - shift start) - sum(break overlap within that window).
 * Breaks/no-shift windows are excluded; CHANGEOVER time is NOT excluded.
 */
export const plannedProductionTimeMs = (
  inst: ShiftInstance,
  shifts: ShiftDef[],
  clampToSimMs?: number,
): number => {
  const end = clampToSimMs !== undefined ? Math.min(inst.endMs, clampToSimMs) : inst.endMs;
  if (end <= inst.startMs) return 0;

  let durationMs = end - inst.startMs;
  for (const brk of breaksWithin(inst, shifts)) {
    const overlapStart = Math.max(brk.startMs, inst.startMs);
    const overlapEnd = Math.min(brk.endMs, end);
    if (overlapEnd > overlapStart) {
      durationMs -= overlapEnd - overlapStart;
    }
  }
  return durationMs;
};
