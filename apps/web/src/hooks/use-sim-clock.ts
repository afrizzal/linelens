"use client";

import { useEffect, useRef, useState } from "react";

/**
 * useSimClock (03-02-PLAN.md Task 1/2) — polls GET /api/sim-clock (built in
 * 03-01) every POLL_MS and locally interpolates between polls so the top
 * bar clock and andon "since" durations visibly tick at the accelerated sim
 * rate (verify: "advances ~1 sim-min per real second at 60x").
 *
 * Compliant with the project's "no Date.now() in derivation code" rule
 * (CLAUDE.md): the SIM time itself always comes from the server's
 * sim_now()-backed /api/sim-clock response. `Date.now()` is used ONLY to
 * measure elapsed *real* wall-clock time since the last poll, to project the
 * already-fetched sim time forward for a smooth DISPLAY tick — this value
 * never feeds any OEE/state derivation, it is a UI-only interpolation.
 */

export interface UseSimClockResult {
  /** Projected current sim time, or null until the first poll resolves. */
  simNow: Date | null;
  /** Sim speed multiplier (e.g. 60), or null until the first poll resolves. */
  speed: number | null;
}

const POLL_MS = 5000;
const TICK_MS = 1000;

interface ClockResponse {
  simNow: string | null;
  speed: number | null;
}

export function useSimClock(): UseSimClockResult {
  const [result, setResult] = useState<UseSimClockResult>({ simNow: null, speed: null });
  const baseRef = useRef<{ simMs: number; wallMs: number; speed: number } | null>(null);

  useEffect(() => {
    let stopped = false;

    const poll = async (): Promise<void> => {
      try {
        const res = await fetch("/api/sim-clock");
        if (!res.ok) return;
        const data = (await res.json()) as ClockResponse;
        if (stopped || !data.simNow) return;
        baseRef.current = {
          simMs: new Date(data.simNow).getTime(),
          wallMs: Date.now(),
          speed: data.speed ?? 1,
        };
      } catch {
        // Keep ticking from the last known base until the next poll succeeds.
      }
    };

    const tick = (): void => {
      const base = baseRef.current;
      if (!base || stopped) return;
      const elapsedRealMs = Date.now() - base.wallMs;
      setResult({
        simNow: new Date(base.simMs + elapsedRealMs * base.speed),
        speed: base.speed,
      });
    };

    void poll();
    const pollId = setInterval(poll, POLL_MS);
    const tickId = setInterval(tick, TICK_MS);

    return () => {
      stopped = true;
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, []);

  return result;
}
