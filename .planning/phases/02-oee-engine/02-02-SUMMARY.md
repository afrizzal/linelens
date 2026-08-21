---
phase: 02-oee-engine
plan: 2
subsystem: database
tags: [prisma, postgres, oee, six-big-losses, derivation, notify, pg, testcontainers, vitest]

# Dependency graph
requires:
  - phase: 02-oee-engine (plan 1)
    provides: "packages/db Prisma schema + sim_now(); apps/worker MQTT ingestion (createIngestion) — sole Postgres writer, idempotent on (machineId, seq)"
provides:
  - "packages/db: StateInterval/LossEvent/EngineConfig/MachineCursor schema + hand-reviewed migration"
  - "apps/worker/src/derive/*: close-on-next-event interval derivation + the Six Big Losses ledger emission rules (all 6 categories), replay-idempotent, event-time-only (no Date.now())"
  - "apps/worker/src/notify.ts: coalesced pg_notify('linelens', {kinds, lineIds}) via a dedicated raw pg connection"
  - "apps/worker/src/main.ts: worker boot sequence now runs the derivation loop + notifier (previously ingestion-only)"
  - "A DerivationStore abstraction (MemoryStore + PrismaStore) making the OEE engine's core logic unit-testable without Postgres"
affects: [02-03 (OEE SQL views read state_interval/loss_event; must use `sim_now() AT TIME ZONE 'UTC'` per the Convention for 02-03 below), 03-* (dashboard reads loss_event/state_interval), 04-* (DIFOT drill-down reads loss_event.injected/lostUnits)]

# Actuals (#2632)
actuals:
  tokens: 5235
  tasks: 4
  commits: 4

# Tech tracking
tech-stack:
  added: ["testcontainers@12.1.0 (worker devDependency, direct — GenericContainer for the isolated Mosquitto broker)", "pg@8.22.0 + @types/pg@8.20.0 (worker direct dependency — notify.ts's dedicated raw connection)"]
  patterns:
    - "DerivationStore interface (apps/worker/src/derive/store.ts) decouples derivation business logic from persistence: MemoryStore (pure JS, no I/O) for unit tests, PrismaStore (wraps Prisma.TransactionClient) for the real poll loop — the same intervals.ts/losses.ts code runs against both"
    - "loss_event upsert is keyed on (machineId, category, reasonCode, windowStart, sourceEventId) with sourceEventId=0n as an explicit sentinel for interval-derived rows (rules 1/2/4) — never NULL, since Postgres treats NULLs as distinct in unique indexes, which would silently break replay-idempotency"
    - "Rule 4 (residual slow cycles) is computed ENTIRELY from already-persisted rows (state_interval/machine_event/loss_event) at shift-transition detection time — never accumulated incrementally in worker memory, so it survives a worker restart and stays replay-idempotent"
    - "Shift-transition detection: shiftInstanceAt() is compared consecutively across an ordered event batch (plus the prior batch's last-processed simTime, read back from MachineCursor.lastEventId) to detect exactly when a shift instance has fully elapsed — no extra schema needed"
    - "Static no-Date.now()/bare-new-Date() check (test/no-date-now.test.ts) scans apps/worker/src/derive/**/*.ts with comments stripped, enforcing the event-simTime-only rule at test time, not just by convention"
    - "Raw pg.Client Date-parameter binding is LOCAL-OS-TZ-dependent for `timestamp without time zone` columns (a real footgun distinct from Prisma's own UTC-safe Date serialization) — always bind ISO 'Z'-suffixed STRINGS, never Date objects, through a raw pg connection"
    - "Testcontainers integration tests that need a real broker spin up their OWN eclipse-mosquitto:2.0.22 GenericContainer (reusing docker/mosquitto/mosquitto.conf) instead of the shared compose broker — zero risk of leaking test data into the live appliance, and no running compose stack required to run the suite"

