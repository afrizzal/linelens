---
phase: 02-oee-engine
plan: 3
subsystem: database
tags: [postgres, sql-views, oee, six-big-losses, prisma, vitest, testcontainers]

# Dependency graph
requires:
  - phase: 02-oee-engine (plan 1)
    provides: "packages/db Prisma schema + sim_now(); apps/worker MQTT ingestion — sole Postgres writer"
  - phase: 02-oee-engine (plan 2)
    provides: "state_interval/loss_event derivation (close-on-next-event + Six Big Losses ledger), the 'Convention for 02-03' (sim_now() AT TIME ZONE 'UTC')"
provides:
  - "packages/db/src/views.sql: v_shift_windows, v_machine_shift_oee, v_line_shift_oee, v_loss_pareto — the single OEE computation authority, auditable SQL, live-verified at demo volume (<50ms per machine-shift query)"
  - "break_overlap_seconds() SQL function: shared PPT-vs-calendar double-subtraction guard, used both for PPT and for defensive DOWN/CHANGEOVER break exclusion"
  - "apps/worker/test/golden.test.ts: the credibility-gate proof — hand-computed golden scenario to 4 dp, 4 edge cases, ledger reconciliation, and the MANDATORY PPT single-truth cross-check (SQL vs TS agree to the second)"
  - "apps/worker/test/invariance.test.ts: ENG-06 end-to-end proof (real simulator + real derivation) that derived OEE is identical across clock accelerations"
affects: [03-* (dashboard reads these views directly — v_machine_shift_oee/v_line_shift_oee for the waterfall, v_loss_pareto for Top Losses), 04-* (DIFOT drill-down reads loss_event directly; note stateIntervalId is still NULL — see Deviations)]

# Actuals (#2632)
actuals:
  tokens: 16413
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "views.sql is the single hand-maintained SQL source; the migration folder holds a byte-identical copy applied via `prisma migrate deploy` (Prisma has no first-class view/function schema object here) — documented in views.sql's header so a future edit knows to create a NEW migration, never edit the applied one in place"
    - "machine_shifts (the row-presence CTE) is deliberately driven from the small `machine` MASTER-DATA table CROSS JOIN v_shift_windows, gated by an indexed EXISTS on machine_event — NOT `SELECT DISTINCT ... FROM machine_event`, which blew the <50ms EXPLAIN budget by 15-45x at demo volume (see Deviations)"
    - "interval_seconds/counts use CROSS JOIN LATERAL correlated subqueries (not plain multi-way JOINs) so the planner bakes concrete shift-window bounds into machine_event/state_interval Index Cond scans instead of a post-filtered Bitmap Heap Scan over a machine's entire history"
    - "a machine_event row for a machineId with no `machine` master-data row is, by design, absent from every OEE view — mirrors 02-02's own derivation hardening (Finding 2: unknown machines are skipped-and-logged, never derived)"

key-files:
  created:
    - packages/db/src/views.sql
    - packages/db/prisma/migrations/20260822010000_oee_views/migration.sql
    - apps/worker/test/golden.test.ts
    - apps/worker/test/invariance.test.ts
  modified: []

key-decisions:
  - "loss_event.stateIntervalId (nullable traceability column, currently NULL on all interval-derived rows) is left unpopulated — populating it would require touching apps/worker/src/derive/{intervals,losses,store,prisma-store,types}.ts, all outside this plan's declared files_modified (packages/db/prisma/migrations/*, packages/db/src/views.sql, apps/worker/test/golden.test.ts, apps/worker/test/invariance.test.ts). Documented here so Phase 4 planning knows the column is dead, not forgotten."
  - "Row-presence gate uses shiftEnd (not sim_now()-clamped effectiveEnd) as the eligibility test for whether a (machine,shift) pair appears at all — safe because no machine_event row can ever have a simTime in the future relative to sim_now() (derivation only ever persists real/past events), so the two conditions select an identical row set in practice; the actual numeric aggregation still clamps to effectiveEnd everywhere else."
  - "invariance.test.ts asserts per-machine (not flat cross-machine) event-array equality between the two step granularities — the flat merge order is an artifact of how many advanceAll() calls it took to reach the same sim-ms target, not a domain guarantee; per-machineId ordering is what machineId+seq-keyed persistence and derivation actually depend on."

