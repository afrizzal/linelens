"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { LOSS_FACTOR } from "@linelens/contracts";
import { useLive } from "@/hooks/use-live";
import { Card } from "@/components/ui/card";
import { StatusChip } from "@/components/orders/status-chip";
import { composeFulfillmentStory, composeLateHeadline } from "@/lib/order-headline";

interface OrderStatusRow {
  orderId: string;
  productId: string;
  customer: string;
  qtyOrdered: number;
  orderDate: string;
  dueDate: string;
  shippedAt: string | null;
  allocatedQty: number;
  remainingQty: number;
  projectedFinish: string;
  status: string;
}

interface AllocationRow {
  id: string;
  lineId: string;
  lineName: string;
  machineId: string;
  qty: number;
  producedAt: string;
}

interface LossRow {
  category: string;
  reasonLabel: string | null;
  machineId: string | null;
  lineId: string;
  lineName: string;
  windowStart: string;
  windowEnd: string;
  lostTimeSec: number | null;
  estLostUnits: number | null;
  injected: boolean | null;
  shiftDate: string | null;
  shiftId: string | null;
}

interface OrderDetailResponse {
  order: OrderStatusRow;
  allocations: AllocationRow[];
  losses: LossRow[];
  shortUnits: number;
  totalEstLostUnits: number;
}

const formatSimTime = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
};

const formatHHmm = (iso: string): string => new Date(iso).toISOString().slice(11, 16);

/**
 * Category badge color — the Six Big Losses -> A/P/Q factor mapping
 * (@linelens/contracts LOSS_FACTOR) resolved to the SAME loss-bucket
 * Tailwind tokens the OEE waterfall uses (globals.css --color-loss-*),
 * never a hardcoded hex — 03-02-PLAN.md's "components NEVER hardcode
 * state/loss colors" rule.
 */
const FACTOR_BADGE_CLASS: Record<string, string> = {
  AVAILABILITY: "border-loss-availability/40 bg-loss-availability/10 text-loss-availability",
  PERFORMANCE: "border-loss-performance/40 bg-loss-performance/10 text-loss-performance",
  QUALITY: "border-loss-quality/40 bg-loss-quality/10 text-loss-quality",
};

const CATEGORY_LABELS: Record<string, string> = {
  UNPLANNED_STOPS: "Unplanned Stop",
  PLANNED_STOPS: "Planned Stop",
  SMALL_STOPS: "Small Stop",
  SLOW_CYCLES: "Slow Cycle",
  STARTUP_REJECTS: "Startup Reject",
  PRODUCTION_REJECTS: "Production Reject",
};

/** Deep-link to the Timeline page, pre-filtered + pulsing the matching band (04-02-PLAN.md Task 2 DEEP-LINK MECHANISM, Option A). */
const deepLinkHref = (loss: LossRow): string => {
  const params = new URLSearchParams({ lineId: loss.lineId });
  // Explicitly SET shiftDate/shiftId from the loss row rather than relying
  // on the timeline page's own mount-time default seeding (WINDOWS entries
  // 3/4 — that default is the broken path for ~1/3 of sim-time).
  if (loss.shiftDate) params.set("shiftDate", loss.shiftDate);
  if (loss.shiftId) params.set("shiftId", loss.shiftId);
  if (loss.machineId) params.set("machineId", loss.machineId);
  params.set("highlightStart", loss.windowStart);
  params.set("highlightEnd", loss.windowEnd);
  return `/timeline?${params.toString()}`;
};

/**
 * Order detail — THE money shot (04-02-PLAN.md Task 2): completes 04-01's
 * stub with the drill-down headline + ranked loss list for LATE/AT_RISK
 * orders, or the fulfillment-story contrast beat for ON_TIME orders.
 */
