-- LineLens OEE SQL views — THE credibility gate (02-03-PLAN.md Task 1).
-- Formulas verbatim from docs/00-domain-research.md §2 ("preferred
-- calculation"): Availability = Run Time / Planned Production Time,
-- Performance = (Ideal Cycle Time x Total Count) / Run Time,
-- Quality = Good Count / Total Count, OEE = A x P x Q.
--
-- THIS FILE IS THE SINGLE SOURCE OF TRUTH for the view definitions. It is
-- applied verbatim by the migration in
-- packages/db/prisma/migrations/<timestamp>_oee_views/migration.sql (Prisma
-- has no first-class "view" schema object in this project's generator
-- setup, so the migration is a hand-written copy of this file's SQL). If you
-- ever change these views, you MUST create a NEW migration (migrations are
-- immutable once applied) that re-applies the updated content of this file —
-- do not edit an old migration file in place.
--
-- CONVENTION (see 02-02-SUMMARY.md "Convention for 02-03", proven by
-- apps/worker/test/sim-now-timezone.test.ts): every sim-time column
-- (machine_event.simTime, state_interval.startTime/endTime,
-- loss_event.windowStart/windowEnd) is `timestamp(3) WITHOUT TIME ZONE`
-- (naive), but sim_now() returns `timestamptz`. Every comparison/clamp
-- against sim_now() in this file goes through `sim_now() AT TIME ZONE
-- 'UTC'` (which converts to a session-TimeZone-INDEPENDENT naive UTC
-- value) — NEVER bare `sim_now()`, or the clamp silently shifts under a
-- non-UTC Postgres session.
--
-- ENG-05 (Performance > 100% guard): "ictMisconfigured" is a FLAG, never a
-- clamp — performance is never capped at 1.0 anywhere in this file.
--
-- Row-absence = N/A (PITFALLS.md Pitfall 2): v_machine_shift_oee emits NO
-- ROW for a (machine, shift) with zero machine_event rows in that shift's
-- window — never a zero-filled row. The API layer must treat a missing row
-- as N/A, never as 0%/NaN%.
--
-- PPT-vs-calendar bug guard (PITFALLS.md Pitfall 2/PITFALLS.md "classic
-- double-subtraction"): break_overlap_seconds() is applied BOTH when
-- computing Planned Production Time (v_shift_windows.pptSec, which already
-- excludes breaks) AND, defensively, when summing DOWN/CHANGEOVER interval
-- seconds — a DOWN/CHANGEOVER interval that happens to overlap a break
-- window must not have that overlap subtracted from PPT a second time via
-- an inflated down/changeover sum. In normal operation the simulator emits
-- BREAK state changes at break boundaries so this defense is usually a
-- no-op (down/changeover intervals don't span breaks) — but the view must
-- not depend on producer discipline for this invariant to hold.

-- Supports v_shift_windows's MIN/MAX(simTime) bounds lookup (see below) via
-- an index-scan-limit-1 instead of a full-table scan. The existing
-- machine_event_machineId_simTime_idx is composite with machineId leading,
-- so it cannot serve a global (all-machines) MIN/MAX(simTime) query.
CREATE INDEX IF NOT EXISTS "machine_event_simTime_idx" ON "machine_event"("simTime");

-- =========================================================================
-- break_overlap_seconds: total seconds of overlap between a shift's break
-- windows (p_breaks, a jsonb array of {startMin,endMin} — MINUTES FROM
-- SIM-MIDNIGHT of p_day_midnight, matching @linelens/contracts
-- calendar.ts's breaksWithin() convention, NOT minutes-from-shift-start)
-- and an arbitrary [p_window_start, p_window_end) range. Used both for PPT
-- (v_shift_windows) and for the defensive DOWN/CHANGEOVER break-exclusion
-- (v_machine_shift_oee) — one implementation, two call sites, so the two
-- can never drift apart.
-- =========================================================================
CREATE OR REPLACE FUNCTION break_overlap_seconds(
  p_breaks jsonb,
  p_day_midnight timestamp,
  p_window_start timestamp,
  p_window_end timestamp
) RETURNS double precision LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(
    GREATEST(0::double precision, EXTRACT(EPOCH FROM (
      LEAST(p_window_end, p_day_midnight + make_interval(mins => (b->>'endMin')::int))
      - GREATEST(p_window_start, p_day_midnight + make_interval(mins => (b->>'startMin')::int))
    )))
  ), 0)
  FROM jsonb_array_elements(p_breaks) AS b
  WHERE p_window_end > p_window_start
$$;

-- =========================================================================
-- v_shift_windows: one row per (shiftDate, shiftId) shift INSTANCE, for
-- every sim-day that has at least one machine_event row (avoids an
-- unbounded generate_series — a shift instance nobody has any telemetry
-- for is not interesting to any downstream view). effectiveEnd clamps the
-- shift to sim_now() (ENG-06 open-window clamping: "so far this shift"),
-- and pptSec is the FULL Planned Production Time single-truth computation
-- — mirrors @linelens/contracts calendar.ts plannedProductionTimeMs()
-- EXACTLY:
--   ppt = (min(shiftEnd, clamp) - shiftStart) - sum(break overlap in that window)
--   if effectiveEnd <= shiftStart: ppt = 0
-- The mandatory PPT single-truth cross-check (02-03-PLAN.md Task 1
-- <verify>) asserts this SQL and the TS function agree to the second
-- across a grid of clamp instants — see apps/worker/test/golden.test.ts.
-- =========================================================================
-- Bounded by MIN/MAX simTime (cheap via the machine_event_simTime_idx index
-- below — a single index-scan-limit-1 lookup each), NOT a `SELECT DISTINCT
-- simTime::date` over every row: at demo/retention-cap scale this is a
-- handful of days, but a DISTINCT-over-380k-rows scan is exactly what blew
-- the <50ms EXPLAIN budget in Task 1's <verify> during live testing
-- (776ms without JIT, 2.3s with — re-run 3x inside v_machine_shift_oee's
-- own CTEs, since this view is referenced multiple times downstream).
CREATE OR REPLACE VIEW v_shift_windows AS
WITH bounds AS (
  SELECT min("simTime")::date AS min_date, max("simTime")::date AS max_date FROM machine_event
),
days AS (
  SELECT generate_series(b.min_date, b.max_date, interval '1 day')::date AS shift_date
  FROM bounds b
  WHERE b.min_date IS NOT NULL
),
instances AS (
  SELECT
    d.shift_date,
    s.id AS "shiftId",
    d.shift_date::timestamp AS "dayMidnight",
    (d.shift_date::timestamp + make_interval(mins => s."startMin")) AS "shiftStart",
    (d.shift_date::timestamp + make_interval(mins => s."endMin")) AS "shiftEnd",
    s.breaks AS "breaksJson"
  FROM days d
  CROSS JOIN "shift" s
)
SELECT
  i.shift_date::text AS "shiftDate",
  i."shiftId",
  i."dayMidnight",
  i."shiftStart",
  i."shiftEnd",
  LEAST(i."shiftEnd", (sim_now() AT TIME ZONE 'UTC')) AS "effectiveEnd",
  i."breaksJson",
  GREATEST(0::double precision,
    EXTRACT(EPOCH FROM (LEAST(i."shiftEnd", (sim_now() AT TIME ZONE 'UTC')) - i."shiftStart"))
    - break_overlap_seconds(
        i."breaksJson", i."dayMidnight", i."shiftStart",
        LEAST(i."shiftEnd", (sim_now() AT TIME ZONE 'UTC'))
      )
  ) AS "pptSec"
FROM instances i;

-- =========================================================================
-- v_machine_shift_oee: the preferred-calculation OEE per (machine,
-- shiftDate, shiftId), all time quantities in SECONDS, every interval
-- clamped to [shiftStart, effectiveEnd) — matches 02-02's rule 4
-- (finalizeShiftSlowCycles) run-time math so the SQL waterfall and the TS
-- ledger never drift apart. Aggregate NULLs propagate naturally through SQL
-- arithmetic (e.g. runSec=0 -> performance = x/NULLIF(0,0) = NULL, never a
-- divide-by-zero error and never a false 0%).
-- =========================================================================
CREATE OR REPLACE VIEW v_machine_shift_oee AS
WITH machine_shifts AS (
  -- Row-presence gate: a (machine, shift) pair exists in this view's output
  -- ONLY if at least one machine_event (any kind) falls inside the shift's
  -- clamped window. Zero events => the pair is simply absent = N/A.
  --
  -- PERFORMANCE (load-bearing for the <50ms EXPLAIN budget in Task 1
  -- <verify> — measured at demo volume, ~420k machine_event rows):
  -- deliberately driven from the small `machine` MASTER-DATA table (a
  -- handful of rows) CROSS JOIN v_shift_windows (a few dozen shift
  -- instances) = a couple hundred CANDIDATE pairs, each checked cheaply via
  -- an indexed EXISTS on machine_event(machineId, simTime) — NOT `SELECT
  -- DISTINCT ... FROM machine_event`, which was measured to force either a
  -- full-table scan (776ms) or, once filtered/inlined to dodge that, a
  -- disk-spilling per-reference-site recompute (3x ~330ms) because this CTE
  -- is joined 3 times below (interval_seconds, counts, base) and PG12+
  -- auto-materializes any CTE referenced more than once, which blocks
  -- pushing the outer machineId/shiftDate/shiftId filter down into a
  -- machine_event-driven scan. Deriving candidates from master data instead
  -- of raw events sidesteps the problem entirely: this CTE is cheap to
  -- materialize in full regardless of how the outer query filters it.
  --
  -- A machine_event row for a machineId with NO `machine` master-data row
  -- is, by design, excluded from every OEE view (it never appears here) —
  -- this matches 02-02's own derivation hardening (Finding 2: an unknown
  -- machine's events are skipped-and-logged, never derived into
  -- state_interval/loss_event), so such a machine has no meaningful A/P/Q
  -- to report anyway.
  SELECT m.id AS "machineId", m."lineId", sw."shiftDate", sw."shiftId"
  FROM "machine" m
  CROSS JOIN v_shift_windows sw
  WHERE EXISTS (
    SELECT 1 FROM machine_event me
    WHERE me."machineId" = m.id
      AND me."simTime" >= sw."shiftStart" AND me."simTime" < sw."effectiveEnd"
  )
),
interval_seconds AS (
  -- CROSS JOIN LATERAL (not a plain JOIN) on BOTH state_interval and the
  -- per-interval overlap calc — load-bearing for the <50ms EXPLAIN budget.
  -- A plain `JOIN state_interval si ON si.machineId = ms.machineId AND
  -- si.startTime < sw.effectiveEnd AND ...` measured as a full per-machine
  -- Bitmap Heap Scan (ALL of that machine's history) with the time-window
  -- applied as a post-filter, because the planner won't always synthesize
  -- concrete index bounds from a plain multi-way join's ON conditions. A
  -- LATERAL subquery forces per-(ms,sw)-row correlated evaluation, which
  -- lets the planner bake `sw.shiftStart`/`sw.effectiveEnd` in as literal
  -- Index Cond bounds on state_interval_machineId_startTime_idx.
  SELECT
    ms."machineId", ms."shiftDate", ms."shiftId",
    agg.down_sec, agg.changeover_sec
  FROM machine_shifts ms
  JOIN v_shift_windows sw ON sw."shiftDate" = ms."shiftDate" AND sw."shiftId" = ms."shiftId"
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(SUM(CASE WHEN si.state = 'DOWN' THEN ov.overlap_sec ELSE 0 END), 0) AS down_sec,
      COALESCE(SUM(CASE WHEN si.state = 'CHANGEOVER' THEN ov.overlap_sec ELSE 0 END), 0) AS changeover_sec
    FROM state_interval si
    CROSS JOIN LATERAL (
      -- Clamp the interval to the shift window, THEN defensively subtract
      -- any break overlap within that clamped span (see
      -- break_overlap_seconds doc above — normally zero, never assumed to be).
      SELECT GREATEST(0::double precision,
        EXTRACT(EPOCH FROM (
          LEAST(COALESCE(si."endTime", sw."effectiveEnd"), sw."effectiveEnd")
          - GREATEST(si."startTime", sw."shiftStart")
        ))
        - break_overlap_seconds(
            sw."breaksJson", sw."dayMidnight",
            GREATEST(si."startTime", sw."shiftStart"),
            LEAST(COALESCE(si."endTime", sw."effectiveEnd"), sw."effectiveEnd")
          )
      ) AS overlap_sec
    ) ov
    WHERE si."machineId" = ms."machineId"
      AND si.state IN ('DOWN', 'CHANGEOVER')
      AND si."startTime" < sw."effectiveEnd"
      AND COALESCE(si."endTime", sw."effectiveEnd") > sw."shiftStart"
  ) agg
),
counts AS (
  -- Same LATERAL rationale as interval_seconds above — a plain JOIN was
  -- measured retrieving one machine's ENTIRE COUNTS history (tens of
  -- thousands of rows spanning every shift it ever ran) and post-filtering
  -- by date, instead of using the shift window as an index bound.
  SELECT
    ms."machineId", ms."shiftDate", ms."shiftId",
    agg.total_cnt, agg.good_cnt, agg.ict_sec
  FROM machine_shifts ms
  JOIN v_shift_windows sw ON sw."shiftDate" = ms."shiftDate" AND sw."shiftId" = ms."shiftId"
  CROSS JOIN LATERAL (
    SELECT
      SUM(COALESCE(me."goodDelta", 0) + COALESCE(me."rejectDelta", 0))::double precision AS total_cnt,
      SUM(COALESCE(me."goodDelta", 0))::double precision AS good_cnt,
      -- Per-event ICT (never a global constant) — docs §2 "Ideal Cycle Time
      -- ... a parameter per mesin", carried on every COUNTS event.
      SUM(COALESCE(me."idealCycleTimeSec", 0) * (COALESCE(me."goodDelta", 0) + COALESCE(me."rejectDelta", 0))) AS ict_sec
    FROM machine_event me
    WHERE me."machineId" = ms."machineId"
      AND me.kind = 'COUNTS'
      AND me."simTime" >= sw."shiftStart" AND me."simTime" < sw."effectiveEnd"
  ) agg
),
base AS (
  SELECT
    ms."machineId",
    ms."lineId",
    ms."shiftDate",
    ms."shiftId",
    sw."pptSec" AS "pptSec",
    COALESCE(iv.down_sec, 0) AS "downSec",
    COALESCE(iv.changeover_sec, 0) AS "changeoverSec",
    -- run = ppt - down - changeover, floored at 0 (matches 02-02 rule 4's
    -- Math.max(0, pptMs - downChangeoverMs) exactly — never negative).
    GREATEST(0::double precision, sw."pptSec" - COALESCE(iv.down_sec, 0) - COALESCE(iv.changeover_sec, 0)) AS "runSec",
    COALESCE(c.total_cnt, 0) AS "totalCnt",
    COALESCE(c.good_cnt, 0) AS "goodCnt",
    COALESCE(c.ict_sec, 0) AS "ictSec"
  FROM machine_shifts ms
  JOIN v_shift_windows sw ON sw."shiftDate" = ms."shiftDate" AND sw."shiftId" = ms."shiftId"
  LEFT JOIN interval_seconds iv ON iv."machineId" = ms."machineId" AND iv."shiftDate" = ms."shiftDate" AND iv."shiftId" = ms."shiftId"
  LEFT JOIN counts c ON c."machineId" = ms."machineId" AND c."shiftDate" = ms."shiftDate" AND c."shiftId" = ms."shiftId"
),
calc AS (
  SELECT
    b.*,
    (b."runSec" / NULLIF(b."pptSec", 0)) AS availability,
    (b."ictSec" / NULLIF(b."runSec", 0)) AS performance,
    (b."goodCnt" / NULLIF(b."totalCnt", 0)) AS quality
  FROM base b
)
SELECT
  c."machineId",
  c."lineId",
  c."shiftDate",
  c."shiftId",
  c."pptSec",
  c."downSec",
  c."changeoverSec",
  c."runSec",
  c."totalCnt",
  c."goodCnt",
  c."ictSec",
  c.availability,
  c.performance,
  c.quality,
  (c.availability * c.performance * c.quality) AS oee,
  -- ENG-05: FLAG only, never clamp. NULL (no run time -> no verdict) when
  -- performance itself is NULL.
  (c.performance > 1.0) AS "ictMisconfigured",
  (c."pptSec" - c."runSec") AS "aLossSec",
  GREATEST(0::double precision, c."runSec" - c."ictSec") AS "pLossSec",
  (c."ictSec" * (1 - c.quality)) AS "qLossSec"
FROM calc c;

-- =========================================================================
-- v_line_shift_oee: line-level rollup. AGGREGATE-OF-SUMS, NOT AVERAGE OF
-- RATIOS — A = SUM(run)/SUM(ppt), P = SUM(ict)/SUM(run), Q =
-- SUM(good)/SUM(total). Averaging the per-machine ratios directly would
-- silently mis-weight a machine that ran (or existed in this shift) for a
-- different span of time than its line-mates — the same class of error as
-- the PPT-vs-calendar bug (PITFALLS.md), just at the aggregation layer
-- instead of the calendar layer. Summing seconds/counts first, THEN
-- dividing, is the only weighting that reconciles with the ledger
-- (loss_event) and with a machine-level a_loss+p_loss+q_loss identity
-- rolled up to the line.
-- =========================================================================
CREATE OR REPLACE VIEW v_line_shift_oee AS
SELECT
  m."lineId",
  m."shiftDate",
  m."shiftId",
  SUM(m."pptSec") AS "pptSec",
  SUM(m."downSec") AS "downSec",
  SUM(m."changeoverSec") AS "changeoverSec",
  SUM(m."runSec") AS "runSec",
  SUM(m."totalCnt") AS "totalCnt",
  SUM(m."goodCnt") AS "goodCnt",
  SUM(m."ictSec") AS "ictSec",
  (SUM(m."runSec") / NULLIF(SUM(m."pptSec"), 0)) AS availability,
  (SUM(m."ictSec") / NULLIF(SUM(m."runSec"), 0)) AS performance,
  (SUM(m."goodCnt") / NULLIF(SUM(m."totalCnt"), 0)) AS quality,
  (
    (SUM(m."runSec") / NULLIF(SUM(m."pptSec"), 0))
    * (SUM(m."ictSec") / NULLIF(SUM(m."runSec"), 0))
    * (SUM(m."goodCnt") / NULLIF(SUM(m."totalCnt"), 0))
  ) AS oee
FROM v_machine_shift_oee m
GROUP BY m."lineId", m."shiftDate", m."shiftId";

-- =========================================================================
-- v_loss_pareto: the Six Big Losses ledger rolled up per (line, shift,
-- category, reasonCode) — feeds Phase 4's Pareto/Top-Losses report
-- directly off loss_event, independent of the state_interval-based A/P/Q
-- computation above (both are derived from the same underlying facts but
-- computed via separate paths — see golden.test.ts's ledger-reconciliation
-- assertions for the identity that ties them together).
-- =========================================================================
CREATE OR REPLACE VIEW v_loss_pareto AS
SELECT
  le."lineId",
  le."shiftDate",
  le."shiftId",
  le.category,
  le."reasonCode",
  SUM(le."lostTimeSec") AS "lostTimeSec",
  SUM(le."lostUnits") AS "lostUnits"
FROM loss_event le
WHERE le."shiftDate" IS NOT NULL AND le."shiftId" IS NOT NULL
GROUP BY le."lineId", le."shiftDate", le."shiftId", le.category, le."reasonCode";

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
  -- ::int, not bigint (Postgres's default COUNT(*) type) -- node-pg/Prisma
  -- decode bigint as JS BigInt, which Response.json()/JSON.stringify()
  -- cannot serialize (found live, apps/web/src/app/api/orders/route.ts).
  -- Order counts are always small; ::int is safe.
  COUNT(*)::int AS "totalDue",
  (COUNT(*) FILTER (WHERE os.status = 'ON_TIME'))::int AS "onTimeCount",
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
  -- ::int, not bigint (Postgres's default COUNT(*) type) -- node-pg/Prisma
  -- decode bigint as JS BigInt, which Response.json()/JSON.stringify()
  -- cannot serialize (found live, apps/web/src/app/api/orders/route.ts).
  -- Order counts are always small; ::int is safe.
  COUNT(*)::int AS "totalDue",
  (COUNT(*) FILTER (WHERE os.status = 'ON_TIME'))::int AS "onTimeCount",
  (COUNT(*) FILTER (WHERE os.status = 'ON_TIME'))::double precision / NULLIF(COUNT(*), 0) AS "difotPct"
FROM v_order_status os
JOIN order_line ol ON ol."orderId" = os."orderId"
GROUP BY ol."lineId", os."dueDate"::date;