key-files:
  created:
    - packages/db/prisma/migrations/20260821154415_derived_state_schema/migration.sql
    - apps/worker/src/derive/types.ts
    - apps/worker/src/derive/store.ts
    - apps/worker/src/derive/prisma-store.ts
    - apps/worker/src/derive/intervals.ts
    - apps/worker/src/derive/losses.ts
    - apps/worker/src/derive/runner.ts
    - apps/worker/src/notify.ts
    - apps/worker/test/intervals.test.ts
    - apps/worker/test/losses.test.ts
    - apps/worker/test/no-date-now.test.ts
    - apps/worker/test/sim-now-timezone.test.ts
    - apps/worker/test/notify.test.ts
  modified:
    - packages/db/prisma/schema.prisma
    - apps/worker/src/main.ts
    - apps/worker/test/ingest.integration.test.ts
    - apps/worker/package.json
    - pnpm-lock.yaml

key-decisions:
  - "Task 2 (intervals.ts) and Task 3 (losses.ts) were committed together — they are one inseparable 'single pass, single writer' scan (intervals.ts calls directly into losses.ts on every event) and neither compiles/functions without the other; splitting the commit would have left a broken intermediate state"
  - "Convention for 02-03 (Finding 3): state_interval.startTime/endTime and loss_event.windowStart/windowEnd stay TIMESTAMP(3) WITHOUT TIME ZONE — same Prisma-default mapping as machine_event.simTime, zero migration churn. Every 02-03 SQL view/query that clamps to sim_now() MUST compare via `sim_now() AT TIME ZONE 'UTC'`, never bare `sim_now()` — proven necessary and sufficient by apps/worker/test/sim-now-timezone.test.ts (bare comparison silently returns a DIFFERENT answer under a non-UTC session; the AT TIME ZONE 'UTC' form is session-TimeZone-independent, verified under SET TimeZone='Asia/Jakarta')"
  - "Rule 4's shift-transition detection reads the PRIOR batch's last-processed simTime by querying machine_event WHERE id = cursor.lastEventId (a cheap indexed lookup) rather than adding a new MachineCursor column — keeps Task 1's schema as specified"
  - "notify.ts uses a dedicated raw pg.Client per plan (never Prisma, never pooled) — mirrors the discipline Phase 3's LISTEN side will also need (PITFALLS.md: pgBouncer/transaction pooling silently drops LISTEN registrations)"

patterns-established:
  - "DerivationStore (business-logic-vs-persistence split) — future engine changes (e.g. a 02-03 correction) should extend the interface, not special-case Prisma calls inline in intervals.ts/losses.ts"
  - "Testcontainers-isolated broker pattern for any future MQTT-touching integration test — never point a test publisher at the shared compose Mosquitto"

requirements-completed: [ENG-02, ENG-04]

