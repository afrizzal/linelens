import { Badge } from "@/components/ui/badge";
import { WarningIcon } from "@/components/ui/icons";

export interface KpiTilesProps {
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  /** ENG-05 guard: performance > 100% usually means Ideal Cycle Time is set too high. FLAG only, never a clamp. */
  ictMisconfigured: boolean;
}

const formatPct = (v: number | null): string => (v == null ? "N/A" : `${(v * 100).toFixed(1)}%`);

/**
 * KPI tiles (03-02-PLAN.md Task 3, DASH-01): Availability / Performance /
 * Quality / OEE. NULL renders "N/A" in a muted style — NEVER 0% (PITFALLS.md
 * Pitfall 2). ict_misconfigured surfaces as a visible domain-literacy badge.
 */
export function KpiTiles({ availability, performance, quality, oee, ictMisconfigured }: KpiTilesProps) {
  const tiles: Array<{ label: string; value: number | null }> = [
    { label: "Availability", value: availability },
    { label: "Performance", value: performance },
    { label: "Quality", value: quality },
    { label: "OEE", value: oee },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-white/10 bg-panel p-4">
            <div className="text-sm text-foreground/60">{t.label}</div>
            <div
              className={`mt-1 text-3xl font-bold ${t.value == null ? "text-foreground/40" : "text-foreground"}`}
            >
              {formatPct(t.value)}
            </div>
          </div>
        ))}
      </div>
      {ictMisconfigured && (
        <Badge variant="warning" title="Performance >100% usually means ICT is set too high">
          <WarningIcon className="h-3.5 w-3.5" />
          Check Ideal Cycle Time
        </Badge>
      )}
    </div>
  );
}
