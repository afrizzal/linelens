"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLive } from "@/hooks/use-live";
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

interface AllocationRow {
  id: string;
  lineId: string;
  machineId: string;
  qty: number;
  producedAt: string;
}

interface OrderDetailResponse {
  order: OrderStatusRow;
  allocations: AllocationRow[];
}

const formatSimTime = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
};

/**
 * Order detail — STUB page (04-01-PLAN.md Task 3): order facts + allocations
 * list only. 04-02 completes this page with the money-shot drill-down
 * ("Line 2 breakdown 14:20-15:05 cost ~180 units -> this order is 120
 * short") once loss_event attribution is wired in.
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/orders" className="text-sm text-foreground/60 hover:underline">
          ← Back to Orders
        </Link>
        {order && <StatusChip status={order.status} />}
      </div>

      <Card>
        {order ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs text-foreground/50">Customer</div>
              <div className="mt-1 text-sm font-medium">{order.customer}</div>
            </div>
            <div>
              <div className="text-xs text-foreground/50">Product</div>
              <div className="mt-1 font-mono text-sm">{order.productId}</div>
            </div>
            <div>
              <div className="text-xs text-foreground/50">Qty (allocated/ordered)</div>
              <div className="mt-1 text-sm font-medium">
                {order.allocatedQty}/{order.qtyOrdered}
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

      <Card>
        <h2 className="mb-3 text-sm font-medium text-foreground/70">Allocations</h2>
        {allocations.length > 0 ? (
          <table className="w-full text-left text-sm">
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
                <tr key={a.id} className="border-b border-white/5 last:border-0">
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