coverage:
  - id: D1
    description: "state_interval schema (close-on-next-event) + loss_event ledger schema (sourceEventId=0 sentinel, compound unique key) + engine_config + machine_cursor, migration hand-reviewed and verified to apply from scratch on a disposable postgres:18"
    requirement: ENG-02
    verification:
      - kind: integration
        ref: "manual: `prisma migrate deploy` against a fresh throwaway postgres:18 container (host port 55432) — both migrations apply cleanly; `\\dt` confirms all 4 new tables"
        status: pass
      - kind: unit
        ref: "pnpm --filter @linelens/db run typecheck"
        status: pass
    human_judgment: false
  - id: D2
    description: "Close-on-next-event interval derivation: EXECUTE->DOWN->EXECUTE->CHANGEOVER->EXECUTE yields exactly 5 intervals with correct start/end times, last one open; replaying only cursor-filtered events is a no-op"
    requirement: ENG-02
    verification:
      - kind: unit
        ref: "apps/worker/test/intervals.test.ts — 'EXECUTE->DOWN->EXECUTE->CHANGEOVER->EXECUTE yields 5 intervals, last open'"
        status: pass
      - kind: unit
        ref: "apps/worker/test/intervals.test.ts — 'replaying only cursor-filtered (already-processed) events is a no-op — rows unchanged'"
        status: pass
    human_judgment: false
  - id: D3
    description: "Finding 2 hardening: an event for a machine with no master-data row is skipped-and-logged (warn), never thrown, never invents a default changeoverTargetMin"
    verification:
      - kind: unit
        ref: "apps/worker/test/intervals.test.ts — 'Finding 2 hardening: an event for a machine with no master-data row is skipped-and-logged, not thrown'"
        status: pass
    human_judgment: false
  - id: D4
    description: "Loss ledger rules 1/2/3/3b/5 exactly as verified: DOWN close -> UNPLANNED_STOPS; CHANGEOVER 20min/15min-target policy=true -> exactly 2 rows (15min PLANNED_STOPS + 5min CO-OVERAGE UNPLANNED_STOPS); policy=false -> single 20min PLANNED_STOPS row; 45s ALARM -> 45s SMALL_STOPS with no interval change; product freshness updates Machine.currentProductId in-scan; rejects -> STARTUP_REJECTS/PRODUCTION_REJECTS keyed to source event, never accumulated"
    requirement: ENG-04
    verification:
      - kind: unit
        ref: "apps/worker/test/losses.test.ts (5 describe blocks covering rules 1, 2a/2b, 3, 3b, 5) — all assertions pass, incl. replay-idempotency per fixture"
        status: pass
    human_judgment: false
  - id: D5
    description: "Rule 4 residual slow-cycles: a hand-computed full-shift fixture (pLossTotal=20min, microstops=8min) upserts exactly one SLOW_CYCLES loss_event of 12min on shift-transition detection"
    requirement: ENG-04
    verification:
      - kind: unit
        ref: "apps/worker/test/losses.test.ts — 'full-shift fixture: pLossTotal=20min, microstops=8min -> SLOW_CYCLES 12min, upserted once on shift transition'"
        status: pass
    human_judgment: false
  - id: D6
    description: "Static enforcement: zero Date.now()/bare new Date() anywhere in apps/worker/src/derive/**"
    verification:
      - kind: unit
        ref: "apps/worker/test/no-date-now.test.ts — scans every derive/*.ts file with comments stripped"
        status: pass
    human_judgment: false
  - id: D7
    description: "Finding 1 fix: the MQTT ingestion integration test no longer leaks TEST-* rows into the live compose database — spins up its own disposable Mosquitto broker instead of the shared compose one"
    verification:
      - kind: integration
        ref: "manual: purged 1100 pre-existing leaked TEST-* rows (9->8 distinct machines confirmed); ran the unmodified (pre-fix) suite once to reproduce the leak (1100 rows reappeared, 9 machines); ran the FIXED suite + full `pnpm test` twice more — 0 TEST-* rows, 8 distinct machines each time"
        status: pass
    human_judgment: false
  - id: D8
    description: "Finding 3 regression test: bare `simTime = sim_now()` silently returns a different answer under a non-UTC Postgres session; `simTime = (sim_now() AT TIME ZONE 'UTC')` is session-TimeZone-independent — proven under SET TimeZone='Asia/Jakarta' vs 'Etc/UTC'"
    verification:
      - kind: integration
        ref: "apps/worker/test/sim-now-timezone.test.ts — both tests pass (the trap reproduces; the AT TIME ZONE 'UTC' convention is proven safe)"
        status: pass
    human_judgment: false
  - id: D9
    description: "Coalesced pg_notify: a 500-event burst drained over multiple poll-loop batches produces at most ~5 NOTIFYs (well under the plan's <=~8), each valid JSON; the 250ms coalescing timer itself collapses 50 rapid signals into exactly one NOTIFY"
    requirement: ENG-02
    verification:
      - kind: integration
        ref: "apps/worker/test/notify.test.ts — both tests pass"
        status: pass
    human_judgment: false
  - id: D10
    description: "Live compose verification (plan-level <verification>): after rebuilding + restarting the worker, state_interval timelines are gapless/non-overlapping across all 8 machines (0 violations, exactly one open interval per machine), loss_event populated in all 6/6 Six Big Losses categories, 0 worker errors over a multi-real-minute accelerated run"
    verification:
      - kind: manual_procedural
        ref: "manual: docker compose build+recreate worker, ~4+ real minutes live (speed 60), then SQL checks against the compose Postgres (see body below for exact counts and the gap/overlap query)"
        status: pass
    human_judgment: false

