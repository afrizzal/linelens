"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { WaterfallBuckets } from "@/lib/oee-waterfall";
import { LOSS_COLORS } from "@/components/ui/state-color";

// Tree-shaken registration (STACK.md: "tree-shaken echarts/core imports").
echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

/**
 * OEE waterfall (03-02-PLAN.md Task 3, DASH-01) — hand-rolled ECharts React
 * wrapper (~init once, setOption on data change, dispose on unmount,
 * renderer:'canvas'). DELIBERATE: no `echarts-for-react` dependency — this
 * ~40-line wrapper is reused as-is by 03-03/04-03.
 *
 * Standard ECharts waterfall pattern: an invisible "base" bar series (stack
 * offset) plus a visible "value" series stacked on top of it, so each loss
 * step reads as a floating drop from the running total.
 */
export interface WaterfallProps {
  buckets: WaterfallBuckets;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function Waterfall({ buckets }: WaterfallProps) {
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

    const categories = [
      "Planned Production Time",
      "Availability Loss",
      "Performance Loss",
      "Quality Loss",
      "Fully Productive Time",
    ];
    const values = [buckets.pptMin, buckets.aLossMin, buckets.pLossMin, buckets.qLossMin, buckets.productiveMin];
    const pcts = [null, buckets.aLossPct, buckets.pLossPct, buckets.qLossPct, buckets.productivePct];
    const colors = [
      "#38bdf8",
      LOSS_COLORS.availability,
      LOSS_COLORS.performance,
      LOSS_COLORS.quality,
      LOSS_COLORS.productive,
    ];
    // Running offset under each visible bar: PPT bar sits on 0, each loss bar
    // floats at (remaining-after-that-step), the productive bar sits on 0.
    const assist = [0, buckets.pptMin - buckets.aLossMin, buckets.productiveMin + buckets.qLossMin, buckets.productiveMin, 0];

    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 56, right: 20, top: 40, bottom: 70 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params];
          const entry = list.find((p) => (p as { seriesName?: string }).seriesName === "value") as
            | { dataIndex: number; value: number }
            | undefined;
          if (!entry) return "";
          const pct = pcts[entry.dataIndex];
          return `${categories[entry.dataIndex]}<br/>${round1(entry.value)} min${pct != null ? ` (${round1(pct)}% of PPT)` : ""}`;
        },
      },
      xAxis: {
        type: "category",
        data: categories,
        axisLabel: { color: "#e6edf3", interval: 0, rotate: 20, fontSize: 11 },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.15)" } },
      },
      yAxis: {
        type: "value",
        name: "minutes",
        nameTextStyle: { color: "#e6edf3" },
        axisLabel: { color: "#e6edf3" },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.08)" } },
      },
      series: [
        {
          name: "base",
          type: "bar",
          stack: "total",
          silent: true,
          tooltip: { show: false },
          itemStyle: { color: "transparent" },
          emphasis: { itemStyle: { color: "transparent" } },
          data: assist,
        },
        {
          name: "value",
          type: "bar",
          stack: "total",
          data: values.map((v, i) => ({ value: round1(v), itemStyle: { color: colors[i] } })),
          label: {
            show: true,
            position: "top",
            color: "#e6edf3",
            formatter: (p: { dataIndex: number; value: number }) => {
              const pct = pcts[p.dataIndex];
              return pct != null ? `${round1(p.value)}m\n${round1(pct)}%` : `${round1(p.value)}m`;
            },
          },
        },
      ],
    });
  }, [buckets]);

  return <div ref={containerRef} style={{ width: "100%", height: 360 }} />;
}
