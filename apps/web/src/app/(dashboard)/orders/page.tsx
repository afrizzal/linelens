"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLive } from "@/hooks/use-live";
import { useSimClock } from "@/hooks/use-sim-clock";
import { Card } from "@/components/ui/card";
import { StatusChip } from "@/components/orders/status-chip";

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

interface DifotRow {
  dueDay: string;
  totalDue: number;
  onTimeCount: number;
  difotPct: number | null;
}

interface DifotLineRow extends DifotRow {
  lineId: string;
}

interface OrdersResponse {
  day: string;
  difot: DifotRow | null;
  difotYesterday: DifotRow | null;
  byLine: DifotLineRow[];
  orders: OrderStatusRow[];
}

const formatPct = (v: number | null | undefined): string => (v == null ? "N/A" : `${Math.round(v * 100)}%`);

const formatSimTime = (iso: string): string => {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
};

/**
 * Orders screen (04-01-PLAN.md Task 3, DIFOT-01): DIFOT KPI tile with a
 * trend vs yesterday, per-line DIFOT contribution, and the order table.
 * Row click navigates to the stub detail page (04-02 completes it with the
 * loss-event drill-down). N/A NEVER 0 (project rule): a due-day with zero
 * orders due renders "N/A", never "DIFOT 0%".
 */
export default function OrdersPage() {
  const [day, setDay] = useState("");
  const [data, setData] = useState<OrdersResponse | null>(null);

  const simClock = useSimClock();

  useEffect(() => {
    if (day || !simClock.simNow) return;
    setDay(simClock.simNow.toISOString().slice(0, 10));
  }, [day, simClock.simNow]);

  const fetchOrders = useCallback(() => {
    if (!day) return;
    fetch(`/api/orders?day=${day}`)
      .then((res) => res.json())
      .then((json: OrdersResponse) => setData(json))
      .catch(() => {});
  }, [day]);

  useLive(fetchOrders);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const difot = data?.difot ?? null;
  const difotYesterday = data?.difotYesterday ?? null;
  const trendPct =
    difot?.difotPct != null && difotYesterday?.difotPct != null
      ? Math.round((difot.difotPct - difotYesterday.difotPct) * 100)
      : null;

  const orders = data?.orders ?? [];
  const byLine = data?.byLine ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Orders</h1>
        <input
          type="date"
          aria-label="Due date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="rounded-md border border-white/15 bg-panel px-3 py-1.5 text-sm text-foreground outline-none focus:border-white/30"
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-sm text-foreground/60">DIFOT</div>
            <div className={`mt-1 text-3xl font-bold ${difot ? "text-foreground" : "text-foreground/40"}`}>
              {formatPct(difot?.difotPct)}
            </div>
            <div className="mt-1 text-sm text-foreground/50">
              {difot ? `${difot.onTimeCount}/${difot.totalDue} orders on time, in full` : "No orders due this day"}
            </div>
          </div>
          {trendPct != null && (
            <div className={`text-sm font-medium ${trendPct >= 0 ? "text-state-execute" : "text-state-down"}`}>
              {trendPct >= 0 ? "+" : ""}
              {trendPct}pp vs yesterday
            </div>
          )}
        </div>
      </Card>

      {byLine.length > 0 && (
        <Card>
          <h2 className="mb-3 text-sm font-medium text-foreground/70">DIFOT by line</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {byLine.map((l) => (
              <div key={l.lineId} className="rounded-md border border-white/10 bg-background/40 p-3">
                <div className="text-xs text-foreground/50">{l.lineId}</div>
                <div className="mt-1 text-lg font-semibold">{formatPct(l.difotPct)}</div>
                <div className="text-xs text-foreground/40">
                  {l.onTimeCount}/{l.totalDue} on time
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        {orders.length > 0 ? (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-foreground/50">
                <th className="py-2 pr-4 font-medium">Customer</th>
                <th className="py-2 pr-4 font-medium">Product</th>
                <th className="py-2 pr-4 font-medium">Qty (allocated/ordered)</th>
                <th className="py-2 pr-4 font-medium">Due (sim)</th>
                <th className="py-2 pr-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.orderId} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                  <td className="py-2 pr-4">
                    <Link href={`/orders/${o.orderId}`} className="hover:underline">
                      {o.customer}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 font-mono">{o.productId}</td>
                  <td className="py-2 pr-4">
                    {o.allocatedQty}/{o.qtyOrdered}
                  </td>
                  <td className="py-2 pr-4">{formatSimTime(o.dueDate)}</td>
                  <td className="py-2 pr-4">
                    <StatusChip status={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-16 text-center text-sm text-foreground/50">No orders due this day — N/A.</p>
        )}
      </Card>
    </div>
  );
}