# Metrics
duration: 70min
completed: 2026-08-21
status: complete
---

# Phase 02 Plan 2: OEE Derivation Engine Summary

**Close-on-next-event interval derivation plus the full Six Big Losses attribution ledger (all 6 categories, replay-idempotent, event-time-only), coalesced pg_notify, and two orchestrator-flagged real defects fixed (a live-DB test-data leak, and a session-TimeZone comparison trap) — live-verified against the running appliance with zero interval gaps/overlaps across all 8 machines.**

## Performance

- **Duration:** ~70 min
- **Started:** 2026-08-21T15:35:00Z (approx)
- **Completed:** 2026-08-21T16:41:14Z
- **Tasks:** 4/4 (Task 2+3 committed together — see Decisions)
- **Files modified:** 18 (13 created, 5 modified)

## Accomplishments
- `StateInterval`/`LossEvent`/`EngineConfig`/`MachineCursor` schema + hand-reviewed migration, verified to apply from scratch on a disposable postgres:18
- Close-on-next-event interval derivation (`apps/worker/src/derive/intervals.ts`): exact-timestamp state timeline, idempotent-replay guard, bootstraps a machine's first interval correctly
- The full Six Big Losses ledger (`apps/worker/src/derive/losses.ts`): rules 1 (DOWN->UNPLANNED_STOPS), 2 (CHANGEOVER planned/overage split, configurable policy), 3 (ALARM microstop->SMALL_STOPS, Performance not Availability), 3b (product freshness), 4 (residual SLOW_CYCLES computed entirely from persisted rows), 5 (rejects->STARTUP_REJECTS/PRODUCTION_REJECTS) — every rule hand-verified against a computed fixture matching the plan's exact expected numbers
- A `DerivationStore` abstraction (`MemoryStore`/`PrismaStore`) making the whole engine unit-testable without Postgres, plus the real 200ms poll loop (`runner.ts`) that drives it against the live appliance
- Coalesced `pg_notify('linelens', ...)` via a dedicated raw `pg` connection (`notify.ts`), wired into `main.ts`'s boot sequence alongside the derivation loop
- Static enforcement that `apps/worker/src/derive/**` never reads the wall clock (`no-date-now.test.ts`)
- **Finding 1 fixed:** the MQTT ingestion integration test no longer leaks phantom `TEST-*` rows into the live compose database — it now spins up its own disposable Mosquitto broker
- **Finding 2 hardened:** derivation skips-and-logs events for machines with no master-data row instead of crashing
- **Finding 3 resolved and documented:** the `timestamp(3)`-vs-`timestamptz` convention for 02-03 is decided, proven with a regression test, and written down below
- **Live-verified** against the real running appliance after a rebuild: gapless/non-overlapping timelines on all 8 machines, all 6/6 loss categories populated, zero worker errors

## Convention for 02-03

**Decision:** `state_interval.startTime/endTime` and `loss_event.windowStart/windowEnd` stay `TIMESTAMP(3) WITHOUT TIME ZONE` — the same Prisma-default mapping `machine_event.simTime` already uses (zero migration churn, one consistent convention across every sim-time column in the schema).

**The rule 02-03 MUST follow:** every SQL view/query that clamps an open interval (or any window) to "now" must compare against **`sim_now() AT TIME ZONE 'UTC'`**, never bare `sim_now()`. Bare `sim_now()` (a `timestamptz`) compared to a naive `timestamp(3)` column makes Postgres implicitly reinterpret the naive value in the **session's** `TimeZone` setting before comparing — so the exact same query against the exact same data returns a **different answer** depending on the session's TimeZone. This is benign *today* only because both the compose Postgres session and the worker container's OS both happen to be `Etc/UTC` (independently verified: `SHOW TimeZone` on the compose `db` service, and `date`/`TZ` inside the `worker` container).

