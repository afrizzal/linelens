"use client";

import { useCallback } from "react";
import { useLive } from "@/hooks/use-live";
import { useSimClock } from "@/hooks/use-sim-clock";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/**
 * Top bar (03-02-PLAN.md Task 1): sim clock (date+time, speed badge) and a
 * live-connection dot. The clock ticks every second via useSimClock's local
 * interpolation; useLive is wired to the SAME endpoint purely to surface the
 * shared `connected` signal for the dot (its own debounced refetch is a
 * harmless extra resync — the 1s local tick is what makes the clock visibly
 * move).
 */
export function TopBar() {
  const { simNow, speed } = useSimClock();

  const noop = useCallback(() => {
    // useSimClock already owns its own poll/tick loop; this hook is used
    // here only for the `connected` signal.
  }, []);
  const { connected } = useLive(noop);

  return (
    <header className="flex items-center justify-between border-b border-white/10 bg-panel px-6 py-3">
      <div className="flex items-center gap-3 text-sm text-foreground/80">
        <span className="font-mono">{simNow ? dateFormatter.format(simNow) : "—"}</span>
        {speed != null && (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-foreground/70">
            {speed}×
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-foreground/60">
        <span
          className={`h-2 w-2 rounded-full ${connected ? "bg-state-execute" : "bg-state-down"}`}
          aria-hidden="true"
        />
        {connected ? "Live" : "Reconnecting…"}
      </div>
    </header>
  );
}
