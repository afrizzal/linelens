---
phase: 02-oee-engine
plan: 1
subsystem: database
tags: [prisma, postgres, mqtt, mosquitto, mqtt.js, testcontainers, vitest, docker]

# Dependency graph
requires:
  - phase: 01-foundation-living-plant (plan 2)
    provides: "@linelens/contracts — TelemetryEvent schema, topics, sim-clock math, PROFILES/resolveCalibration, plant.config.json"
  - phase: 01-foundation-living-plant (plan 3)
    provides: "Simulator publishing contract-valid telemetry over MQTT + HTTP /clock endpoint"
provides:
  - "packages/db: Prisma 7 schema (Line/Product/Machine/Shift/ReasonCode master data + append-only MachineEvent + singleton SimClock), driver-adapter client factory (createDb), initial migration with hand-written sim_now() SQL function"
  - "packages/db: idempotent runSeed()/seedIfEmpty() upserting master data from plant.config.json + contracts REASON_CODES"
  - "apps/worker: MQTT ingestion (createIngestion) — sole MQTT consumer, sole Postgres writer, idempotent on (machineId, seq)"
  - "apps/worker: main.ts boot sequence — migrate deploy, seed-if-empty, sim_clock poll-sync from simulator /clock, graceful shutdown"
affects: [02-02 (OEE derivation reads machine_event + sim_now()), 02-03, 03-* (dashboard reads Postgres populated by this worker)]

# Actuals (#2632)
actuals:
  tokens: 5100
  tasks: 3
  commits: 4

# Tech tracking
tech-stack:
  added: ["prisma@7.9.0", "@prisma/client@7.9.0", "@prisma/adapter-pg@7.9.0", "pg@8.22.0", "dotenv (packages/db CLI config loading)", "mqtt@5.15.2 (worker)", "pino@10.3.1 (worker)", "@testcontainers/postgresql@12.0.4 (worker devDependency)"]
  patterns:
    - "Prisma 7 driver-adapter architecture: prisma.config.ts holds datasource url (not schema.prisma), generator provider 'prisma-client' + moduleFormat esm, PrismaClient always constructed with @prisma/adapter-pg — never bare"
    - "Prisma client generation is an explicit Dockerfile step AFTER `COPY . .`, never a package postinstall hook — schema.prisma isn't present yet during the earlier package.json-only install layer, and .env is deliberately excluded from the build context"
    - "MachineEvent has no foreign keys to master data — raw ingestion must never fail or block on master-data completeness/ordering; it is the single lossless truth the rest of the system reconstructs from"
    - "Single calibration source: seed.ts resolves changeoverTargetMin/startupWindowMin via contracts resolveCalibration(), never re-derived, so the seeded DB and the simulator can never diverge on the OEE engine's overage-split target"
    - "Worker boot sequence: migrate deploy -> seedIfEmpty -> sim_clock poll-sync -> start MQTT ingestion, all before declaring 'worker started'"
    - "MQTT ingestion micro-batches (100ms/500-row flush) into machineEvent.createMany({skipDuplicates}), relying on the (machineId, seq) unique constraint for idempotent replay — never a manual dedupe check"

key-files:
  created:
    - packages/db/prisma/schema.prisma
    - packages/db/prisma.config.ts
    - packages/db/prisma/migrations/20260821144805_init/migration.sql
    - packages/db/src/client.ts
    - packages/db/src/seed.ts
    - packages/db/seed/seed.ts
    - apps/worker/src/ingest.ts
    - apps/worker/test/ingest.integration.test.ts
  modified:
    - packages/db/src/index.ts
    - packages/db/package.json
    - packages/db/tsconfig.json
    - apps/worker/src/main.ts
    - apps/worker/package.json
    - docker-compose.yml
    - docker/app.Dockerfile
    - docker/mosquitto/mosquitto.conf
    - package.json
    - .gitignore

key-decisions:
  - "sim_now() hand-written exactly per plan spec: epoch-millis BigInt math done directly, divided by 1000.0 only at the to_timestamp() boundary — verified with deterministic golden-value checks (running clock at speed 60, and a paused clock) against the real compose Postgres, not just eyeballed"
  - "Prisma table names snake_case via @@map; column names left at Prisma's default camelCase (quoted in SQL) rather than also @map-ing every field — matches the plan's literal sim_now() SQL body verbatim without a second naming translation layer"
  - "createIngestion()'s MQTT clientId is overridable (defaults to the production-fixed 'linelens-worker') solely so the Testcontainers integration test can run an isolated session against the same broker without evicting the real worker's persistent session"
  - "mosquitto.conf: max_queued_messages set to 0 (unlimited) — see deviation below"

