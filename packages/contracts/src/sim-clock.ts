/**
 * Sim-clock math — pure, no I/O (ARCHITECTURE.md §sim-clock; the worker/db
 * mirror lives in plan 02-01).
 *
 * STANDING RULE (repo-wide convention, not just this file): downstream
 * derivation code (OEE engine, aggregation queries, loss classification)
 * must NEVER call Date.now()/new Date() to compute durations. All duration
 * math uses event `simTime`. Wall-clock (Date.now()) is allowed ONLY for:
 *   1. MQTT/infra concerns (connection timestamps, reconnect backoff)
 *   2. `ingested_at` audit columns (when the worker persisted a row)
 *   3. Feeding `nowRealMs` into `simNow` at the clock edge (this file only)
 *
 * Default SIM_SPEED = 60: 1 real minute = 1 sim hour, so a full sim-day
 * passes in 24 real minutes — the DDS screen always has a fresh
 * "yesterday" available during a live demo.
 */
export const SIM_SPEED = 60;

export interface ClockState {
  /** Sim-time epoch (ms) at the moment this clock state was established. */
  epochSimMs: number;
  /** Wall-clock (real) ms at which this clock state was established. */
  startedAtRealMs: number;
  /** Sim-ms elapsed per real-ms. */
  speed: number;
  /** Wall-clock ms at which the clock was paused, or null if running. */
  pausedAtRealMs: number | null;
}

/**
 * Compute the current sim-time (ms) for a given clock state and wall-clock
 * "now". Piecewise-linear: uses the clock's own slope (speed) from the
 * point it was established (or paused).
 */
export const simNow = (c: ClockState, nowRealMs: number): number =>
  c.pausedAtRealMs !== null
    ? c.epochSimMs + (c.pausedAtRealMs - c.startedAtRealMs) * c.speed
    : c.epochSimMs + (nowRealMs - c.startedAtRealMs) * c.speed;

/**
 * Rebase the clock at `nowRealMs` onto a new speed. Rebasing on every speed
 * change (including pause/resume, which is a rebase to speed 0 and back)
 * keeps past sim timestamps immutable — the mapping from real time to sim
 * time is piecewise-linear, never retroactively rewritten.
 */
export const rebase = (c: ClockState, nowRealMs: number, newSpeed: number): ClockState => ({
  epochSimMs: simNow(c, nowRealMs),
  startedAtRealMs: nowRealMs,
  speed: newSpeed,
  pausedAtRealMs: null,
});

/** Pause the clock at `nowRealMs`: simNow freezes until resumed. */
export const pause = (c: ClockState, nowRealMs: number): ClockState => ({
  ...c,
  pausedAtRealMs: c.pausedAtRealMs ?? nowRealMs,
});

/** Resume a paused clock at `nowRealMs`, continuing from the frozen sim-time without a jump. */
export const resume = (c: ClockState, nowRealMs: number): ClockState => rebase(c, nowRealMs, c.speed);
