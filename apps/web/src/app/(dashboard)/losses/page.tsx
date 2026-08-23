"use client";

import { useCallback, useEffect, useState } from "react";
import { useLive } from "@/hooks/use-live";
import { useSimClock } from "@/hooks/use-sim-clock";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Pareto } from "@/components/losses/pareto";
import type { LossParetoRowLike, ParetoGroupBy } from "@/lib/loss-pareto";

interface AndonLineSummary {
  lineId: string;
  lineName: string;
}

interface LossesResponse {
  lineId: string;
  day: string;
  rows: LossParetoRowLike[];
}

/**
 * Losses Pareto page (04-03-PLAN.md Task 1, DASH-02) — the dominant
 * loss-presentation pattern: Six Big Losses ranked by lost time, stackable
 * per shift, with a cumulative-% line. Line picker + sim-day picker (mirrors
 * the OEE page's picker layout, WINDOWS entry 7 duplication accepted per
 * that entry's existing scope).
 */
export default function LossesPage() {
  const [lines, setLines] = useState<AndonLineSummary[]>([]);
  const [lineId, setLineId] = useState<string>("");
  const [day, setDay] = useState<string>("");
  const [groupBy, setGroupBy] = useState<ParetoGroupBy>("reason");
  const [data, setData] = useState<LossesResponse | null>(null);

  const simClock = useSimClock();

  useEffect(() => {
    fetch("/api/andon")
      .then((res) => res.json())
      .then((rows: AndonLineSummary[]) => {
        setLines(rows);
        setLineId((prev) => prev || rows[0]?.lineId || "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (day || !simClock.simNow) return;
    setDay(simClock.simNow.toISOString().slice(0, 10));
  }, [day, simClock.simNow]);

  const fetchLosses = useCallback(() => {
    if (!lineId || !day) return;
    const params = new URLSearchParams({ lineId, day });
    fetch(`/api/losses?${params.toString()}`)
      .then((res) => res.json())
      .then((json: LossesResponse) => setData(json))
      .catch(() => {});
  }, [lineId, day]);

  useLive(fetchLosses, { lineId });

  useEffect(() => {
    fetchLosses();
  }, [fetchLosses]);

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Losses — Six Big Losses Pareto</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Select ariaLabel="Line" value={lineId} onChange={setLineId}>
            {lines.map((l) => (
              <option key={l.lineId} value={l.lineId}>
                {l.lineName}
              </option>
            ))}
          </Select>
          <input
            type="date"
            aria-label="Sim day"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="rounded-md border border-white/15 bg-panel px-3 py-1.5 text-sm text-foreground outline-none focus:border-white/30"
          />
          <div className="flex overflow-hidden rounded-md border border-white/15">
            <button
              type="button"
              onClick={() => setGroupBy("reason")}
              className={`px-3 py-1.5 text-sm transition-colors ${
                groupBy === "reason" ? "bg-white/10 font-medium text-foreground" : "text-foreground/60 hover:bg-white/5"
              }`}
            >
              By reason
            </button>
            <button
              type="button"
              onClick={() => setGroupBy("category")}
              className={`px-3 py-1.5 text-sm transition-colors ${
                groupBy === "category" ? "bg-white/10 font-medium text-foreground" : "text-foreground/60 hover:bg-white/5"
              }`}
            >
              By category
            </button>
          </div>
        </div>
      </div>

      <Card>
        {rows.length > 0 ? (
          <Pareto rows={rows} groupBy={groupBy} />
        ) : (
          <p className="py-16 text-center text-sm text-foreground/50">No losses recorded yet — let the plant run.</p>
        )}
      </Card>
    </div>
  );
}