**Proof, not assertion** — `apps/worker/test/sim-now-timezone.test.ts`:
```sql
-- Under SET TimeZone = 'Etc/UTC':    count = 1  (matches)
-- Under SET TimeZone = 'Asia/Jakarta': count = 0  (SAME row, SAME data — silently stops matching)
SELECT count(*) FROM machine_event WHERE "simTime" = sim_now();

-- Under EITHER session TimeZone: count = 1, identically
SELECT count(*) FROM machine_event WHERE "simTime" = (sim_now() AT TIME ZONE 'UTC');
```

**A second, related footgun this test surfaced (worth 02-03 knowing):** binding a raw JS `Date` object as a query parameter through a **raw `pg.Client`** (not Prisma) into a naive `timestamp` column serializes using the **calling process's LOCAL OS timezone**, not UTC — e.g. on a UTC+7 development machine, `new Date('2026-01-06T07:00:00.000Z')` bound as `$1` gets written as `2026-01-06 14:00:00`, silently 7 hours wrong. This is specific to raw `pg` — **Prisma's own client does not have this bug** (verified separately: Prisma serializes `Date` -> naive column using UTC-consistent text, regardless of the local OS timezone). This only matters for hand-written raw-SQL code (like `notify.ts`, or test setup) — 02-03's SQL views themselves don't bind Date parameters, so this is a "know before you write a raw-pg fixture" note, not a views-authoring constraint. If 02-03 ever needs to bind a timestamp through raw `pg`, use an ISO `'...Z'` **string**, never a `Date` object.

## Task Commits

Each task was committed atomically, except Task 2+3 (see Decisions Made — they are one inseparable derivation pass and neither compiles without the other):

1. **Task 1: Derived-state schema** - `b9ef4ed` (feat)
2. **Task 2+3: Interval derivation + loss ledger emission** - `26cd815` (feat) — also includes the Finding 3 regression test and Finding 2 hardening
3. **Finding 1 fix: isolate the ingest integration test** - `f7eb707` (fix) — orthogonal defect fix, not a plan task
4. **Task 4: Coalesced NOTIFY + wire the derivation loop into main.ts** - `429a173` (feat)

**Plan metadata:** (this commit, pending)

## Files Created/Modified
- `packages/db/prisma/migrations/20260821154415_derived_state_schema/migration.sql` - hand-reviewed migration for the 4 new tables
- `apps/worker/src/derive/types.ts` - shared derivation types (DerivedEvent, MachineMaster, IntervalRow, LossEventInput, ...)
- `apps/worker/src/derive/store.ts` - `DerivationStore` interface + `MemoryStore` (in-memory fixture store for unit tests)
- `apps/worker/src/derive/prisma-store.ts` - `PrismaStore` — the real, transaction-backed implementation
- `apps/worker/src/derive/intervals.ts` - close-on-next-event interval derivation + event dispatch
- `apps/worker/src/derive/losses.ts` - the Six Big Losses ledger emission rules (1/2/3/3b/4/5)
- `apps/worker/src/derive/runner.ts` - the real 200ms poll loop (`startDerivationLoop`)
- `apps/worker/src/notify.ts` - coalesced `pg_notify` via a dedicated raw `pg` connection
- `apps/worker/src/main.ts` - now boots the derivation loop + notifier alongside ingestion
- `apps/worker/test/intervals.test.ts`, `losses.test.ts`, `no-date-now.test.ts`, `notify.test.ts`, `sim-now-timezone.test.ts` - new test suites
- `apps/worker/test/ingest.integration.test.ts` - Finding 1 fix: isolated Mosquitto broker via testcontainers
- `apps/worker/package.json`, `pnpm-lock.yaml` - added `testcontainers` (direct devDependency) and `pg`/`@types/pg` (direct dependencies)
- `packages/db/prisma/schema.prisma` - the 4 new models

