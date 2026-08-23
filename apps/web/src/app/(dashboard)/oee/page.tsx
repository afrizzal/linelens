"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLive } from "@/hooks/use-live";
import { useSimClock } from "@/hooks/use-sim-clock";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { KpiTiles } from "@/components/oee/kpi-tiles";
import { Waterfall } from "@/components/oee/waterfall";
import { deriveWaterfallBuckets } from "@/lib/oee-waterfall";

interface AndonLineSummary {
  lineId: string;
  lineName: string;
  shiftDate: string | null;
  shiftId: string | null;
  /** WINDOWS 3+4 fallback: the last shift this line has data for. Non-null even between shifts. */
  lastShiftDate: string | null;
  lastShiftId: string | null;
}

interface LineOeeRow {
  lineId: string;
  shiftDate: string;
  shiftId: string;
  pptSec: number;
  downSec: number;
  changeoverSec: number;
  runSec: number;
  totalCnt: number;
  goodCnt: number;
  ictSec: number;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
}

interface MachineOeeRow extends LineOeeRow {
  machineId: string;
  ictMisconfigured: boolean | null;
  aLossSec: number;
  pLossSec: number;
  qLossSec: number;
}

interface OeeResponse {
  line: LineOeeRow | null;
  machines: MachineOeeRow[];
}

// Mirrors plant.config.json's static shift list (S1/S2) — no dedicated
// "shift metadata" endpoint exists, and the shift calendar is fixed config
// for this demo appliance, not user-editable.
const SHIFT_OPTIONS = [
  { id: "S1", name: "Shift 1" },
  { id: "S2", name: "Shift 2" },
];

const formatPct = (v: number | null): string => (v == null ? "N/A" : `${(v * 100).toFixed(1)}%`);

/**
 * OEE waterfall page (03-02-PLAN.md Task 3, DASH-01): line + shift picker,
 * KPI tiles, waterfall, per-machine mini-table.
 */
