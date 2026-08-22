"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { CustomChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, MarkAreaComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { REASON_BY_CODE } from "@linelens/contracts";
import { stateColor, stateLabel } from "@/components/ui/state-color";
import {
  deriveBreakRanges,
  deriveGanttData,
  type TimelineBreakLike,
  type TimelineIntervalLike,
} from "@/lib/timeline-data";

// Tree-shaken registration (STACK.md: "tree-shaken echarts/core imports").
// CustomChart registers ECharts' `type: 'custom'` series (the Gantt engine);
// DataZoomComponent backs the x-axis slider; MarkAreaComponent backs the
// break-window hatched background bands.
echarts.use([CustomChart, GridComponent, TooltipComponent, DataZoomComponent, MarkAreaComponent, CanvasRenderer]);

/**
 * Production timeline Gantt (03-03-PLAN.md Task 1, DASH-03) — the plan's
 * flagged-risk ECharts task. Hand-rolled ECharts React wrapper (same
 * init-once/setOption-on-change/dispose-on-unmount shape as
 * components/oee/waterfall.tsx — no `echarts-for-react` dependency).
 *
 * Custom series `renderItem` follows ECharts' own documented Gantt pattern
 * (option.series-custom docs: categoryIndex via api.value(0), start/end via
 * api.coord(), row height via api.size([0,1])) — verified against the
 * official docs (Context7) before writing this, since this is the plan's
 * explicit spike-first risk item.
 */

// Hand-rolled rect clip instead of `echarts.graphic.clipRectByRect` (the
// docs' own helper): that symbol's availability through the tree-shaken
// `echarts/core` entry point (vs. only the full `echarts` bundle) is
// unverified for this version, and the clip math is a few lines — removing
// an unverified dependency in the plan's flagged-risk task outweighs reusing
// the one-line snippet.
function clipRectToBounds(
  rect: { x: number; y: number; width: number; height: number },
  bounds: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } | null {
  const x1 = Math.max(rect.x, bounds.x);
  const x2 = Math.min(rect.x + rect.width, bounds.x + bounds.width);
  const y1 = Math.max(rect.y, bounds.y);
  const y2 = Math.min(rect.y + rect.height, bounds.y + bounds.height);
  const width = x2 - x1;
  const height = y2 - y1;
  return width > 0 && height > 0 ? { x: x1, y: y1, width, height } : null;
}

interface RenderItemParams {
  coordSys: { x: number; y: number; width: number; height: number };
}
interface RenderItemAPI {
  value: (idx: number) => number | string;
  coord: (val: [number, number]) => number[];
  size: (val: [number, number]) => number[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface GanttProps {
  intervals: TimelineIntervalLike[];
  breaks: TimelineBreakLike[];
  shiftStart: Date;
  shiftEnd: Date;
  /** Sim-time "now" (from useSimClock, server-sourced) — open bars grow live up to this, never past shiftEnd. */
  simNow: Date | null;
}

export function Gantt({ intervals, breaks, shiftStart, shiftEnd, simNow }: GanttProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const handleResize = (): void => chart.resize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // Open (end===null) intervals extend to sim_now, clamped to shiftEnd —
  // never Date.now() (CLAUDE.md non-negotiable: derivation reads sim-time only).
  const openEndMs = useMemo(() => {
    const shiftEndMs = shiftEnd.getTime();
    return simNow ? Math.min(simNow.getTime(), shiftEndMs) : shiftEndMs;
  }, [shiftEnd, simNow]);

  const { machineIds, rows } = useMemo(() => deriveGanttData(intervals, openEndMs), [intervals, openEndMs]);
  const breakRanges = useMemo(() => deriveBreakRanges(breaks), [breaks]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const data = rows.map((r) => [r.categoryIndex, r.startMs, r.endMs, stateColor(r.state)]);

    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 90, right: 24, top: 20, bottom: 60 },
      tooltip: {
        trigger: "item",
        formatter: (params: unknown): string => {
          const p = params as { dataIndex: number };
          const row = rows[p.dataIndex];
          if (!row) return "";
          const reasonLabel = row.reasonCode
            ? (REASON_BY_CODE.get(row.reasonCode)?.label ?? row.reasonCode)
            : null;
          const injectedTag = row.injected
            ? ` <span style="color:${stateColor("DOWN")}">[INJECTED]</span>`
            : "";
          return `${row.machineId} · ${stateLabel(row.state)}${injectedTag}<br/>${reasonLabel ?? "—"}<br/>${round1(row.durationMin)} min`;
        },
      },
      xAxis: {
        type: "time",
        min: shiftStart.getTime(),
        max: shiftEnd.getTime(),
        axisLabel: { color: "#e6edf3" },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.06)" } },
      },
      yAxis: {
        type: "category",
        data: machineIds,
        axisLabel: { color: "#e6edf3" },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } },
      },
      dataZoom: [
        { type: "slider", xAxisIndex: 0, bottom: 10, height: 18 },
        { type: "inside", xAxisIndex: 0 },
      ],
      series: [
        {
          type: "custom",
          renderItem: (params: unknown, api: unknown) => {
            const p = params as RenderItemParams;
            const a = api as RenderItemAPI;
            const categoryIndex = a.value(0) as number;
            const start = a.coord([a.value(1) as number, categoryIndex]);
            const end = a.coord([a.value(2) as number, categoryIndex]);
            const height = a.size([0, 1])[1] * 0.6;
            const rect = clipRectToBounds(
              { x: start[0], y: start[1] - height / 2, width: end[0] - start[0], height },
              { x: p.coordSys.x, y: p.coordSys.y, width: p.coordSys.width, height: p.coordSys.height },
            );
            if (!rect) return undefined;
            return { type: "rect", shape: rect, style: { fill: a.value(3) as string } };
          },
          encode: { x: [1, 2], y: 0 },
          data,
          // Break windows as hatched background bands spanning the full
          // chart height (shift calendar metadata from GET /api/timeline —
          // see route.ts's Task 1 deviation) so viewers see PPT semantics
          // (breaks excluded from Planned Production Time) visually.
          markArea: {
            silent: true,
            itemStyle: {
              color: "rgba(255,255,255,0.05)",
              decal: {
                symbol: "rect",
                dashArrayX: [1, 0],
                dashArrayY: [2, 4],
                rotation: Math.PI / 4,
                color: "rgba(255,255,255,0.12)",
              },
            },
            data: breakRanges.map(([start, end]) => [{ xAxis: start }, { xAxis: end }]),
          },
        },
      ],
    });
  }, [rows, breakRanges, machineIds, shiftStart, shiftEnd]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: Math.max(240, machineIds.length * 70 + 100) }}
    />
  );
}