## Decisions Made
See `key-decisions` in frontmatter. Notably: Task 2 and Task 3 are committed together (tightly coupled, inseparable single-pass derivation); the timestamp-vs-timestamptz convention for 02-03 is decided and proven (see "Convention for 02-03" above); rule 4's shift-transition detection avoids a schema change by reading the prior batch's last event back via `MachineCursor.lastEventId`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, orchestrator-flagged Finding 1] `ingest.integration.test.ts` leaked TEST-* rows into the live compose database**
- **Found during:** confirmed at plan start (orchestrator's mandatory finding) — verified live: 1100 leaked rows, 9 distinct machineIds instead of 8
- **Issue:** the suite published to the SHARED compose Mosquitto broker; the real production worker (also subscribed to the wildcard topic) ingested every test event
- **Fix:** spin up an isolated `eclipse-mosquitto:2.0.22` Testcontainers broker per run (reusing `docker/mosquitto/mosquitto.conf`), removing the dependency on the shared/live broker entirely
- **Files modified:** `apps/worker/test/ingest.integration.test.ts`, `apps/worker/package.json` (added `testcontainers` direct devDependency), `pnpm-lock.yaml`
- **Verification:** purged the 1100 pre-existing leaked rows; reproduced the leak once more by running the *unmodified* suite (confirmed 1100 rows / 9 machines reappeared); then ran the fixed suite + two full `pnpm test` passes — 0 leaked rows, 8 distinct machines, every time
- **Committed in:** `f7eb707`

**2. [Rule 2 - Missing critical functionality, orchestrator-flagged Finding 2] Unknown-machine hardening in derivation**
- **Found during:** designing Task 2 (interval derivation reads `machine.changeoverTargetMin`, which doesn't exist for an unseeded/leaked machineId — `machine_event` deliberately has no FK)
- **Issue:** without hardening, a leaked or unseeded machineId's events would crash the derivation loop or silently invent a default changeover target
- **Fix:** `processMachineBatch` looks up master data first; on a miss, it `logger.warn`s once (with machineId + event count), advances that machine's cursor past the skipped batch, and returns — no interval/loss rows are ever written for an unknown machine
- **Files modified:** `apps/worker/src/derive/intervals.ts`
- **Verification:** `apps/worker/test/intervals.test.ts` — explicit test asserting no throw, exactly one warn call, zero rows written
- **Committed in:** `26cd815`

**3. [Rule 2 - Missing critical functionality, orchestrator-flagged Finding 3] Timestamp convention decided, applied, and regression-tested**
- **Found during:** designing Task 1's schema (the mandatory finding required deciding this NOW, before 02-03 builds SQL views against these columns)
- **Issue:** `machine_event.simTime` is `timestamp(3)` (naive) but `sim_now()` returns `timestamptz` — comparing them without `AT TIME ZONE 'UTC'` silently reinterprets the naive value in the session's TimeZone
- **Fix:** kept the new columns naive (matching the existing convention, zero schema churn) and wrote a regression test proving `sim_now() AT TIME ZONE 'UTC'` is session-TimeZone-independent while bare `sim_now()` is not — documented as "Convention for 02-03" above, which 02-03's `views.sql` must follow
- **Files modified:** `apps/worker/test/sim-now-timezone.test.ts` (new)
- **Verification:** both assertions pass, proven under `SET TimeZone='Asia/Jakarta'` vs `'Etc/UTC'`
- **Committed in:** `26cd815`

**4. [Rule 2 - Missing critical functionality] Wired the derivation loop + notifier into `main.ts`'s boot sequence**
- **Found during:** Task 4 — the plan's own `<verification>` section requires a live check ("state_interval timeline... loss_event has rows in >=5 of 6 categories") that is unachievable unless the worker actually RUNS the derivation code built in Tasks 2/3 against the live appliance
- **Issue:** `main.ts` (from 02-01) only started MQTT ingestion; nothing consumed `machine_event` into `state_interval`/`loss_event` in production
- **Fix:** added `startDerivationLoop()` and `createNotifier()` calls to `main.ts`'s boot sequence and graceful-shutdown path
- **Files modified:** `apps/worker/src/main.ts`
- **Verification:** rebuilt + restarted the live worker container; see the "Live Verification" section below
- **Committed in:** `429a173`

---

**Total deviations:** 4 auto-fixed (1 Rule 1 bug, 3 Rule 2 missing-critical-functionality)
**Impact on plan:** All four were either explicitly mandated by the orchestrator's findings or necessary to make the plan's own stated verification achievable at all. No scope creep beyond the plan's stated tasks and the three named findings.

## Issues Encountered

- **`docker compose run` bind-mount + Git Bash path mangling:** generating the migration inside the worker container initially wrote files into the container's ephemeral filesystem (lost on `--rm`) because Git Bash's automatic POSIX-to-Windows path conversion mangled the `-v` argument. Fixed with `MSYS_NO_PATHCONV=1` prefixed on the `docker` invocation — same class of issue wave 1 hit with `docker compose run` for Prisma CLI operations, now documented here for the next executor.
- **`SET TimeZone = $1` cannot be parameterized** (Postgres's `SET` command doesn't accept bind parameters for its value) — the timezone regression test uses `SELECT set_config('TimeZone', $1, false)` instead, which is a normal parameterizable function call with identical effect.
- **The raw-pg Date-serialization footgun (see "Convention for 02-03" above)** was discovered mid-debugging of the timezone regression test itself — the test's OWN setup code was silently writing a 7-hour-wrong `simTime` on this UTC+7 development machine, because it bound a JS `Date` object through raw `pg` instead of an ISO string. Not a production bug (all production writes go through Prisma, which doesn't have this issue), but worth flagging loudly since it's exactly the kind of silent-corruption class this phase is guarding against, and it will bite anyone else who writes a raw-pg fixture on a non-UTC machine.

## User Setup Required

None - no external service configuration required.

## Live Verification (plan-level `<verification>`)

Rebuilt the worker image (`docker compose build worker`) and force-recreated the container to pick up all of this plan's code. After ~4+ real minutes running live (SIM_SPEED=60, so several sim-hours):

```sql
-- Interval gap/overlap check: ZERO rows returned (perfectly gapless, non-overlapping per machine)
SELECT s."machineId", count(*) FROM state_interval s
JOIN LATERAL (SELECT "endTime" AS prev_end FROM state_interval s2
  WHERE s2."machineId"=s."machineId" AND s2."startTime"<s."startTime"
  ORDER BY s2."startTime" DESC LIMIT 1) p ON true
WHERE p.prev_end IS NOT NULL AND s."startTime" <> p.prev_end
GROUP BY s."machineId";
-- (0 rows)

-- Exactly one open interval per machine, all 8 machines present
SELECT "machineId", count(*) FROM state_interval WHERE "endTime" IS NULL GROUP BY "machineId";
-- L1-M1:1  L1-M2:1  L2-M1:1  L2-M2:1  L3-M1:1  L3-M2:1  L4-M1:1  L4-M2:1

-- All 6 of 6 Six Big Losses categories populated (plan required >=5)
SELECT category, count(*) FROM loss_event GROUP BY category ORDER BY category;
-- PLANNED_STOPS:86  PRODUCTION_REJECTS:5207  SLOW_CYCLES:127  SMALL_STOPS:645  STARTUP_REJECTS:1349  UNPLANNED_STOPS:207
```

Worker logs over the entire run: zero `error`/`warn` entries. `machine_event` distinct machineId count stayed at 8 throughout (no TEST-* leak).

## Next Phase Readiness
- `state_interval` and `loss_event` are populated, replay-idempotent, and proven gapless/non-overlapping against live data — 02-03's SQL views have real data to build and test against immediately.
- **02-03 MUST read "Convention for 02-03" above before writing `views.sql`** — every `sim_now()` comparison against these columns needs `AT TIME ZONE 'UTC'`.
- `EngineConfig.changeoverAsPlanned` defaults to `true` (no row needs to exist yet — `getEngineConfig()` falls back to the schema default on a miss); 02-03/04 can add a UI toggle later without a migration.
- The DIFOT join keys (lineId, window, lostUnits) described in the plan's success criteria are in place on every `loss_event` row.
- No blockers carried forward.

---
*Phase: 02-oee-engine*
*Completed: 2026-08-21*
