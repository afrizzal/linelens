-- =========================================================================
-- order_drilldown_context / order_loss_drilldown: DIFOT-02 (04-02-PLAN.md
-- Task 1). THE bridge query — given a late/at-risk order, resolve the
-- line(s) producing its product, rank the loss_event rows overlapping the
-- order's production window by estimated lost units, and carry the order's
-- shortfall (shortUnits) alongside so the drill-down headline ("cost ~N
-- units -> this order is M short") is arithmetically checkable.
--
-- On-read SQL function (data volume tiny — ARCHITECTURE.md Pattern 2), not
-- a materialized table: always-current beats precomputed here.
--
-- order_drilldown_context resolves shared per-order facts ONCE (window
-- bounds, product, shortUnits), so order_loss_drilldown doesn't duplicate
-- that logic — a LEFT JOIN from context to the ranked loss rows guarantees
-- at least one output row (context populated, loss columns NULL) even for
-- an order with zero overlapping losses, so shortUnits/totalEstLostUnits
-- are never silently dropped just because the top-12 loss list is empty.
--
-- shortUnits = qtyOrdered - allocated_at_due (allocation.qty summed only
-- for rows produced AT OR BEFORE dueDate) — NOT "remaining now": for a
-- LATE order production may keep accumulating past its due date while the
-- order stays open, which would understate the shortfall it actually
-- missed its promise by. 0 when the order shipped on/before its due date.
--
-- window = [orderDate, COALESCE(shippedAt, GREATEST(dueDate, sim_now()))],
-- per the SIM-TIME CAST RULE above: every bare sim_now() comparison goes
-- through `sim_now() AT TIME ZONE 'UTC'`.
-- =========================================================================
CREATE OR REPLACE FUNCTION order_drilldown_context(p_order_id text)
RETURNS TABLE (
  "orderId" text,
  "productId" text,
  "windowStart" timestamp,
  "windowEnd" timestamp,
  "shortUnits" double precision
) LANGUAGE sql STABLE AS $$
  WITH ord AS (
    SELECT co.id, co."productId", co."orderDate", co."dueDate", co."shippedAt", co."qtyOrdered"
    FROM customer_order co
    WHERE co.id = p_order_id
  ),
  allocated_at_due AS (
    SELECT COALESCE(SUM(a.qty), 0)::double precision AS qty
    FROM allocation a
    JOIN ord o ON a."orderId" = o.id
    WHERE a."producedAt" <= o."dueDate"
  )
  SELECT
    o.id AS "orderId",
    o."productId",
    o."orderDate" AS "windowStart",
    COALESCE(o."shippedAt", GREATEST(o."dueDate", (sim_now() AT TIME ZONE 'UTC'))) AS "windowEnd",
    GREATEST(0::double precision, o."qtyOrdered" - (SELECT qty FROM allocated_at_due)) AS "shortUnits"
  FROM ord o
$$;

-- Ranked (limit 12) loss_event rows overlapping the order's production
-- window on the line(s) that ran its product, plus (denormalized onto
-- every row, cheap at this volume) the order's shortUnits and the FULL
-- (unlimited) totalEstLostUnits sum — so a caller only fetching the top 12
-- for display still sees the true total for the "losses >= shortfall"
-- coherence check, not a total truncated by the display limit.
CREATE OR REPLACE FUNCTION order_loss_drilldown(p_order_id text)
RETURNS TABLE (
  category text,
  "reasonLabel" text,
  "machineId" text,
  "lineId" text,
  "windowStart" timestamp,
  "windowEnd" timestamp,
  "lostTimeSec" double precision,
  "estLostUnits" double precision,
  injected boolean,
  "shiftDate" text,
  "shiftId" text,
  "shortUnits" double precision,
  "totalEstLostUnits" double precision
) LANGUAGE sql STABLE AS $$
  WITH ctx AS (
    SELECT * FROM order_drilldown_context(p_order_id)
  ),
  -- Lines whose machines run the order's product: EITHER currently
  -- assigned (machine.currentProductId) OR reported a COUNTS event for it
  -- inside the order's window (product rotation -> multiple lines possible
  -- over the window's lifetime).
  producing_lines AS (
    SELECT DISTINCT m."lineId"
    FROM machine m, ctx
    WHERE m."currentProductId" = ctx."productId"
    UNION
    SELECT DISTINCT me."lineId"
    FROM machine_event me, ctx
    WHERE me.kind = 'COUNTS'
      AND me."productId" = ctx."productId"
      AND me."simTime" >= ctx."windowStart" AND me."simTime" < ctx."windowEnd"
  ),
  ict AS (
    SELECT p."idealCycleTimeSec" AS sec FROM product p, ctx WHERE p.id = ctx."productId"
  ),
  losses AS (
    SELECT
      le.category,
      COALESCE(rc.label, le."reasonCode") AS "reasonLabel",
      le."machineId",
      le."lineId",
      le."windowStart",
      le."windowEnd",
      le."lostTimeSec",
      -- AVAILABILITY/PERFORMANCE: units the line would have produced in
      -- the lost time, at the order's OWN product ICT (never the
      -- machine's momentarily-current product). QUALITY: the reject count
      -- directly (already unit-denominated) — docs/00-domain-research.md
      -- §3 loss-to-unit conversion, same rule 04-02-PLAN.md Task 1 states.
      CASE
        WHEN le.factor = 'QUALITY' THEN le."lostUnits"
        ELSE le."lostTimeSec" / NULLIF((SELECT sec FROM ict), 0)
      END AS "estLostUnits",
      le.injected,
      -- Carried straight off loss_event (already populated by
      -- apps/worker/src/derive/losses.ts — no extra join needed) so the
      -- web layer can deep-link the timeline picker directly to the
      -- shift this loss happened in, per the DEEP-LINK MECHANISM note
      -- (04-02-PLAN.md Task 2): explicitly SET shiftDate/shiftId from the
      -- loss row rather than relying on the timeline page's broken
      -- mount-time default seeding.
      le."shiftDate",
      le."shiftId"
    FROM loss_event le
    JOIN producing_lines pl ON pl."lineId" = le."lineId"
    CROSS JOIN ctx
    LEFT JOIN reason_code rc ON rc.code = le."reasonCode"
    WHERE le."windowStart" < ctx."windowEnd" AND le."windowEnd" > ctx."windowStart"
  )
  SELECT
    l.category,
    l."reasonLabel",
    l."machineId",
    l."lineId",
    l."windowStart",
    l."windowEnd",
    l."lostTimeSec",
    l."estLostUnits",
    l.injected,
    l."shiftDate",
    l."shiftId",
    ctx."shortUnits",
    COALESCE((SELECT SUM(x."estLostUnits") FROM losses x), 0) AS "totalEstLostUnits"
  FROM ctx
  LEFT JOIN losses l ON true
  ORDER BY l."estLostUnits" DESC NULLS LAST
  LIMIT 12
$$;
