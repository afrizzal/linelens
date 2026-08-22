import { REASON_BY_CODE } from "@linelens/contracts";
import { stateColor, stateLabel } from "@/components/ui/state-color";

export interface AndonMachine {
  machineId: string;
  state: string;
}

export interface AndonLine {
  lineId: string;
  lineName: string;
  state: string | null;
  reasonCode: string | null;
  since: string | null;
  goodCount: number | null;
  targetCount: number | null;
  shiftDate: string | null;
  shiftId: string | null;
  machines: AndonMachine[];
}

const formatDuration = (ms: number): string => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
};

/**
 * Andon tile (03-02-PLAN.md Task 2) — verified Vorne TAED-style andon
 * minimum: state + good count + target count, all on one screen, live.
 */
export function AndonTile({ line, simNow }: { line: AndonLine; simNow: Date | null }) {
  const color = stateColor(line.state);
  const label = stateLabel(line.state);
  const isDown = line.state === "DOWN";
  const showReason = line.state === "DOWN" || line.state === "CHANGEOVER";
  const reason = line.reasonCode ? (REASON_BY_CODE.get(line.reasonCode)?.label ?? line.reasonCode) : null;

  const since = line.since ? new Date(line.since) : null;
  const durationMs = since && simNow ? simNow.getTime() - since.getTime() : null;

  const hasCounts = line.goodCount != null && line.targetCount != null;
  const pct =
    hasCounts && line.targetCount! > 0 ? Math.min(100, (line.goodCount! / line.targetCount!) * 100) : 0;

  return (
    <div
      className="rounded-lg border-2 bg-panel p-5"
      style={{ borderColor: color }}
      data-line-id={line.lineId}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground/70">{line.lineName}</span>
      </div>

      <div
        className={`mt-2 text-4xl font-extrabold tracking-tight ${isDown ? "animate-pulse" : ""}`}
        style={{ color }}
      >
        {label}
      </div>

      <div className="mt-1 h-5 text-sm text-foreground/70">
        {showReason ? (
          <span>
            {reason ?? "Unspecified"}
            {durationMs != null ? ` · ${formatDuration(durationMs)}` : ""}
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm text-foreground/80">
          <span className="font-mono">
            {line.goodCount != null ? line.goodCount.toLocaleString() : "N/A"} /{" "}
            {line.targetCount != null ? line.targetCount.toLocaleString() : "N/A"}
          </span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-2 rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
      </div>

      <div className="mt-4 flex gap-1.5">
        {line.machines.map((m) => (
          <span
            key={m.machineId}
            title={`${m.machineId}: ${stateLabel(m.state)}`}
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: stateColor(m.state) }}
          />
        ))}
      </div>
    </div>
  );
}
