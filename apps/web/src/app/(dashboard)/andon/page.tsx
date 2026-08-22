"use client";

import { useCallback, useEffect, useState } from "react";
import { useLive } from "@/hooks/use-live";
import { useSimClock } from "@/hooks/use-sim-clock";
import { AndonTile, type AndonLine } from "@/components/andon/tile";

/**
 * Andon board (03-02-PLAN.md Task 2, DASH-04) — all lines, one screen, live.
 * The "living plant" proof: a natural DOWN event should turn a tile red
 * within ~2s of the worker's NOTIFY, without a reload.
 */
export default function AndonPage() {
  const [lines, setLines] = useState<AndonLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const simClock = useSimClock();

  const fetchAndon = useCallback(() => {
    fetch("/api/andon")
      .then((res) => res.json())
      .then((data: AndonLine[]) => {
        setLines(data);
        setLoaded(true);
      })
      .catch(() => {
        // Transient fetch failure — useLive's poll fallback / next SSE event
        // will retry; keep showing the last-known tiles rather than blanking.
      });
  }, []);

  const { connected } = useLive(fetchAndon);

  useEffect(() => {
    fetchAndon();
  }, [fetchAndon]);

  return (
    <div className={fullscreen ? "fixed inset-0 z-50 overflow-auto bg-background p-6" : ""}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Andon Board</h1>
        <div className="flex items-center gap-3">
          {!connected && <span className="text-xs text-state-down">Reconnecting…</span>}
          <button
            type="button"
            onClick={() => setFullscreen((v) => !v)}
            className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-foreground/80 hover:bg-white/10"
          >
            {fullscreen ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </div>

      {!loaded ? (
        <p className="text-sm text-foreground/50">Loading…</p>
      ) : lines.length === 0 ? (
        <p className="text-sm text-foreground/50">No lines configured.</p>
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}
        >
          {lines.map((line) => (
            <AndonTile key={line.lineId} line={line} simNow={simClock.simNow} />
          ))}
        </div>
      )}
    </div>
  );
}
