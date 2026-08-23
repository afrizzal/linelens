-- =========================================================================
-- v_order_status / v_difot / v_difot_line: DIFOT-01 (04-01-PLAN.md Task 2).
-- customer_order + allocation are the FIFO fulfillment side of the bridge —
-- "in-full" is implied by the ship rule in apps/worker/src/orders/
-- allocate.ts (an order only ships when Sigma(allocation.qty) reaches
-- qtyOrdered), so DIFOT% here is genuinely on-time-AND-in-full without a
-- separate in-full flag.
--
-- current_good_rate (used by the AT_RISK projection below) is measured
-- directly off machine_event.productId (the COUNTS event's OWN reported
-- product), NOT a join through machine.currentProductId — more precise,
-- since a machine mid-changeover no longer reflects the product it's about
-- to run. The trailing-60-sim-min window and the FALLBACK ideal rate (used
-- when that window has zero output, e.g. a fresh shift) both go through
-- `sim_now() AT TIME ZONE 'UTC'` per the sim-time cast convention above.
-- =========================================================================
CREATE OR REPLACE VIEW v_order_status AS
WITH allocated AS (
  SELECT "orderId", SUM(qty)::double precision AS "allocatedQty"
  FROM allocation
  GROUP BY "orderId"
),
-- Measured rate: good units/sec for this product over the trailing 60
-- sim-minutes, across every line currently producing it.
recent_rate AS (
  SELECT "productId", SUM(COALESCE("goodDelta", 0))::double precision / 3600.0 AS "goodPerSec"
  FROM machine_event
  WHERE kind = 'COUNTS'
    AND "simTime" >= (sim_now() AT TIME ZONE 'UTC') - interval '60 minutes'
    AND "simTime" < (sim_now() AT TIME ZONE 'UTC')
  GROUP BY "productId"
),
-- Fallback ideal rate: machine-count x (1/ICT) for machines CURRENTLY
-- assigned this product — only used when recent_rate has no/zero output
-- (fresh shift), so AT_RISK doesn't false-trigger before any counts exist.
fallback_rate AS (
  SELECT m."currentProductId" AS "productId",
    (COUNT(*)::double precision / NULLIF(p."idealCycleTimeSec", 0)) AS "goodPerSec"
  FROM machine m
  JOIN product p ON p.id = m."currentProductId"
  WHERE m."currentProductId" IS NOT NULL
  GROUP BY m."currentProductId", p."idealCycleTimeSec"
),
rate AS (
  SELECT pr.id AS "productId",
    COALESCE(NULLIF(rr."goodPerSec", 0), fr."goodPerSec", 0) AS "goodPerSec"
  FROM product pr
  LEFT JOIN recent_rate rr ON rr."productId" = pr.id
  LEFT JOIN fallback_rate fr ON fr."productId" = pr.id
),
enriched AS (
  SELECT
    co.id AS "orderId",
    co."productId",
    co.customer,
    co."qtyOrdered",
    co."orderDate",
    co."dueDate",
    co."shippedAt",
    COALESCE(al."allocatedQty", 0) AS "allocatedQty",
    GREATEST(0::double precision, co."qtyOrdered" - COALESCE(al."allocatedQty", 0)) AS "remainingQty",
    -- max(epsilon, current_good_rate) — never divide by zero.
    GREATEST(COALESCE(r."goodPerSec", 0), 0.0001) AS "goodPerSec"
  FROM customer_order co
  LEFT JOIN allocated al ON al."orderId" = co.id
  LEFT JOIN rate r ON r."productId" = co."productId"
)
SELECT
  e."orderId",
  e."productId",
  e.customer,
  e."qtyOrdered",
  e."orderDate",
  e."dueDate",
  e."shippedAt",
  e."allocatedQty",
  e."remainingQty",
  -- projected_finish = sim_now() + remaining_qty / current_good_rate — NO
  -- ICT factor (units x sec/unit / units/sec is dimensionally wrong and
  -- would inflate the projection ~ICT-fold, per Task 2's explicit warning).
  (sim_now() AT TIME ZONE 'UTC') + make_interval(secs => e."remainingQty" / e."goodPerSec") AS "projectedFinish",
  CASE
    WHEN e."shippedAt" IS NOT NULL AND e."shippedAt" <= e."dueDate" THEN 'ON_TIME'
    WHEN e."shippedAt" IS NOT NULL THEN 'LATE'
    WHEN e."dueDate" < (sim_now() AT TIME ZONE 'UTC') THEN 'LATE'
    WHEN (sim_now() AT TIME ZONE 'UTC') + make_interval(secs => e."remainingQty" / e."goodPerSec") > e."dueDate" THEN 'AT_RISK'
    ELSE 'OPEN'
  END AS status
FROM enriched e;

-- v_difot: per due-day, DIFOT% = count(ON_TIME) / count(due that day).
-- "In-full" is implied by the ship rule (see v_order_status header) — no
-- separate in-full flag needed (DIFOT-01).
CREATE OR REPLACE VIEW v_difot AS
SELECT
  os."dueDate"::date::text AS "dueDay",
  COUNT(*) AS "totalDue",
  COUNT(*) FILTER (WHERE os.status = 'ON_TIME') AS "onTimeCount",
  (COUNT(*) FILTER (WHERE os.status = 'ON_TIME'))::double precision / NULLIF(COUNT(*), 0) AS "difotPct"
FROM v_order_status os
GROUP BY os."dueDate"::date;

-- v_difot_line: per (line, due-day), DIFOT% attributed to the line with the
-- LARGEST allocated qty for each order (tie -> lowest lineId). Orders with
-- NO allocations yet (goodDelta never touched this order) are excluded —
-- there is no line to attribute an untouched order to (row-absence = N/A,
-- not a false 0%, matching the project-wide convention). 04-03's escalation
-- rule ("line DIFOT < 80%") reads this view.
CREATE OR REPLACE VIEW v_difot_line AS
WITH order_line_qty AS (
  SELECT a."orderId", a."lineId", SUM(a.qty) AS qty
  FROM allocation a
  GROUP BY a."orderId", a."lineId"
),
order_line AS (
  SELECT DISTINCT ON (olq."orderId") olq."orderId", olq."lineId"
  FROM order_line_qty olq
  ORDER BY olq."orderId", olq.qty DESC, olq."lineId" ASC
)
SELECT
  ol."lineId",
  os."dueDate"::date::text AS "dueDay",
  COUNT(*) AS "totalDue",
  COUNT(*) FILTER (WHERE os.status = 'ON_TIME') AS "onTimeCount",
  (COUNT(*) FILTER (WHERE os.status = 'ON_TIME'))::double precision / NULLIF(COUNT(*), 0) AS "difotPct"
FROM v_order_status os
JOIN order_line ol ON ol."orderId" = os."orderId"
GROUP BY ol."lineId", os."dueDate"::date;
