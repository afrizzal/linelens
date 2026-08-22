---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 03
current_phase_name: live-dashboard
status: verifying
stopped_at: Completed 03-03-PLAN.md (production timeline + inject-breakdown + human-verified cascade) — Phase 3 execution complete, ready for verification
last_updated: "2026-08-22T13:42:02.241Z"
last_activity: 2026-08-22
last_activity_desc: "Completed quick task 260822-f2w: patched 03-01-PLAN.md with Phase-02 sim-time contract deltas"
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 14
  completed_plans: 9
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-25)

**Core value:** A 60-second demo makes "machine downtime = broken customer promises" viscerally clear — breakdown on Line 2 → 3 orders late this week — with industry-correct OEE mechanics.
**Current focus:** Phase 03 — live-dashboard

## Current Position

Phase: 03 (live-dashboard) — EXECUTING
Plan: 3 of 3
Status: Phase complete — ready for verification
Last activity: 2026-08-22 — Phase 03 execution started

Progress: [██████░░░░] 64% (3/14 plans)

## Performance Metrics

**Velocity:**

- Total plans completed: 3
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 02 | 3 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P1 | 55 | 2 tasks | 43 files |
| Phase 01-foundation-living-plant P2 | 42min | 4 tasks | 16 files |
| Phase 01-foundation-living-plant P3 | 75min | 4 tasks | 14 files |
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 02 P1 | 95min | 3 tasks | 20 files |
| Phase 02-oee-engine P2 | 70min | 4 tasks | 18 files |
| Phase 02 P3 | 165min | 3 tasks | 4 files |
| Phase 03 P1 | 73min | 3 tasks | 12 files |
| Phase 03 P2 | 90min | 3 tasks | 27 files |
| Phase 03 P3 | 25min | 3 tasks | 8 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: Foundation + Simulator folded into one phase (coarse granularity, 2–3 week sprint); contracts still built first within Phase 1.
- Roadmap: Six Big Losses Pareto (DASH-02) grouped with DIFOT + DDS in Phase 4 to keep Phase 3 a clean vertical slice.
- Roadmap: SIM-05 (inject-breakdown cascade) mapped to Phase 3, where the live cascade first becomes observable, not to the simulator phase that builds the control endpoint.
- All-phase upfront planning (2026-07-23): 14 detailed plans authored in one pass with formulas, schemas, and hand-computed golden values embedded; later-phase plans assume earlier-phase contracts — if execution deviates from a contract (schema/file/interface), UPDATE the downstream plans before executing them, do not improvise.
- SSE fan-out = Postgres LISTEN/NOTIFY (worker stays the sole MQTT consumer per ENG-01); STACK.md's direct-MQTT-subscribe suggestion is the rejected variant.
- Model profile switched to balanced (executor=Sonnet) at the user's request — plans carry the full logic so execution needs no re-derivation.
- [Phase 01]: Postgres 18 volume mounts at /var/lib/postgresql (not .../data) per docker-library/postgres#1259
- [Phase 01]: TypeScript pinned to 5.9.3 (TS 7 stable not yet published; only dev nightlies)
- [Phase 01]: Vitest 4 workspace uses test.projects in vitest.config.ts; vitest.workspace.ts kept as a pointer since the standalone workspace-file format is deprecated in v4
- [Phase 01-foundation-living-plant]: Contracts package (@linelens/contracts) locked: states/losses/reasons/events/topics/sim-clock/calendar/plant-config as the single source for simulator, worker, and web
- [Phase 01-foundation-living-plant]: Simulator: discrete-event scheduler (not fixed-tick) with execute-time-domain countdown budgets makes the plant provably speed-invariant
- [Phase ?]: Prisma table names snake_case via @@map; columns left at default camelCase (quoted) to match the plan's literal sim_now() SQL body verbatim
- [Phase ?]: Prisma client generation is an explicit Dockerfile step after COPY . . (never a postinstall hook) since schema.prisma isn't present during the earlier package.json-only install layer
- [Phase ?]: mosquitto.conf max_queued_messages set to 0 (unlimited) after a Testcontainers integration test proved the 1000 default silently drops backlog for an offline persistent session, violating the lossless-ingestion invariant
- [Phase ?]: 02-02: Convention for 02-03 — sim-time columns stay TIMESTAMP(3) WITHOUT TIME ZONE (matching machine_event.simTime); every 02-03 SQL comparison against sim_now() must use sim_now() AT TIME ZONE 'UTC', proven by a regression test under SET TimeZone='Asia/Jakarta'
- [Phase ?]: 02-02: raw pg.Client Date-parameter binding is LOCAL-OS-TZ-dependent for naive timestamp columns (unlike Prisma's UTC-safe serialization) — always bind ISO 'Z'-suffixed strings, never Date objects, through raw pg
- [Phase ?]: 02-03: OEE SQL views driven by master data + LATERAL correlated subqueries (not a DISTINCT scan over machine_event) — required to hit <50ms EXPLAIN budget at demo volume (was 2.29s)
- [Phase ?]: 02-03: loss_event.stateIntervalId left unpopulated (out of this plan's file scope) — Phase 4 DIFOT drill-down should know this traceability column is dead before planning around it
- [Phase ?]: 02-03: live OEE bands (pristine window >=2026-01-19) show L2/L3 'typical' profile averaging 1.2-1.6pp above the 50-65% target band — simulator calibration note, not an engine defect
- [Phase ?]: 03-01: Andon 'line state' = worst-open-state-wins across a line's machines (DOWN > CHANGEOVER > BREAK > EXECUTE) — each line has 2 machines producing in parallel per plant.config.json
- [Phase ?]: 03-01: web-consuming workspace TS packages (@linelens/db, @linelens/contracts) need next.config.ts transpilePackages + an export-subpath bypass around export * barrels for Turbopack's dev bundler — apps/worker/apps/simulator never hit this since they run via tsx
- [Phase ?]: 03-01 blocker RESOLVED in 40b1308 — Turbopack cannot resolve a `.js`-suffixed relative import to a sibling `.ts` file EXCEPT through a package.json `exports` subpath. Two fixes were both required: (a) src/client.ts reaches the generated client via a self-referencing `@linelens/db/generated-client` exports subpath, not a relative import; (b) `importFileExtension = ""` on the Prisma generator so the generated client's own internal relative imports are extensionless and hit Turbopack's extension-guessing. Generator output also moved to `../src/generated/prisma`. All four read-model routes now 200 with real data in docker.
- [Phase ?]: 03-02: stateColor()/stateLabel() (components/ui/state-color.ts) is the single source of truth for state colors — DOM via Tailwind --color-state-* tokens, ECharts canvas via matching hex constants; must stay in sync with globals.css manually
- [Phase ?]: 03-02: line-level A/P/Q waterfall loss buckets derived client-side (lib/oee-waterfall.ts) from v_line_shift_oee's aggregated sums using the same per-machine formula in views.sql, since the view has no aLossSec/pLossSec/qLossSec columns at line level — avoids a schema/migration change for a UI plan
- [Phase ?]: 03-02: @linelens/contracts internal modules now self-import via '@linelens/contracts/<name>' package specifiers (8 new exports subpaths) instead of relative './x.js' paths — Turbopack cannot resolve a relative .js->.ts hop between sibling files in a workspace TS-source package, same class of issue 03-01 hit in @linelens/db
- [Phase ?]: 03-03: ECharts custom-series renderItem Gantt pattern proven end-to-end (spike -> real component -> live human verification) — the plan's flagged front-loaded risk resolved; no future plan needs to re-derisk the charting library choice
- [Phase ?]: 03-03: GET /api/timeline widened to include shift-window/break-calendar metadata (Rule 2 deviation) so the Gantt's break shading and x-axis clamp both work
- [Phase ?]: 03-03: POST /api/control/inject established as the thin-proxy pattern for demo controls (web forwards to SIMULATOR_URL, browser never talks to the simulator container directly) — reusable for future demo controls

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- Phase 1 research gap: PackML minimal state subset must be verified against ISA-TR88.00.02-2015 (not the OPC community summary) before coding the simulator state machine.
- Phase 3 research gap: Next.js App Router SSE + Postgres LISTEN/NOTIFY mechanics were web-verified only (Context7 unreachable during research) — confirm via Context7 at Phase 3 start.
- Non-negotiable across all phases: no `Date.now()` in derivation code — event-time from the payload is the only "now" downstream (silent number-corruption class).
- ~~Full 5-service docker compose up (app image build) unverified~~ **RESOLVED 2026-07-25.** Automated as `pnpm smoke` (Playwright, `tests/smoke/compose-stack.spec.ts`) instead of deferring to a manual check — which is how two real defects were found: no `.dockerignore` (host `node_modules` clobbered the image's, crash-looping all three app services on `MODULE_NOT_FOUND`) and simulator port `expose`d but not published. Fixed in `f494f54`. The TLS-interception build failure was genuinely environmental and is now handled by an opt-in `docker/certs/` → `NODE_EXTRA_CA_CERTS` step that no-ops on a clean machine.
- Lesson for later phases: the unit suite stayed 56/56 green while the entire appliance was unbootable. Run `pnpm smoke` after any phase that touches compose, the Dockerfile, or a service entrypoint — and extend the suite as Phase 2/3 add the worker loop and dashboard.
- `worker` currently exits 0 on `docker compose up` (Phase 1 skeleton, no domain logic). Phase 2 must give it a real MQTT subscribe loop; add a `worker`-stays-up assertion to the smoke suite then.
- ~~03-01: Turbopack cannot resolve packages/db/generated/prisma/client.ts through @linelens/db inside apps/web's next dev (docker) — 4 read-model routes return 500 live~~ **RESOLVED 2026-08-22 (40b1308).** Verified live in docker: /api/andon and /api/sim-clock 200 with real data; /api/oee and /api/timeline 400 without required query params (expected) and 200 with valid lineId/shiftDate/shiftId; /api/stream not regressed; worker + simulator start clean; 90 tests pass.
- Toolchain gotcha (this machine, pre-existing): plain `pnpm` — even Volta-shimmed — spawns children under Node v20.20.2 rather than the pinned 24.10.0, which breaks jsdom/undici in apps/web/test. Use `volta run --node 24.10.0 -- pnpm test` for a clean run. Not fixed; unrelated to any phase-03 change.
- 03-03: OEE/timeline page defaults land on an empty shift during sim 23:00-07:00 (8/24 real min) — N/A render is correct per project rule but a demo-credibility risk (1-in-3 chance of blank screen). Deferred by explicit user decision at the 03-03 checkpoint; see deferred-items.md and WINDOWS.md ledger entry 3. Not blocking Phase 3.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260822-f2w | Patch 03-01-PLAN.md with the two Phase-02 sim-time contract deltas (`sim_now() AT TIME ZONE 'UTC'` cast + raw-pg ISO-'Z' binding) and bring `apps/web/package.json` into scope | 2026-08-22 | deff23a | [260822-f2w-patch-planning-phases-03-live-dashboard-](./quick/260822-f2w-patch-planning-phases-03-live-dashboard-/) |

## Session Continuity

Last session: 2026-08-22T13:42:02.205Z
Stopped at: Completed 03-03-PLAN.md (production timeline + inject-breakdown + human-verified cascade) — Phase 3 execution complete, ready for verification
Resume file: None
