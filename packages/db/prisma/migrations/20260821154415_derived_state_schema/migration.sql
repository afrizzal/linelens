-- CreateTable
CREATE TABLE "state_interval" (
    "id" BIGSERIAL NOT NULL,
    "machineId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "reasonCode" TEXT,
    "injected" BOOLEAN NOT NULL DEFAULT false,
    "sourceEventId" BIGINT NOT NULL,

    CONSTRAINT "state_interval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loss_event" (
    "id" BIGSERIAL NOT NULL,
    "machineId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "factor" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "lostTimeSec" DOUBLE PRECISION NOT NULL,
    "lostUnits" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "injected" BOOLEAN NOT NULL DEFAULT false,
    "stateIntervalId" BIGINT,
    "sourceEventId" BIGINT NOT NULL DEFAULT 0,
    "shiftDate" TEXT,
    "shiftId" TEXT,

    CONSTRAINT "loss_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "changeoverAsPlanned" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "engine_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_cursor" (
    "machineId" TEXT NOT NULL,
    "lastEventId" BIGINT NOT NULL,
    "lastSeq" INTEGER NOT NULL,

    CONSTRAINT "machine_cursor_pkey" PRIMARY KEY ("machineId")
);

-- CreateIndex
CREATE INDEX "state_interval_machineId_startTime_idx" ON "state_interval"("machineId", "startTime");

-- CreateIndex
CREATE INDEX "state_interval_lineId_startTime_idx" ON "state_interval"("lineId", "startTime");

-- CreateIndex
CREATE INDEX "loss_event_lineId_windowStart_idx" ON "loss_event"("lineId", "windowStart");

-- CreateIndex
CREATE INDEX "loss_event_category_windowStart_idx" ON "loss_event"("category", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "loss_event_machineId_category_reasonCode_windowStart_source_key" ON "loss_event"("machineId", "category", "reasonCode", "windowStart", "sourceEventId");
