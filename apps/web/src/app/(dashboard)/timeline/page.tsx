"use client";

import { useCallback, useEffect, useState } from "react";
import { useLive } from "@/hooks/use-live";
import { useSimClock } from "@/hooks/use-sim-clock";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Gantt } from "@/components/timeline/gantt";
import type { TimelineBreakLike, TimelineIntervalLike } from "@/lib/timeline-data";

interface AndonLineSummary {
  lineId: string;
  lineName: string;
  shiftDate: string | null;
  shiftId: string | null;
}

interface TimelineResponse {
  shiftStart: string | null;
  shiftEnd: string | null;
  effectiveEnd: string | null;
  breaks: TimelineBreakLike[];
  intervals: TimelineIntervalLike[];
}

// Mirrors plant.config.json's static shift list (S1/S2), same convention as
// the OEE page — no dedicated "shift metadata" endpoint for this appliance.
const SHIFT_OPTIONS = [
  { id: "S1", name: "Shift 1" },
  { id: "S2", name: "Shift 2" },
];

/**
 * Production timeline page (03-03-PLAN.md Task 1, DASH-03): line + shift
 * picker (consistent with the OEE page), color-coded Gantt of machine
 * state_interval rows, live via useLive.
 */
export default function TimelinePage() {
  const [lines, setLines] = useState<AndonLineSummary[]>([]);
  const [lineId, setLineId] = useState<string>("");
  const [shiftDate, setShiftDate] = useState<string>("");
  const [shiftId, setShiftId] = useState<string>(SHIFT_OPTIONS[0].id);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);

  const simClock = useSimClock();

  // Seed the line list + a sane default (line, shift) from /api/andon's
  // already-resolved current shift — same pattern as the OEE page.
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

  useEffect(() => {
    if (shiftDate || !simClock.simNow) return;
    setShiftDate(simClock.simNow.toISOString().slice(0, 10));
  }, [shiftDate, simClock.simNow]);

  const fetchTimeline = useCallback(() => {
    if (!lineId || !shiftDate || !shiftId) return;
    const params = new URLSearchParams({ lineId, shiftDate, shiftId });
    fetch(`/api/timeline?${params.toString()}`)
      .then((res) => res.json())
      .then((data: TimelineResponse) => setTimeline(data))
      .catch(() => {});
  }, [lineId, shiftDate, shiftId]);

  useLive(fetchTimeline);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  const hasData = Boolean(timeline?.shiftStart && timeline?.shiftEnd && timeline.intervals.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Production Timeline</h1>
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

      <Card>
        {hasData && timeline ? (
          <Gantt
            intervals={timeline.intervals}
            breaks={timeline.breaks}
            shiftStart={new Date(timeline.shiftStart!)}
            shiftEnd={new Date(timeline.shiftEnd!)}
            simNow={simClock.simNow}
          />
        ) : (
          <p className="py-16 text-center text-sm text-foreground/50">
            No production data for this line/shift yet — N/A.
          </p>
        )}
      </Card>
    </div>
  );
}