patterns-established:
  - "Repo-root path resolution from a nested src file uses `new URL('../../..', import.meta.url)` counting directories, matching the simulator's existing plant.config.json pattern — apps/worker/src/main.ts, packages/db/src/seed.ts, and the integration test all follow this"
  - "docker compose run --rm --no-deps -v <win-path>:<container-path> worker sh -c '...' is the pattern for one-off Prisma CLI operations against the compose network's `db` hostname from the host, when the host's own Postgres port is unreachable (see Issues Encountered)"

requirements-completed: [ENG-01]

coverage:
  - id: D1
    description: "Prisma 7 schema + migrations + driver-adapter client factory, with sim_now() SQL function verified via golden-value checks"
    requirement: ENG-01
    verification:
      - kind: integration
        ref: "manual: DROP SCHEMA + `prisma migrate deploy` from scratch against compose postgres:18, then deterministic sim_now() checks (running + paused clock) via psql"
        status: pass
      - kind: unit
        ref: "pnpm --filter @linelens/db run typecheck"
        status: pass
    human_judgment: false
  - id: D2
    description: "Idempotent seed of master data (Products/Lines/Machines/Shifts/ReasonCodes) from plant.config.json, calibration resolved via contracts resolveCalibration()"
    requirement: ENG-01
    verification:
      - kind: integration
        ref: "manual: `pnpm db:seed` run twice against compose postgres — identical counts (4/3/8/2/13); machine changeoverTargetMin/startupWindowMin spot-checked against contracts PROFILES per profile"
        status: pass
    human_judgment: false
  - id: D3
    description: "Worker MQTT ingestion — sole consumer/writer, idempotent on (machineId, seq), lossless across a worker restart"
    requirement: ENG-01
    verification:
      - kind: integration
        ref: "apps/worker/test/ingest.integration.test.ts — 'persists 800 rows from 1000 publishes with 200 duplicated seqs'"
        status: pass
      - kind: integration
        ref: "apps/worker/test/ingest.integration.test.ts — 'survives a kill+restart mid-stream with no loss and no duplicates'"
        status: pass
      - kind: integration
        ref: "manual: `docker kill` the live compose worker mid-stream, restart — sessionPresent:true on reconnect, total rows == distinct (machineId,seq) keys, all 8 seeded machines represented"
        status: pass
    human_judgment: false

# Metrics
duration: 95min
completed: 2026-08-21
status: complete
---

# Phase 02 Plan 1: Database Layer + Worker Ingestion Summary

**Prisma 7 driver-adapter schema with a hand-verified sim_now() SQL function, idempotent plant.config.json seeding, and an MQTT worker that is the sole consumer/writer — proven lossless and idempotent against the real compose Mosquitto broker, including a bug found and fixed in Mosquitto's default queued-message cap.**

## Performance

- **Duration:** ~95 min
- **Started:** 2026-08-21T14:30:00Z (approx)
- **Completed:** 2026-08-21T15:27:00Z
- **Tasks:** 3/3
- **Files modified:** 20 (10 created, 10 modified, excluding pnpm-lock.yaml)

## Accomplishments
- Prisma 7 schema (Line/Product/Machine/Shift/ReasonCode + append-only MachineEvent + singleton SimClock) with `@prisma/adapter-pg`-based client factory; migration hand-verified with `sim_now()` golden-value checks (running and paused clock states) against the real compose Postgres, not just a syntax check
- Idempotent master-data seed from `plant.config.json`, calibration resolved through `@linelens/contracts` `resolveCalibration()` — verified identical row counts across two runs and correct `changeoverTargetMin`/`startupWindowMin` per profile
- Worker MQTT ingestion: sole consumer/sole writer, `clean:false`/QoS1/fixed clientId, micro-batched idempotent `createMany({skipDuplicates})` on `(machineId, seq)` — proven both by a live `docker kill`+restart against the running appliance and a Testcontainers + real-Mosquitto integration test
- `main.ts` boot sequence: `prisma migrate deploy` → `seedIfEmpty` → sim-clock poll-sync from the simulator's `/clock` → start ingestion → graceful SIGTERM/SIGINT shutdown
- Found and fixed a real "lossless" gap: Mosquitto's default `max_queued_messages` (1000) was silently dropping backlog past that cap for an offline persistent session — set to unlimited in `mosquitto.conf`

