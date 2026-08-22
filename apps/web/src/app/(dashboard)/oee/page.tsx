"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

  // Seed the line list + a sane default (line, shift) from /api/andon, which
  // already resolves "the currently active shift" server-side — no separate
  // shift-metadata endpoint needed.
  useEffect(() => {
    fetch("/api/andon")
      .then((res) => res.json())
      .then((data: AndonLineSummary[]) => {
        setLines(data);
        setLineId((prev) => prev || data[0]?.lineId || "");
        const activeShift = data.find((l) => l.shiftDate && l.shiftId);
        if (activeShift) {
          setShiftDate((prev) => prev || activeShift.shiftDate!);
          setShiftId((prev) => (prev === SHIFT_OPTIONS[0].id ? activeShift.shiftId! : prev));
        }
      })
      .catch(() => {});
  }, []);

  // Fallback default shiftDate = today's sim date, once the clock resolves,
  // if /api/andon found no currently-active shift (between shifts).
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
          <Select ariaLabel="Shift" value={shiftId} onChange={setShiftId}>
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