patterns-established:
  - "PPT single-truth cross-check as a first-class mandatory test (not just a doc claim): SQL v_shift_windows.pptSec and TS contracts.plannedProductionTimeMs are asserted to agree to the second across a clamp-instant grid, in a Testcontainers integration test — any future SQL/TS drift on shift-window math fails CI, not just review."
  - "ANALYZE is not optional after bulk-loading a disposable Postgres in a perf-sensitive test/migration workflow — stale statistics (a freshly created 2-row `shift` table estimated at 610 rows) drove the planner into a disk-spilling plan that had nothing to do with the SQL's own structure."

requirements-completed: [ENG-03, ENG-05, ENG-06]

coverage:
  - id: D1
    description: "OEE SQL views (v_shift_windows, v_machine_shift_oee, v_line_shift_oee, v_loss_pareto) implement the preferred calculation A=Run/PPT, P=ICT*Total/Run, Q=Good/Total verbatim, with NULL propagation (never 0%/NaN%) on zero run time and row-absence=N/A on zero events"
    requirement: ENG-03
    verification:
      - kind: integration
        ref: "apps/worker/test/golden.test.ts — 'M-GOLD: matches the hand-computed golden numbers to 4 decimal places' + edge (a)/(b) tests"
        status: pass
      - kind: manual_procedural
        ref: "manual: live compose db, EXPLAIN ANALYZE on v_machine_shift_oee for one machine-shift — 17.5ms (budget <50ms) at ~443k machine_event rows"
        status: pass
    human_judgment: false
  - id: D2
    description: "ENG-05: Performance > 100% is FLAGGED (ictMisconfigured) and never clamped — a deliberately doubled-ICT fixture reads performance=2.0 exactly, not capped at 1.0"
    requirement: ENG-05
    verification:
      - kind: integration
        ref: "apps/worker/test/golden.test.ts — 'edge (c) + bonus (e): ... doubled-ICT COUNTS flips performance > 1.0 WITHOUT clamping'"
        status: pass
    human_judgment: false
  - id: D3
    description: "ENG-06: derived OEE (A/P/Q/OEE) is identical when the same seed runs at different clock accelerations, proven end-to-end through the REAL simulator plant and REAL derivation loop, not a re-implementation"
    requirement: ENG-06
    verification:
      - kind: integration
        ref: "apps/worker/test/invariance.test.ts — 6 sim-hours, speed-60-like vs speed-600-like step granularity, identical per-machine events and identical v_machine_shift_oee to 6 dp"
        status: pass
    human_judgment: false
  - id: D4
    description: "PPT-vs-calendar double-subtraction guard: break_overlap_seconds() applied both to PPT and defensively to DOWN/CHANGEOVER interval sums, proven via a DOWN interval deliberately spanning a break window (449 min counted, not 479 or 0)"
    verification:
      - kind: integration
        ref: "apps/worker/test/golden.test.ts — 'edge (c) + bonus (e)' downSec assertion"
        status: pass
    human_judgment: false
  - id: D5
    description: "MANDATORY PPT single-truth cross-check: SQL v_shift_windows.pptSec and TS contracts.plannedProductionTimeMs agree to the second across a 6-point clamp-instant grid (shift start, mid-shift, break start/mid/end edges, shift end)"
    verification:
      - kind: integration
        ref: "apps/worker/test/golden.test.ts — 'PPT single-truth cross-check (MANDATORY, Task 1 <verify>)'"
        status: pass
    human_judgment: false
  - id: D6
    description: "Live sanity: line OEE bands over the pristine data window (simTime >= 2026-01-19) match SIM-06 targets — showcase ~85%, typical 50-65%, problem <45% (see Live Verification below for exact numbers and honest deviation from the target band)"
    verification:
      - kind: manual_procedural
        ref: "manual: SQL aggregate query against v_line_shift_oee on the live compose db, scoped to shiftDate >= 2026-01-19"
        status: pass
    human_judgment: false

