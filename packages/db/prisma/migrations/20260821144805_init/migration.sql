-- CreateTable
CREATE TABLE "line" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "idealCycleTimeSec" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "changeoverTargetMin" DOUBLE PRECISION NOT NULL,
    "startupWindowMin" DOUBLE PRECISION NOT NULL,
    "currentProductId" TEXT,

    CONSTRAINT "machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "breaks" JSONB NOT NULL,

    CONSTRAINT "shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reason_code" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,

    CONSTRAINT "reason_code_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "machine_event" (
    "id" BIGSERIAL NOT NULL,
    "machineId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "simTime" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" INTEGER NOT NULL,
    "state" TEXT,
    "reasonCode" TEXT,
    "goodDelta" INTEGER,
    "rejectDelta" INTEGER,
    "rejectReason" TEXT,
    "idealCycleTimeSec" DOUBLE PRECISION,
    "productId" TEXT,
    "durationSec" DOUBLE PRECISION,
    "meta" JSONB,

    CONSTRAINT "machine_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_clock" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "epochSimMs" BIGINT NOT NULL,
    "startedAtRealMs" BIGINT NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "pausedAtRealMs" BIGINT,

    CONSTRAINT "sim_clock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "machine_event_machineId_simTime_idx" ON "machine_event"("machineId", "simTime");

-- CreateIndex
CREATE UNIQUE INDEX "machine_event_machineId_seq_key" ON "machine_event"("machineId", "seq");

-- AddForeignKey
ALTER TABLE "machine" ADD CONSTRAINT "machine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine" ADD CONSTRAINT "machine_currentProductId_fkey" FOREIGN KEY ("currentProductId") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- sim_now(): the SQL source of truth for "now" in sim-time, mirroring
-- @linelens/contracts simNow() (sim-clock.ts). HAND-WRITTEN — not
-- Prisma-generated. sim_clock columns are epoch-MILLIS BigInts (NOT
-- timestamptz), so this does the millis math directly and divides by
-- 1000.0 only at the very end when handing the result to to_timestamp().
-- A x1000 slip here breaks every downstream Availability/Performance clamp
-- that reads sim_now() for an open (in-progress) interval — see the
-- correctness bar in .planning/phases/02-oee-engine/02-01-PLAN.md.
CREATE OR REPLACE FUNCTION sim_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT to_timestamp((
    c."epochSimMs" +
    (COALESCE(c."pausedAtRealMs", (extract(epoch FROM clock_timestamp()) * 1000)::bigint) - c."startedAtRealMs") * c."speed"
  ) / 1000.0)
  FROM "sim_clock" c WHERE c.id = 1
$$;