export default function OeePage() {
  const [lines, setLines] = useState<AndonLineSummary[]>([]);
  const [lineId, setLineId] = useState<string>("");
  const [shiftDate, setShiftDate] = useState<string>("");
  const [shiftId, setShiftId] = useState<string>(SHIFT_OPTIONS[0].id);
  const [oee, setOee] = useState<OeeResponse | null>(null);

  const simClock = useSimClock();

  // WINDOWS 3+4: once the user picks a shift, stop auto-following. Until
  // then the selection tracks the server's view so the page never sits on a
  // stale sim-day after a rollover.
  const shiftPinned = useRef(false);
  const simDay = simClock.simNow ? simClock.simNow.toISOString().slice(0, 10) : "";

  // Seed the line list + a sane default (line, shift) from /api/andon, which
  // resolves "the currently active shift" server-side.
  //
  // Re-runs on sim-day rollover (`simDay` dep) — WINDOWS entry 4: this used to
  // seed once with `prev || …` and then silently show a stale date forever.
  useEffect(() => {
    fetch("/api/andon")
      .then((res) => res.json())
      .then((data: AndonLineSummary[]) => {
        setLines(data);
        const resolvedLineId = lineId || data[0]?.lineId || "";
        setLineId((prev) => prev || data[0]?.lineId || "");
        if (shiftPinned.current) return;

        // Precedence: the shift running right now → the last shift this line
        // actually has data for → nothing (the sim-today fallback below).
        // Shifts cover only 07:00-23:00, so between 23:00 and 07:00 — a third
        // of every sim-day — there IS no active shift, and defaulting to
        // sim-today+S1 renders the whole page N/A (WINDOWS entry 3).
        const activeShift = data.find((l) => l.shiftDate && l.shiftId);
        const forLine = data.find((l) => l.lineId === resolvedLineId) ?? data[0];
        const next = activeShift
          ? { date: activeShift.shiftDate!, id: activeShift.shiftId! }
          : forLine?.lastShiftDate && forLine?.lastShiftId
            ? { date: forLine.lastShiftDate, id: forLine.lastShiftId }
            : null;
        if (next) {
          setShiftDate(next.date);
          setShiftId(next.id);
        }
      })
      .catch(() => {});
  }, [simDay, lineId]);

  // Last-resort default: today's sim date, if /api/andon offered neither an
  // active shift nor any historical one (an empty database).
  useEffect(() => {
    if (shiftDate || !simClock.simNow) return;
    setShiftDate(simClock.simNow.toISOString().slice(0, 10));
  }, [shiftDate, simClock.simNow]);

  const fetchOee = useCallback(() => {
    if (!lineId || !shiftDate || !shiftId) return;
    const params = new URLSearchParams({ lineId, shiftDate, shiftId });
    fetch(`/api/oee?${params.toString()}`)
      .then((res) => res.json())
      .then((data: OeeResponse) => setOee(data))
      .catch(() => {});
  }, [lineId, shiftDate, shiftId]);

  useLive(fetchOee);

  useEffect(() => {
    fetchOee();
  }, [fetchOee]);

  const line = oee?.line ?? null;
  const buckets = useMemo(() => (line ? deriveWaterfallBuckets(line) : null), [line]);
  // ENG-05: FLAG only, never a clamp — computed the same way as the SQL
  // view's per-machine ictMisconfigured (performance > 1.0).
  const ictMisconfigured = line?.performance != null && line.performance > 1.0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">OEE Waterfall</h1>
        <div className="flex items-center gap-3">
          <Select ariaLabel="Line" value={lineId} onChange={setLineId}>
            {lines.map((l) => (
              <option key={l.lineId} value={l.lineId}>
                {l.lineName}
              </option>
            ))}
          </Select>
          <Select
            ariaLabel="Shift"
            value={shiftId}
            onChange={(v) => {
              shiftPinned.current = true;
              setShiftId(v);
            }}
          >
            {SHIFT_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <input
            type="date"
            aria-label="Shift date"
            value={shiftDate}
            onChange={(e) => setShiftDate(e.target.value)}
            className="rounded-md border border-white/15 bg-panel px-3 py-1.5 text-sm text-foreground outline-none focus:border-white/30"
          />
        </div>
      </div>

      <KpiTiles
        availability={line?.availability ?? null}
        performance={line?.performance ?? null}
        quality={line?.quality ?? null}
        oee={line?.oee ?? null}
        ictMisconfigured={ictMisconfigured}
      />

      <Card>
        {buckets ? (
          <Waterfall buckets={buckets} />
        ) : (
          <p className="py-16 text-center text-sm text-foreground/50">
            No production data for this line/shift yet — N/A.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-medium text-foreground/70">Per-machine breakdown</h2>
        {oee && oee.machines.length > 0 ? (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-foreground/50">
                <th className="py-2 pr-4 font-medium">Machine</th>
                <th className="py-2 pr-4 font-medium">Availability</th>
                <th className="py-2 pr-4 font-medium">Performance</th>
                <th className="py-2 pr-4 font-medium">Quality</th>
                <th className="py-2 pr-4 font-medium">OEE</th>
              </tr>
            </thead>
            <tbody>
              {oee.machines.map((m) => (
                <tr key={m.machineId} className="border-b border-white/5 last:border-0">
                  <td className="py-2 pr-4 font-mono">{m.machineId}</td>
                  <td className="py-2 pr-4">{formatPct(m.availability)}</td>
                  <td className="py-2 pr-4">
                    {formatPct(m.performance)}
                    {m.ictMisconfigured && <span className="ml-1 text-amber-400">⚠</span>}
                  </td>
                  <td className="py-2 pr-4">{formatPct(m.quality)}</td>
                  <td className="py-2 pr-4">{formatPct(m.oee)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-foreground/50">No machine data for this line/shift yet — N/A.</p>
        )}
      </Card>
    </div>
  );
}