# Metrics
duration: 165min
completed: 2026-08-22
status: complete
---

# Phase 02 Plan 3: OEE SQL Views + Credibility Gate Summary

**Auditable SQL views (v_machine_shift_oee, v_line_shift_oee, v_loss_pareto) implementing the preferred A×P×Q calculation with NULL-never-0%, row-absence-as-N/A, and a never-clamped Performance>100% guard, proven against hand-computed goldens to 4 dp and against the real simulator+derivation pipeline across clock accelerations — plus a live-db performance fix that took EXPLAIN from 2.3s to 17.5ms.**

## Performance

- **Duration:** ~165 min
- **Started:** 2026-08-22T00:00:00Z (approx)
- **Completed:** 2026-08-22T01:20:00Z (approx)
- **Tasks:** 3/3
- **Files modified:** 4 (all created, 0 modified)

## Accomplishments
- `packages/db/src/views.sql`: `v_shift_windows` (PPT single-truth helper), `v_machine_shift_oee`, `v_line_shift_oee` (aggregate-of-sums, documented why), `v_loss_pareto`, and the shared `break_overlap_seconds()` guard — all formulas verbatim from `docs/00-domain-research.md` §2
- Hand-verified against the **live compose appliance** (not just the disposable test container): found and fixed a real performance defect (`SELECT DISTINCT` over ~420k `machine_event` rows, re-evaluated once per CTE reference, plus a stale-statistics planner misestimate) that took `EXPLAIN ANALYZE` from **2.29s down to 17.5ms** for a single machine-shift query — see Deviations
- `apps/worker/test/golden.test.ts`: the golden scenario (PPT=450min, Run=400min, A=0.888889, P=0.95, Q=0.95, OEE=0.802222) asserted to 4 dp, all 3 identities, 4 edge cases (all-DOWN, empty shift, ICT-misconfigured, Total=Good+Reject), ledger reconciliation, and the **mandatory PPT single-truth cross-check** between SQL and TS
- `apps/worker/test/invariance.test.ts`: the real simulator plant + real derivation loop, run at two step granularities mimicking speed 60 and 600, proving `v_machine_shift_oee` output is bit-for-bit stable (per-machine events identical, OEE identical to 6 dp) — found and fixed two test-harness bugs along the way (merge-order vs per-machine comparison; a Prisma transaction-timeout artifact from an oversized single-tick batch), documented in Deviations so they don't get mistaken for domain bugs by a future reader of the commit log
- Full repo suite: **22 files / 88 tests green** (baseline was 20/79 — the +2 files/+9 tests are exactly this plan's two new suites; zero regressions)

## The Golden Table (factory-person review artifact)

One machine, one 480-min shift with a single 30-min break (simplified test calendar — PPT = 450 min):

| Quantity | Value |
|---|---|
| PPT | 450 min |
| DOWN | 30 min (BRK-MECH) |
| CHANGEOVER | 20 min (target 15 → 15 planned + 5 CO-OVERAGE) |
| Run Time | 450 − 30 − 20 = **400 min** |
| Availability (A) | 400/450 = **0.888889** |
| Total count | 380 units (ICT = 60 s/unit → ict_time = 380 min) |
| Performance (P) | 380/400 = **0.950000** |
| Good count | 361 (19 reject: 12 RJ-DIM + 7 RJ-STARTUP) |
| Quality (Q) | 361/380 = **0.950000** |
| **OEE (A×P×Q)** | **0.802222 (80.22%)** |
| a_loss | 50 min (UNPLANNED_STOPS 35 + PLANNED_STOPS 15) |
| p_loss | 20 min (SMALL_STOPS 6 + SLOW_CYCLES 14) |
| q_loss | 19 min (STARTUP_REJECTS 7 + PRODUCTION_REJECTS 12) |
| Identity 1 | a_loss + p_loss + q_loss = 89 min; PPT − 89 = 361 min |
| Identity 2 | fully productive time = PPT × OEE = 450 × 0.802222 = 361 min = good_count × ICT = 361 × 1 |
| Identity 3 | ledger (loss_event, summed independently) reconciles exactly to the waterfall above |

All rows above are asserted programmatically in `apps/worker/test/golden.test.ts` (test: "M-GOLD: matches the hand-computed golden numbers to 4 decimal places" + "the loss ledger reconciles to the waterfall (Identity 3)") — this table is the test's expected values, not a separately-hand-typed claim.

## Live Verification (plan-level `<verification>`)

**Window measured:** `shiftDate >= '2026-01-19'` (the PRISTINE data window per the orchestrator's mandatory data scoping — `simTime < 2026-01-19` contains corrupted Wave-1 development artifacts and is excluded). 128 machine-shift rows, `shiftDate` range 2026-01-19 → 2026-01-26 at the time of measurement (the live worker keeps ingesting).

| Line | Profile | Shifts | Avg OEE | Min OEE | Max OEE | Target band |
|---|---|---|---|---|---|---|
| L1 | showcase | 16 | **86.51%** | 69.73% | 90.87% | ~85% |
| L2 | typical | 16 | **66.20%** | 59.15% | 72.63% | 50–65% |
| L3 | typical | 16 | **65.61%** | 56.14% | 82.85% | 50–65% |
| L4 | problem | 16 | **39.56%** | 23.97% | 49.04% | <45% |

**Honest read:** L1 and L4 land inside their target bands. L2 and L3 (both "typical" profile) average **1.2–1.6 points above** the 50–65% band's upper edge — close, but not strictly inside. This is a Phase-1 simulator calibration observation (the `typical` profile's MTBF/MTTR/microstop parameters in `packages/contracts/src/plant-config.ts` run slightly hot), not a Phase-2 engine defect — the engine is correctly reporting what the simulator produces, verified by the golden scenario matching hand-math to 4 dp. Flagging here for whoever next tunes calibration or reviews the "50–65%, ~85%, <45%" DoD language, rather than silently rounding it away.

**Performance (Task 1 `<verify>`):** `EXPLAIN ANALYZE` on `v_machine_shift_oee` for one machine-shift at ~443k `machine_event` rows: **17.5ms** (budget: <50ms). See Deviations for the fix that got here from an initial 2.29s.

## Task Commits

1. **Task 1: OEE SQL views** — `9ed9ac1` (feat)
2. **Task 2: Golden scenario test** — `48a2eff` (test)
3. **Task 3: Acceleration-invariance integration test** — `fd8850a` (test)

**Plan metadata:** (this commit, pending)

## Files Created/Modified
- `packages/db/src/views.sql` — the single hand-maintained SQL source: `break_overlap_seconds()`, `v_shift_windows`, `v_machine_shift_oee`, `v_line_shift_oee`, `v_loss_pareto`
- `packages/db/prisma/migrations/20260822010000_oee_views/migration.sql` — byte-identical copy of views.sql, applied via `prisma migrate deploy`
- `apps/worker/test/golden.test.ts` — the credibility-gate test suite
- `apps/worker/test/invariance.test.ts` — the ENG-06 end-to-end invariance test

## Decisions Made
See `key-decisions` in frontmatter. Notably: `loss_event.stateIntervalId` stays unpopulated (out of this plan's file scope — flagged for Phase 4 awareness, not silently left undiscovered); the row-presence gate uses `shiftEnd` rather than the `sim_now()`-clamped `effectiveEnd` (safe simplification, argued in the frontmatter); `invariance.test.ts` compares per-machine event streams, not the flat cross-machine merge order.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `v_machine_shift_oee` blew the <50ms EXPLAIN budget by up to 130x at live demo volume**
- **Found during:** Task 1's own `<verify>` clause, run against the live compose db (~420k `machine_event` rows) after applying the first working draft of the migration
- **Issue:** Three compounding problems, found via `EXPLAIN ANALYZE` iteration:
  1. `v_shift_windows`'s `days` CTE did `SELECT DISTINCT "simTime"::date FROM machine_event` — a full-table sort, re-evaluated on every one of `v_machine_shift_oee`'s several references to the view (776ms without JIT, 2.29s with JIT compilation overhead on top).
  2. The `machine_shifts` presence-gate CTE, when driven from `machine_event` directly, is referenced 3 times downstream; Postgres's default CTE-materialization-once-referenced-more-than-once behavior blocked pushing the outer query's `machineId`/`shiftDate` filter down into it, forcing either a full unfiltered scan (1.8s, disk-spilling sort) or, once forced to inline, a 3x-repeated per-reference-site recompute (~330ms).
  3. Freshly-loaded tables (`shift`, `machine`) had **stale/absent planner statistics** — Postgres estimated a 2-row `shift` table at 610 rows, which alone misdirected the planner into a Hash Join scanning the entire `machine_event` table instead of a cheap indexed lookup.
- **Fix:** (a) `v_shift_windows`'s day enumeration now bounds a `generate_series` by `MIN/MAX(simTime)` via a dedicated `machine_event_simTime_idx` index (index-scan-limit-1, not a full scan); (b) `machine_shifts` is now driven from the small `machine` MASTER-DATA table `CROSS JOIN v_shift_windows`, gated by an indexed `EXISTS` on `machine_event(machineId, simTime)` — a few hundred cheap candidate checks instead of a table-wide `DISTINCT`; (c) `interval_seconds`/`counts` use `CROSS JOIN LATERAL` correlated subqueries so the planner bakes concrete shift-window bounds into `Index Cond`s instead of a post-filtered `Bitmap Heap Scan` over a machine's entire history; (d) ran `ANALYZE` on the live db after the migration.
- **Files modified:** `packages/db/src/views.sql`, `packages/db/prisma/migrations/20260822010000_oee_views/migration.sql` (same content, kept in sync throughout — see key-decisions)
- **Verification:** `EXPLAIN ANALYZE` on the live compose db: 17.5ms (down from 2.29s), for both the originally-slow machine-shift and a second, different machine-shift; a full `SELECT count(*) FROM v_machine_shift_oee` (211 rows at the time) completes in 33ms.
- **Committed in:** `9ed9ac1` (Task 1 commit — the fix is embedded in the initial commit; iteration happened before committing, not as a follow-up patch)

**2. [Rule 1 - Bug, test-harness] `invariance.test.ts`'s first assertion compared the wrong notion of "identical events"**
- **Found during:** Task 3, first test run
- **Issue:** `expect(eventsSpeed600).toEqual(eventsSpeed60)` compared the flat, all-machines-interleaved event array directly. `plant.advanceAll()` iterates `machines[]` in a fixed order on every call; the number of calls needed to reach the same target sim-ms differs by 10x between the two step granularities (1800 vs 180), so the CROSS-MACHINE interleaving of the shared array differs even though each machine's own internal sequence is unaffected — a merge-order artifact of the test harness, not a violation of speed-invariance.
- **Fix:** Compare each machine's own `machineId`-filtered sub-sequence for equality instead of the flat array — this is also the semantically correct invariant, matching `MachineEvent`'s own `(machineId, seq)` idempotency key (schema.prisma) and how derivation actually consumes events (per-machine batches).
- **Files modified:** `apps/worker/test/invariance.test.ts`
- **Verification:** re-run passes; per-machine equality holds for all 8 machines across the 6-sim-hour window.
- **Committed in:** `fd8850a` (Task 3 commit)

**3. [Rule 1 - Bug, test-harness] A single oversized `tick()` exceeded Prisma's 5s interactive-transaction timeout, producing a spurious-looking OEE mismatch**
- **Found during:** Task 3, second test run (after fixing #2) — one machine's OEE diverged between the two databases in a way that looked like a real derivation bug (availability and performance individually different, but their product identical — an algebraic tell that `run_sec` had been "erased" from one side, since it cancels out of the A×P product)
- **Issue:** The test called `startDerivationLoop(...).tick()` exactly once per database with `batchSize: 1_000_000`, intending to drain a machine's entire ~3500-event 6-hour backlog through a single Prisma `$transaction`. That transaction exceeded Prisma's default 5000ms interactive-transaction timeout (`P2028`) for whichever database happened to be slower under the current machine load, silently rolling back that machine's whole batch (no `state_interval` rows persisted, while `machine_event`-derived quality was unaffected) — `runner.ts`'s own per-machine try/catch swallowed the error as "will retry next tick" exactly as designed for its real 200ms-cadence production loop, but the test's silent-level logger hid it and the test never actually retried.
- **Fix:** Drain via a loop of `tick()` calls at production's default `batchSize` (500) instead of one giant batch — this both avoids the timeout (500 events per transaction comfortably completes in well under 5s) and is a MORE faithful reproduction of how the real 200ms poll loop actually processes a backlog than trying to force 6 hours of work through one transaction. Logger level raised from `silent` to `error` so a future regression of this class surfaces instead of hiding.
- **Files modified:** `apps/worker/test/invariance.test.ts`
- **Verification:** re-run passes; `v_machine_shift_oee` identical to 6 dp across both databases for all 8 machines.
- **Committed in:** `fd8850a` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (2 test-harness bugs found and fixed during Task 3's own verification loop, 1 live-database performance defect found and fixed during Task 1's own `<verify>` clause)
**Impact on plan:** All three were necessary to make the plan's own stated verification (`<50ms EXPLAIN`, ENG-06 identical-OEE-across-speeds) actually true and actually provable, not scope creep. No new tables, endpoints, or features beyond Task 1-3's stated scope.

## Issues Encountered

- **Prisma migration checksum drift during SQL performance iteration:** applying `packages/db/prisma/migrations/20260822010000_oee_views/migration.sql` to the live compose db via `prisma migrate deploy`, then iterating on the SQL directly via `psql < views.sql` for a fast dev loop (5 iterations to fix the performance issue above), left `_prisma_migrations`'s recorded checksum stale relative to the final file content. Resolved by deleting that migration's tracking row and re-running `prisma migrate deploy` once the SQL was finalized — all statements are idempotent (`CREATE OR REPLACE`/`CREATE INDEX IF NOT EXISTS`), so this was risk-free. Worth knowing for the next executor who needs a fast SQL-view iteration loop against a live/shared Postgres.
- **Windows host port 5432 collision** (same class of issue as 02-01's finding): all `prisma migrate deploy` invocations against the live compose db used the `docker compose run --rm --no-deps -v <prisma-dir>:/app/packages/db/prisma worker sh -c "..."` pattern (bind-mounting only the `prisma/` subdirectory, not the whole repo, to avoid shadowing the image's `node_modules`) rather than a host-side Prisma CLI call.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `v_machine_shift_oee`, `v_line_shift_oee`, `v_loss_pareto` are the single OEE computation authority, live-verified at demo volume, and ready for Phase 3's dashboard to read directly (no additional aggregation layer needed).
- **Phase 4 planning note:** `loss_event.stateIntervalId` is NULL on all interval-derived rows (rules 1/2) — dead traceability column as of this plan. If the DIFOT drill-down wants a direct FK from a loss event back to its causing state interval, that requires touching `apps/worker/src/derive/{intervals,losses,store,prisma-store,types}.ts`, not just SQL.
- **Calibration note for whoever next touches the simulator or writes DoD-verification copy:** L2/L3 ("typical" profile) average 1.2–1.6 points above the documented 50–65% OEE band over the pristine live window (measured here, not asserted) — see "Live Verification" above.
- No blockers carried forward. Phase 2 gate passed: numbers may now reach a screen.

---
*Phase: 02-oee-engine*
*Completed: 2026-08-22*

## Self-Check: PASSED

All 4 key files verified present on disk; all 3 task commits (`9ed9ac1`, `48a2eff`, `fd8850a`) verified present in git log.
