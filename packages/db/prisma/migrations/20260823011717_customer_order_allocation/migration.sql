-- NOTE: `prisma migrate dev`'s diff engine proposed dropping
-- "machine_event_simTime_idx" here because that index is hand-authored raw
-- SQL in packages/db/src/views.sql / the 20260822010000_oee_views migration
-- (not declared via a Prisma @@index, since MachineEvent has no matching
-- schema.prisma index) — it is load-bearing for v_shift_windows's MIN/MAX
-- bounds lookup (see views.sql's own comment). Deliberately dropped from
-- this migration to avoid destroying that index on every fresh
-- `docker compose up` (04-01-PLAN.md deviation, Rule 1 — auto-fix a bug
-- introduced by the raw diff).

-- CreateTable
CREATE TABLE "customer_order" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "qtyOrdered" INTEGER NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "shippedAt" TIMESTAMP(3),

    CONSTRAINT "customer_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "producedAt" TIMESTAMP(3) NOT NULL,
    "sourceEventId" BIGINT NOT NULL,

    CONSTRAINT "allocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_order_productId_dueDate_idx" ON "customer_order"("productId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_orderId_sourceEventId_key" ON "allocation"("orderId", "sourceEventId");

-- AddForeignKey
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "customer_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