## Task Commits

1. **Task 1: Prisma 7 schema + migrations + client factory** - `1a8824d` (feat)
2. **Task 2: Seed from plant.config.json** - `2b60383` (feat)
3. **Task 3: Worker MQTT ingestion (idempotent raw persistence)** - `5df4368` (feat)

**Plan metadata:** (this commit, pending)

## Files Created/Modified
- `packages/db/prisma/schema.prisma` - Prisma 7 schema, snake_case tables via `@@map`, default camelCase columns
- `packages/db/prisma.config.ts` - datasource url + migrations path, dotenv-loaded from repo root, tolerant of a missing DATABASE_URL at `generate` time (Docker build)
- `packages/db/prisma/migrations/20260821144805_init/migration.sql` - initial migration + hand-written `sim_now()` function
- `packages/db/src/client.ts` - `createDb()` factory using `@prisma/adapter-pg`
- `packages/db/src/seed.ts` - `runSeed()`/`seedIfEmpty()`, advisory-lock-protected, idempotent upserts
- `packages/db/seed/seed.ts` - `pnpm db:seed` CLI wrapper
- `apps/worker/src/ingest.ts` - `createIngestion()`: mqtt@5 subscriber, batching, idempotent persistence
- `apps/worker/src/main.ts` - boot sequence (migrate/seed/clock-sync/ingest) + graceful shutdown
- `apps/worker/test/ingest.integration.test.ts` - Testcontainers Postgres + real compose Mosquitto integration test
- `docker/app.Dockerfile` - explicit `prisma generate` step after `COPY . .`; installs `openssl` for Prisma's schema-engine
- `docker/mosquitto/mosquitto.conf` - `max_queued_messages 0`
- `docker-compose.yml` - worker gets `SIMULATOR_URL` + `depends_on: simulator: service_healthy`
- `package.json` - `pnpm.onlyBuiltDependencies` for prisma/esbuild/sharp postinstall scripts

## Decisions Made
See `key-decisions` in frontmatter. Notably: `createIngestion()`'s clientId is overridable purely for test isolation (production stays fixed at `linelens-worker`), and Prisma columns are left at default camelCase (only table names are `@@map`-ed) so the migration's hand-written `sim_now()` SQL matches the plan's literal spec without an extra translation layer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stale Postgres role password on the pre-existing compose volume**
- **Found during:** Task 1 (running the first `prisma migrate dev` against the compose Postgres)
- **Issue:** The `postgres-data` volume predates the current `.env`'s `POSTGRES_PASSWORD`; Postgres only applies that env var on first `initdb`, so host-side TCP auth for `linelens`/`linelens-dev` failed even though `docker exec` (peer/socket auth) worked fine.
- **Fix:** `ALTER USER linelens WITH PASSWORD 'linelens-dev'` inside the running container to sync the role's password to match `.env`. No data existed yet (empty schema), so this was risk-free.
- **Files modified:** none (runtime DB state only)
- **Committed in:** n/a (not a file change)

**2. [Rule 3 - Blocking] Dockerfile's `postinstall` prisma generate ran before schema.prisma existed in the build context**
- **Found during:** Task 1 (first `docker compose build worker`)
- **Issue:** The Dockerfile's staged `COPY package.json... -> pnpm install -> COPY . .` layering (for cache-friendliness) meant a `packages/db` `postinstall: prisma generate` hook ran during the install layer, before `schema.prisma` was copied in — hard build failure.
- **Fix:** Removed the `postinstall` hook; added an explicit `RUN pnpm --filter @linelens/db run generate` step in the Dockerfile after `COPY . .`. Also made `prisma.config.ts`'s `datasource.url` tolerant of a missing `DATABASE_URL` (falls back to `''`) since `.env` is deliberately excluded from the build context and `prisma generate` doesn't need a live connection — only `migrate`/`db` commands do, and those fail with Prisma's own clear error if actually missing.
- **Files modified:** `docker/app.Dockerfile`, `packages/db/package.json`, `packages/db/prisma.config.ts`
- **Committed in:** `1a8824d` (Task 1 commit)

