"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLive } from "@/hooks/use-live";
import { Card } from "@/components/ui/card";

interface DdsAction {
  rank: number;
  reasonCode: string;
  category: string;
  lineId: string;
  lineName: string;
  lostTimeSec: number;
  action: string;
  owner: string;
}

interface DdsEscalation {
  lineId: string;
  lineName: string;
  reason: string;
  metric: string;
}

interface DdsResponse {
  day: string;
  lineId: string | null;
  safety: { daysSinceIncident: number; synthetic: boolean };
  quality: { qualityPct: number | null; totalRejects: number | null };
  delivery: { difotPct: number | null; onTimeCount: number | null; totalDue: number | null; lateCount: number | null };
  oee: { oee: number | null; delta: number | null };
  topLoss: {
    lineId: string;
    lineName: string;
    category: string;
    reasonCode: string;
    reasonLabel: string;
    lostTimeMin: number;
  } | null;
  actions: DdsAction[];
  escalations: DdsEscalation[];
}

const CATEGORY_LABELS: Record<string, string> = {
  UNPLANNED_STOPS: "Unplanned Stop",
  PLANNED_STOPS: "Planned Stop",
  SMALL_STOPS: "Small Stop",
  SLOW_CYCLES: "Slow Cycle",
  STARTUP_REJECTS: "Startup Reject",
  PRODUCTION_REJECTS: "Production Reject",
};

/** N/A NEVER 0 (project rule): renders "N/A" for null, never a false 0%. */
const formatPct = (v: number | null): string => (v == null ? "N/A" : `${Math.round(v * 100)}%`);
const formatCount = (v: number | null): string => (v == null ? "N/A" : `${v}`);

/**
 * DDS screen (04-03-PLAN.md Task 3, DDS-01) — a board a supervisor reads in
 * 10 minutes (docs/00-domain-research.md §6): yesterday's safety/quality/
 * delivery + OEE + top loss, today's top-3 rule-generated actions,
 * escalation status. Framed "inspired by TPM daily management practice" —
 * never an IWS/P&G-specific tiering claim (§8 anti-pattern guard).
 */
export default function DdsPage() {
  const [data, setData] = useState<DdsResponse | null>(null);

  const fetchDds = useCallback(() => {
    fetch("/api/dds")
      .then((res) => res.json())
      .then((json: DdsResponse) => setData(json))
      .catch(() => {});
  }, []);

  useLive(fetchDds);

  useEffect(() => {
    fetchDds();
  }, [fetchDds]);

  const safety = data?.safety ?? null;
  const quality = data?.quality ?? null;
  const delivery = data?.delivery ?? null;
  const oee = data?.oee ?? null;
  const topLoss = data?.topLoss ?? null;
  const actions = data?.actions ?? [];
  const escalations = data?.escalations ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Daily Direction Setting</h1>
        {data && <span className="text-sm text-foreground/50">Yesterday: {data.day}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <div className="text-xs text-foreground/50">Safety</div>
          <div className="mt-1 text-2xl font-bold">{safety ? safety.daysSinceIncident : "—"}</div>
          <div className="mt-1 text-xs text-foreground/40">days since incident (synthetic data)</div>
        </Card>
        <Card>
          <div className="text-xs text-foreground/50">Quality</div>
          <div className={`mt-1 text-2xl font-bold ${quality?.qualityPct == null ? "text-foreground/40" : ""}`}>
            {quality ? formatPct(quality.qualityPct) : "—"}
          </div>
          <div className="mt-1 text-xs text-foreground/40">
            {quality ? `${formatCount(quality.totalRejects)} rejects` : "—"}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-foreground/50">Delivery</div>
          <div className={`mt-1 text-2xl font-bold ${delivery?.difotPct == null ? "text-foreground/40" : ""}`}>
            {delivery ? formatPct(delivery.difotPct) : "—"}
          </div>
          <div className="mt-1 text-xs text-foreground/40">
            {delivery ? `${formatCount(delivery.lateCount)} late orders` : "—"}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-foreground/50">OEE</div>
          <div className={`mt-1 text-2xl font-bold ${oee?.oee == null ? "text-foreground/40" : ""}`}>
            {oee ? formatPct(oee.oee) : "—"}
          </div>
          <div className="mt-1 text-xs text-foreground/40">
            {oee?.delta != null ? (
              <span className={oee.delta >= 0 ? "text-state-execute" : "text-state-down"}>
                {oee.delta >= 0 ? "+" : ""}
                {Math.round(oee.delta * 100)}pp vs day before
              </span>
            ) : (
              "—"
            )}
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-medium text-foreground/70">Top loss yesterday</h2>
        {topLoss ? (
          <Link
            href={`/losses?lineId=${encodeURIComponent(topLoss.lineId)}&day=${encodeURIComponent(data!.day)}`}
            className="flex flex-wrap items-center gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm transition-colors hover:border-white/25 hover:bg-white/[0.05]"
          >
            <span className="inline-flex items-center rounded-full border border-loss-availability/40 bg-loss-availability/10 px-2 py-0.5 text-xs font-medium text-loss-availability">
              {CATEGORY_LABELS[topLoss.category] ?? topLoss.category}
            </span>
            <span className="font-medium">{topLoss.reasonLabel}</span>
            <span className="font-mono text-xs text-foreground/50">{topLoss.lineName}</span>
            <span className="ml-auto text-sm font-semibold">{Math.round(topLoss.lostTimeMin)} min</span>
          </Link>
        ) : (
          <p className="py-8 text-center text-sm text-foreground/50">No losses recorded yesterday — N/A.</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-medium text-foreground/70">Today&apos;s top 3 actions</h2>
        {actions.length > 0 ? (
          <ol className="space-y-2">
            {actions.map((a) => (
              <li
                key={`${a.reasonCode}-${a.lineId}`}
                className="flex flex-wrap items-center gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">
                  {a.rank}
                </span>
                <span className="font-medium">{a.action}</span>
                <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs text-foreground/70">
                  {a.owner}
                </span>
                <span className="ml-auto text-xs text-foreground/50">
                  source: {a.reasonCode} · {a.lineName}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-8 text-center text-sm text-foreground/50">No losses to act on yesterday — N/A.</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-medium text-foreground/70">Escalations</h2>
        {escalations.length > 0 ? (
          <div className="space-y-2">
            {escalations.map((e, i) => (
              <div
                key={`${e.lineId}-${i}`}
                className="flex flex-wrap items-center gap-3 rounded-md border border-state-down/30 bg-state-down/5 px-3 py-2.5 text-sm"
              >
                <span className="font-mono text-xs text-foreground/50">{e.lineName}</span>
                <span className="font-medium">{e.reason}</span>
                <span className="ml-auto font-mono text-sm font-semibold text-state-down">{e.metric}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-state-execute/30 bg-state-execute/5 px-3 py-2.5 text-sm text-state-execute">
            No escalations.
          </div>
        )}
      </Card>

      <p className="text-center text-xs text-foreground/40">
        Daily Direction Setting — inspired by TPM daily management practice.
      </p>
    </div>
  );
}
