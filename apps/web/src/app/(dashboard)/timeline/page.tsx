"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLive } from "@/hooks/use-live";
import { useSimClock } from "@/hooks/use-sim-clock";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Gantt } from "@/components/timeline/gantt";
import { InjectButton } from "@/components/inject-button";
import type { TimelineBreakLike, TimelineIntervalLike } from "@/lib/timeline-data";

interface AndonLineSummary {
  lineId: string;
  lineName: string;
  shiftDate: string | null;
  shiftId: string | null;
  /** WINDOWS 3+4 fallback: the last shift this line has data for. Non-null even between shifts. */
  lastShiftDate: string | null;
  lastShiftId: string | null;
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
 *
 * `useSearchParams()` must sit inside a `<Suspense>` boundary or `next
 * build`'s static prerendering fails (works fine under `next dev`, which
 * is why this is a build-only trap — 04-02-PLAN.md Task 2 implementation
 * note). The default export below only sets up that boundary; all the
 * actual state/fetch logic lives in TimelineContent.
 */
export default function TimelinePage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-foreground/50">Loading…</div>}>
      <TimelineContent />
    </Suspense>
  );
}

function TimelineContent() {
  const searchParams = useSearchParams();

  // 04-02-PLAN.md Task 2 DEEP-LINK MECHANISM: the order drill-down links
  // here with lineId/shiftDate/shiftId/machineId/highlightStart/
  // highlightEnd explicitly set from the loss row — seed picker state FROM
  // the URL on first render, and never let the andon-default effect below
  // override an explicit deep-link value: lineId/shiftDate rely on their
  // `""` sentinel (a `prev ||` guard is safe, `""` can't collide with a real
  // value); shiftId can't use that trick because its default (`"S1"`) IS a
  // real value, so it tracks URL provenance in `shiftIdFromUrl` instead.
  const [lines, setLines] = useState<AndonLineSummary[]>([]);
  const [lineId, setLineId] = useState<string>(() => searchParams.get("lineId") ?? "");
  const [shiftDate, setShiftDate] = useState<string>(() => searchParams.get("shiftDate") ?? "");
  const [shiftId, setShiftId] = useState<string>(() => searchParams.get("shiftId") ?? SHIFT_OPTIONS[0].id);
  // `shiftId`'s default (SHIFT_OPTIONS[0].id === "S1") is a real, selectable
  // value, unlike lineId/shiftDate's "" sentinel — so the andon-default
  // effect below can't tell "deep-link explicitly chose Shift 1" apart from
  // "nothing was ever set" by comparing state to that default alone. Track
  // URL provenance independently, once, at mount.
  const shiftIdFromUrl = useRef(searchParams.get("shiftId") !== null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);

  const highlightMachineId = searchParams.get("machineId");
  const highlightStartIso = searchParams.get("highlightStart");
  const highlightEndIso = searchParams.get("highlightEnd");
  const highlightStartMs = highlightStartIso ? Date.parse(highlightStartIso) : null;
  const highlightEndMs = highlightEndIso ? Date.parse(highlightEndIso) : null;

  const simClock = useSimClock();

  // Seed the line list + a sane default (line, shift) from /api/andon's
  // already-resolved current shift — same pattern as the OEE page.
  // lineId/shiftDate use `prev ||` guards; shiftId is gated on
  // `shiftIdFromUrl.current` so a URL-derived initial value above always
  // wins, for all three fields.
  // WINDOWS 3+4: a deep link pins the selection immediately (CR-01 — the
  // andon effect must never steer a drill-down away from its own shift), and
  // so does any manual pick. Only an unpinned page auto-follows.
  const shiftPinned = useRef(
    shiftIdFromUrl.current || searchParams.get("shiftDate") !== null,
  );
  const simDay = simClock.simNow ? simClock.simNow.toISOString().slice(0, 10) : "";

  useEffect(() => {
    fetch("/api/andon")
      .then((res) => res.json())
      .then((data: AndonLineSummary[]) => {
        setLines(data);
        const resolvedLineId = lineId || data[0]?.lineId || "";
        setLineId((prev) => prev || data[0]?.lineId || "");
        if (shiftPinned.current) return;

        // Same precedence as the OEE page: active shift → this line's last
        // shift with data → the sim-today fallback below. Without the middle
        // branch the page renders N/A for the third of every sim-day that
        // falls outside 07:00-23:00 (WINDOWS entry 3).
        const activeShift = data.find((l) => l.shiftDate && l.shiftId);
        const forLine = data.find((l) => l.lineId === resolvedLineId) ?? data[0];
        const next = activeShift
          ? { date: activeShift.shiftDate!, id: activeShift.shiftId! }
          : forLine?.lastShiftDate && forLine?.lastShiftId
            ? { date: forLine.lastShiftDate, id: forLine.lastShiftId }
            : null;
        if (next) {
          setShiftDate(next.date);
          if (!shiftIdFromUrl.current) setShiftId(next.id);
        }
      })
      .catch(() => {});
  }, [simDay, lineId, searchParams]);

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
  const activeLineName = lines.find((l) => l.lineId === lineId)?.lineName;

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
          {lineId && <InjectButton lineId={lineId} lineName={activeLineName} />}
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
            highlightMachineId={highlightMachineId}
            highlightStartMs={highlightStartMs}
            highlightEndMs={highlightEndMs}
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
