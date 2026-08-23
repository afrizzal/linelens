/**
 * Order status chip (04-01-PLAN.md Task 3): ON_TIME green / AT_RISK amber
 * pulsing / LATE red / OPEN slate. Reuses the SAME state-color language as
 * the andon/timeline/waterfall screens (globals.css `--color-state-*`
 * tokens) rather than inventing a parallel palette — ON_TIME maps to the
 * "healthy" execute-green, LATE to down-red, AT_RISK to changeover-amber
 * (with a pulse, matching how a factory floor visually escalates urgency),
 * OPEN to the neutral break-slate.
 */

export type OrderStatus = "ON_TIME" | "LATE" | "AT_RISK" | "OPEN";

const STATUS_STYLES: Record<OrderStatus, string> = {
  ON_TIME: "border-state-execute/40 bg-state-execute/10 text-state-execute",
  LATE: "border-state-down/40 bg-state-down/10 text-state-down",
  AT_RISK: "border-state-changeover/40 bg-state-changeover/10 text-state-changeover animate-pulse",
  OPEN: "border-state-break/40 bg-state-break/10 text-state-break",
};

const STATUS_LABELS: Record<OrderStatus, string> = {
  ON_TIME: "On Time",
  LATE: "Late",
  AT_RISK: "At Risk",
  OPEN: "Open",
};

const isOrderStatus = (value: string): value is OrderStatus =>
  value === "ON_TIME" || value === "LATE" || value === "AT_RISK" || value === "OPEN";

export function StatusChip({ status }: { status: string }) {
  const known = isOrderStatus(status) ? status : null;
  const cls = known ? STATUS_STYLES[known] : "border-white/15 bg-white/5 text-foreground/50";
  const label = known ? STATUS_LABELS[known] : status;

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}
