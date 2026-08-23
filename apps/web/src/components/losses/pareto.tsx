"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { LOSS_FACTOR } from "@linelens/contracts";
import { LOSS_COLORS } from "@/components/ui/state-color";
import { deriveParetoSeries, type LossParetoRowLike, type ParetoGroupBy } from "@/lib/loss-pareto";

// Tree-shaken registration (STACK.md: "tree-shaken echarts/core imports"),
// same init-once/setOption-on-change/dispose-on-unmount wrapper shape as
// components/oee/waterfall.tsx and components/timeline/gantt.tsx — no
// `echarts-for-react` dependency. Larger registration list than the
// waterfall's [BarChart, GridComponent, TooltipComponent, CanvasRenderer]:
// LineChart backs the cumulative-% line, LegendComponent backs the
// per-shift stack legend (04-03-PLAN.md Task 1).
echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

export const CATEGORY_LABELS: Record<string, string> = {
  UNPLANNED_STOPS: "Unplanned Stop",
  PLANNED_STOPS: "Planned Stop",
  SMALL_STOPS: "Small Stop",
  SLOW_CYCLES: "Slow Cycle",
  STARTUP_REJECTS: "Startup Reject",
  PRODUCTION_REJECTS: "Production Reject",
};

const SHIFT_LABELS: Record<string, string> = { S1: "Shift 1", S2: "Shift 2" };

/** Per-shift shade of the SAME category color — full opacity for the first shift, dimmer for later ones (stacked bar keeps one hue per reason/category). */
const SHIFT_ALPHA = [1, 0.55, 0.3];

const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** category -> A/P/Q factor -> the SAME LOSS_COLORS token the waterfall/order-detail pages use (single source of truth, 03-02-PLAN.md Task 1). */
const categoryColor = (category: string): string => {
  const factor = LOSS_FACTOR[category as keyof typeof LOSS_FACTOR];
  const key = factor ? (factor.toLowerCase() as "availability" | "performance" | "quality") : "availability";
  return LOSS_COLORS[key];
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface ParetoProps {
  rows: LossParetoRowLike[];
  groupBy: ParetoGroupBy;
}

export function Pareto({ rows, groupBy }: ParetoProps) {
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

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const { shiftIds, buckets } = deriveParetoSeries(rows, groupBy);
    const categories = buckets.map((b) => (groupBy === "category" ? (CATEGORY_LABELS[b.label] ?? b.label) : b.label));

    const shiftSeries = shiftIds.map((shiftId, i) => ({
      name: SHIFT_LABELS[shiftId] ?? shiftId,
      type: "bar" as const,
      stack: "loss",
      yAxisIndex: 0,
      data: buckets.map((b) => ({
        value: round1(b.byShiftMin[shiftId] ?? 0),
        itemStyle: { color: hexToRgba(categoryColor(b.category), SHIFT_ALPHA[i] ?? 0.3) },
      })),
      tooltip: {
        valueFormatter: (v: unknown) => `${v} min`,
      },
    }));

    const cumulativeSeries = {
      name: "Cumulative %",
      type: "line" as const,
      yAxisIndex: 1,
      data: buckets.map((b) => round1(b.cumulativePct)),
      symbolSize: 6,
      lineStyle: { color: "#e6edf3", width: 2 },
      itemStyle: { color: "#e6edf3" },
    };

    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 56, right: 56, top: 48, bottom: 90 },
      legend: {
        data: [...shiftSeries.map((s) => s.name), cumulativeSeries.name],
        top: 0,
        textStyle: { color: "#e6edf3" },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          const idx = (list[0] as { dataIndex: number })?.dataIndex;
          if (idx == null) return "";
          const bucket = buckets[idx];
          const lines = [
            `<b>${categories[idx]}</b>`,
            groupBy === "reason" ? CATEGORY_LABELS[bucket.category] ?? bucket.category : "",
            `${round1(bucket.lostTimeMin)} min total`,
            bucket.lostUnits > 0 ? `~${Math.round(bucket.lostUnits)} est units` : "",
            `${round1(bucket.cumulativePct)}% cumulative`,
          ].filter(Boolean);
          return lines.join("<br/>");
        },
      },
      xAxis: {
        type: "category",
        data: categories,
        axisLabel: { color: "#e6edf3", interval: 0, rotate: 30, fontSize: 11 },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } },
      },
      yAxis: [
        {
          type: "value",
          name: "minutes",
          nameTextStyle: { color: "#e6edf3" },
          axisLabel: { color: "#e6edf3" },
          splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
        },
        {
          type: "value",
          name: "cumulative %",
          min: 0,
          max: 100,
          nameTextStyle: { color: "#e6edf3" },
          axisLabel: { color: "#e6edf3", formatter: "{value}%" },
          splitLine: { show: false },
        },
      ],
      series: [...shiftSeries, cumulativeSeries],
    });
  }, [rows, groupBy]);

  return <div ref={containerRef} style={{ width: "100%", height: 420 }} />;
}