**3. [Rule 1 - Bug] Host port 5432 collides with a native Windows Postgres service**
- **Found during:** Task 1 (running `prisma migrate dev` from the host shell against `localhost:5432`)
- **Issue:** A pre-existing native `postgres.exe` Windows service is also bound to `0.0.0.0:5432`, alongside Docker Desktop's port-forward for the same published port — host connections intermittently/consistently hit the wrong Postgres, producing password-auth failures unrelated to credentials.
- **Fix:** Ran Prisma CLI operations (`migrate dev`/`migrate deploy`) inside a one-off container on the compose network (`docker compose run --rm --no-deps -v <prisma-dir> worker sh -c "... prisma migrate ..."`) targeting the `db` hostname instead of the host port — matches how the real worker resolves the database in production anyway.
- **Files modified:** none (workflow choice, not a code change)
- **Committed in:** n/a

**4. [Rule 1 - Bug] Mosquitto's default `max_queued_messages` (1000) silently drops backlog past that cap**
- **Found during:** Task 3 (the Testcontainers integration test's kill+restart case: publishing 1100 events to a disconnected persistent session only redelivered 1000 on reconnect, reproducibly)
- **Issue:** Mosquitto's built-in default caps how many QoS1/2 messages a `clean:false` session can queue while its client is offline; once hit, further publishes for that session are dropped, not queued — a direct violation of the plan's "raw machine_event rows are lossless" invariant on any worker outage long enough to accumulate >1000 events (a handful of real seconds at the demo's accelerated clock speeds across 8 machines).
- **Fix:** Set `max_queued_messages 0` (unlimited) in `docker/mosquitto/mosquitto.conf`. Acceptable at this appliance's scale per PITFALLS.md's "don't add retention/partitioning up front" discipline.
- **Files modified:** `docker/mosquitto/mosquitto.conf`
- **Verification:** Re-ran the same integration test after the config change — both the 800-row idempotency case and the 1100-row kill+restart case pass.
- **Committed in:** `5df4368` (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (2 Rule 3 blocking, 2 Rule 1 bug)
**Impact on plan:** All four were necessary for the plan's stated invariants (lossless, idempotent ingestion; a working `docker compose build`) or for running the plan's own verification steps at all. No scope creep — no new tables, endpoints, or features beyond what Task 1-3 specify.

## Issues Encountered

- **Integration test leaked ~1100-2200 transient `TEST-*` rows into the live compose demo database** on each run, because the test intentionally publishes to the real shared Mosquitto broker (mandated by the plan — an in-process fake broker can't honestly validate QoS1/`clean:false` session redelivery) and the real running worker (also subscribed to the wildcard topic) persists everything it sees. Cleaned up manually via `DELETE FROM machine_event WHERE "machineId" LIKE 'TEST-%'` after test runs; not a code defect, but worth knowing if this integration suite becomes part of a CI job that shares infrastructure with a running demo instance.
- Investigated an apparent "only one machine is ingesting" symptom at length before determining it was an artifact of checking mid-way through a large MQTT backlog drain (broker delivers per-topic in arbitrary order) combined with the plant currently being in its nightly no-shift Schedule Loss window — not a bug. All 8 seeded machines are correctly ingested once given time to fully process; documented here so a future investigator doesn't re-walk the same path.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `machine_event` is the lossless, idempotent, replayable raw fact stream the OEE engine (02-02) derives from; `sim_now()` is callable and hand-verified for open-interval "so far this shift" math.
- Master data (Line/Machine/Product/Shift/ReasonCode) is seeded and calibration-consistent with the simulator.
- The worker remains the sole Postgres writer — `apps/web` still has no write path, matching ARCHITECTURE.md's single-writer discipline.
- No blockers carried forward. One note for 02-02: the `mosquitto.conf` `max_queued_messages 0` change means a long worker outage during a fast-accelerated demo will queue unboundedly rather than drop — acceptable at this scale, but worth remembering if the demo run is ever left unattended for a very long time.

---
*Phase: 02-oee-engine*
*Completed: 2026-08-21*

## Self-Check: PASSED

All 11 key files verified present on disk; all 3 task commits (`1a8824d`, `2b60383`, `5df4368`) verified present in git log.