export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [data, setData] = useState<OrderDetailResponse | null>(null);
  const [notFound, setNotFound] = useState(false);

  const fetchOrder = useCallback(() => {
    if (!id) return;
    fetch(`/api/orders/${id}`)
      .then(async (res) => {
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        return (await res.json()) as OrderDetailResponse;
      })
      .then((json) => {
        if (json) setData(json);
      })
      .catch(() => {});
  }, [id]);

  useLive(fetchOrder);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  if (notFound) {
    return (
      <div className="space-y-4">
        <Link href="/orders" className="text-sm text-foreground/60 hover:underline">
          ← Back to Orders
        </Link>
        <p className="text-sm text-foreground/50">Order not found.</p>
      </div>
    );
  }

  const order = data?.order ?? null;
  const allocations = data?.allocations ?? [];
  const losses = data?.losses ?? [];
  const shortUnits = data?.shortUnits ?? 0;

  const progressPct = order && order.qtyOrdered > 0 ? Math.min(100, (order.allocatedQty / order.qtyOrdered) * 100) : 0;

  // THE HEADLINE (LATE/AT_RISK) or fulfillment story (ON_TIME).
  let headline: string | null = null;
  if (order && (order.status === "LATE" || order.status === "AT_RISK")) {
    const top = losses[0];
    headline = top
      ? composeLateHeadline(
          {
            lineName: top.lineName,
            reasonLabel: top.reasonLabel ?? (CATEGORY_LABELS[top.category] ?? top.category),
            windowStart: top.windowStart,
            windowEnd: top.windowEnd,
            estLostUnits: top.estLostUnits ?? 0,
          },
          { status: order.status, shortUnits, shipped: order.shippedAt !== null },
        )
      : `This order is ${Math.round(shortUnits)} short of schedule (no attributable loss events found for its production window).`;
  } else if (order && order.status === "ON_TIME" && order.shippedAt) {
    const lineNames: string[] = [];
    for (const a of allocations) {
      if (!lineNames.includes(a.lineName)) lineNames.push(a.lineName);
    }
    headline = composeFulfillmentStory({ lineNames, dueDate: order.dueDate, shippedAt: order.shippedAt });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/orders" className="text-sm text-foreground/60 hover:underline">
          ← Back to Orders
        </Link>
        {order && (
          <span data-testid="order-status">
            <StatusChip status={order.status} />
          </span>
        )}
      </div>

      <Card>
        {order ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs text-foreground/50">Customer</div>
              <div data-testid="order-customer" className="mt-1 text-sm font-medium">{order.customer}</div>
            </div>
            <div>
              <div className="text-xs text-foreground/50">Product</div>
              <div data-testid="order-product" className="mt-1 font-mono text-sm">{order.productId}</div>
            </div>
            <div className="sm:col-span-1">
              <div className="text-xs text-foreground/50">Qty (allocated/ordered)</div>
              <div data-testid="order-qty" className="mt-1 text-sm font-medium">
                {order.allocatedQty}/{order.qtyOrdered}
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-state-execute"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
            <div>
              <div className="text-xs text-foreground/50">Order date (sim)</div>
              <div className="mt-1 text-sm">{formatSimTime(order.orderDate)}</div>
            </div>
            <div>
              <div className="text-xs text-foreground/50">Due date (sim)</div>
              <div className="mt-1 text-sm">{formatSimTime(order.dueDate)}</div>
            </div>
            <div>
              <div className="text-xs text-foreground/50">Shipped (sim)</div>
              <div className="mt-1 text-sm">{formatSimTime(order.shippedAt)}</div>
            </div>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-foreground/50">Loading…</p>
        )}
      </Card>

      {headline && (
        <Card
          data-testid="order-headline"
          className={
            order?.status === "ON_TIME"
              ? "border-state-execute/30 bg-state-execute/5"
              : "border-state-down/30 bg-state-down/5"
          }
        >
          <p className="text-base font-medium leading-relaxed">{headline}</p>
        </Card>
      )}

      {order && (order.status === "LATE" || order.status === "AT_RISK") && (
        <Card>
          <h2 className="mb-3 text-sm font-medium text-foreground/70">
            Contributing loss events {losses.length > 0 && `(ranked by estimated lost units)`}
          </h2>
          {losses.length > 0 ? (
            <div data-testid="loss-list" className="space-y-2">
              {losses.map((loss, i) => (
                <Link
                  key={`${loss.machineId ?? "m"}-${loss.windowStart}-${i}`}
                  href={deepLinkHref(loss)}
                  data-testid="loss-row"
                  data-est-units={loss.estLostUnits ?? ""}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2.5 text-sm transition-colors hover:border-white/25 hover:bg-white/[0.05]"
                >
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                      FACTOR_BADGE_CLASS[LOSS_FACTOR[loss.category as keyof typeof LOSS_FACTOR]] ??
                      "border-white/15 bg-white/5 text-foreground/60"
                    }`}
                  >
                    {CATEGORY_LABELS[loss.category] ?? loss.category}
                  </span>
                  <span className="font-medium">{loss.reasonLabel ?? "—"}</span>
                  {loss.injected && (
                    <span className="rounded-full border border-state-down/40 bg-state-down/10 px-2 py-0.5 text-xs font-medium text-state-down">
                      INJECTED
                    </span>
                  )}
                  <span className="font-mono text-xs text-foreground/50">
                    {loss.lineName} · {loss.machineId ?? "—"}
                  </span>
                  <span className="text-xs text-foreground/50">
                    {formatHHmm(loss.windowStart)}–{formatHHmm(loss.windowEnd)}
                  </span>
                  <span className="ml-auto text-xs text-foreground/70">
                    {loss.lostTimeSec != null ? `${(loss.lostTimeSec / 60).toFixed(1)} min` : "—"}
                  </span>
                  <span className="font-mono text-sm font-semibold">
                    ~{loss.estLostUnits != null ? Math.round(loss.estLostUnits) : "—"} units
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-foreground/50">
              No attributable loss events found for this order&apos;s production window.
            </p>
          )}
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-medium text-foreground/70">Allocations</h2>
        {allocations.length > 0 ? (
          <table data-testid="allocations-table" className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-foreground/50">
                <th className="py-2 pr-4 font-medium">Line</th>
                <th className="py-2 pr-4 font-medium">Machine</th>
                <th className="py-2 pr-4 font-medium">Qty</th>
                <th className="py-2 pr-4 font-medium">Produced (sim)</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((a) => (
                <tr key={a.id} data-testid="allocation-row" className="border-b border-white/5 last:border-0">
                  <td className="py-2 pr-4 font-mono">{a.lineId}</td>
                  <td className="py-2 pr-4 font-mono">{a.machineId}</td>
                  <td className="py-2 pr-4">{a.qty}</td>
                  <td className="py-2 pr-4">{formatSimTime(a.producedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-foreground/50">No production allocated to this order yet.</p>
        )}
      </Card>
    </div>
  );
}
