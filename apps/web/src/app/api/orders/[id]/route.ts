import { db } from "@/lib/db";

/**
 * GET /api/orders/[id] — one order's v_order_status row + its allocation
 * list (04-01-PLAN.md Task 3 stub detail page; 04-02 completes this page
 * with the loss-event drill-down, this route only needs to exist so the
 * stub can render "order facts + allocations list").
 */
export const dynamic = "force-dynamic";

interface OrderStatusRow {
  orderId: string;
  productId: string;
  customer: string;
  qtyOrdered: number;
  orderDate: Date;
  dueDate: Date;
  shippedAt: Date | null;
  allocatedQty: number;
  remainingQty: number;
  projectedFinish: Date;
  status: string;
}

interface AllocationRow {
  id: string;
  lineId: string;
  machineId: string;
  qty: number;
  producedAt: Date;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;

  const [orderRows, allocations] = await Promise.all([
    db.$queryRaw<OrderStatusRow[]>`SELECT * FROM v_order_status WHERE "orderId" = ${id}`,
    db.$queryRaw<AllocationRow[]>`
      SELECT id, "lineId", "machineId", qty, "producedAt"
      FROM allocation
      WHERE "orderId" = ${id}
      ORDER BY "producedAt" ASC
    `,
  ]);

  const order = orderRows[0] ?? null;
  if (!order) {
    return Response.json({ error: "order not found" }, { status: 404 });
  }

  return Response.json({ order, allocations });
}
