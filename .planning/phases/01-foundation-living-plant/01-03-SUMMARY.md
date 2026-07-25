---
phase: 01-foundation-living-plant
plan: 3
subsystem: simulator
tags: [state-machine, mqtt, mulberry32, discrete-event, oee-calibration, vitest]

# Dependency graph
requires:
  - phase: 01-foundation-living-plant (plan 2)
    provides: "@linelens/contracts (states/losses/reasons/events/topics/sim-clock/calendar/plant-config) — the single source the simulator imports, never redefines"
provides:
  - "apps/simulator: a full discrete-event factory simulator — per-machine EXECUTE/DOWN/CHANGEOVER/BREAK state machine driven entirely by execute-time-domain countdown budgets, seeded per-machine via mulberry32+FNV-1a"
  - "apps/simulator: mqtt@5 publisher (QoS1, clean:false, stable clientId) streaming contract-conformant STATE_CHANGE/COUNTS/ALARM telemetry on Sparkplug-B-style topics"
  - "apps/simulator: HTTP control server (:4000) — POST /control/inject-breakdown, POST /control/speed, GET /clock, GET /healthz"
  - "apps/simulator: main.ts warm-starts the plant through one full prior sim-day (SIM_START 2026-01-05T06:55 -> GO_LIVE 2026-01-06T06:55) then runs a 250ms real-time loop"
  - "Speed-invariance and calibration-band determinism proven by Vitest (19 tests)"
affects: [01-04 (if any), 02-01 (worker ingests this exact telemetry contract), 02-02 (OEE engine's real formulas replace this plan's simplified inline reference calc), 03-* (control endpoint is proxied by web), 04-01/04-03 (warm-start constants SIM_START/GO_LIVE are load-bearing for DDS "yesterday" backfill)]

# Tech tracking
tech-stack:
  added: ["mqtt@5.15.2 (simulator dependency)", "pino@10.3.1 (simulator dependency)", "zod@4.4.3 (simulator dependency, transitively needed for direct schema use)"]
  patterns:
    - "Discrete-event scheduler, not fixed-tick simulation: advance(rt, toSimMs) jumps directly to the next due internal event (calendar boundary / failure / changeover / micro-stop / cycle-complete / count-batch-flush, in that priority order) rather than stepping at a fixed dt — this is what makes the output byte-identical regardless of the real-time tick granularity feeding it"
    - "Execute-time-domain countdown budgets (remainingToFailureMs/remainingToChangeoverMs/remainingToMicrostopMs) that only decrement while state===EXECUTE, rather than absolute sim-ms thresholds — cleanly handles pausing during BREAK/DOWN without threshold-crossing edge cases"
    - "Clock-edge discipline: only main.ts (and control.ts via an injected `nowRealMs` dependency, not a direct call) touches Date.now(); every other simulator source file derives all timing from explicit sim-ms parameters"

key-files:
  created:
    - apps/simulator/src/rng.ts
    - apps/simulator/src/profiles.ts
    - apps/simulator/src/machine.ts
    - apps/simulator/src/plant.ts
    - apps/simulator/src/publisher.ts
    - apps/simulator/src/control.ts
    - apps/simulator/test/rng.test.ts
    - apps/simulator/test/machine.test.ts
    - apps/simulator/test/invariance.test.ts
    - apps/simulator/test/calibration.test.ts
  modified:
    - apps/simulator/src/main.ts
    - apps/simulator/package.json
    - docker-compose.yml
    - pnpm-lock.yaml

key-decisions:
  - "Product rotation on changeover cycles through the plant.config.json global `products` array (cyclic, index+1 mod length) rather than a per-machine rotation list, since MachineConfigSchema only carries a single productId — this satisfies the plan's 'rotate to next in config' instruction with the config shape as locked in 01-02."
  - "COUNTS batching keeps a single `rejectReason` per 5-sim-second batch (the schema locked in 01-02 has one nullable rejectReason field, not a per-unit breakdown) — when a batch window contains rejects of multiple reasons, the emitted event carries the LAST reject reason in that window. Documented here as an accepted simplification of the schema's fixed shape, not a schema violation."
  - "Micro-stops keep the machine's failure/changeover execute-time budgets ticking through the pause (state stays EXECUTE per the plan's explicit 'no state change' rule) but freeze cycle/count-batch progress during the pause — matches 'counting only EXECUTE time' literally while keeping production math exact."
  - "Repairs (DOWN->EXECUTE/BREAK) are computed on an absolute sim-ms timeline unaffected by calendar breaks (repairs continue through breaks, per the plan's explicit resolution of that ambiguity); BREAK state transitions are calendar-driven only while EXECUTE or already BREAK — never entered from DOWN."

patterns-established:
  - "MachineCtx bundles per-machine calibration/products/shifts/rng so advance() stays a pure function of (runtime, target sim-ms, ctx) with no hidden state or I/O."
  - "Every HTTP control-server test/verification was run live against a real docker-composed Mosquitto + tsx-run simulator, not mocked — mirrors 01-01's live-verification discipline."

requirements-completed: [SIM-01, SIM-04, SIM-06]

# Metrics
duration: ~75min
completed: 2026-07-25
---

# Phase 01 Plan 3: Factory Simulator Summary

**A discrete-event, seeded, calendar-aware factory simulator — 8 machines across 4 lines streaming contract-conformant STATE_CHANGE/COUNTS/ALARM telemetry over mqtt@5 QoS1, with an HTTP inject-breakdown control endpoint and calibration bands proven by a simplified reference OEE calculation.**

## Performance

- **Duration:** ~75 min
- **Started:** 2026-07-25T19:44:00Z (approx)
- **Completed:** 2026-07-25T21:00:00Z (approx)
- **Tasks:** 4/4
- **Files modified:** 14 (10 created, 4 modified)

## Accomplishments
- Seeded mulberry32 PRNG with per-machine streams derived via FNV-1a hash of `${seed}:${machineId}` — proven byte-identical for the same seed, independent across machines
- A hand-rolled discriminated-union state machine (no XState, per STACK.md) computing the entire machine life in sim-time: EXECUTE/DOWN/CHANGEOVER/BREAK driven by execute-time-domain countdown budgets for MTBF, changeover period, and micro-stops
- Calendar-correct BREAK handling (repairs continue through breaks; changeovers never cross a break boundary — deferred to the first EXECUTE after break, or truncated-as-complete if already in progress at the boundary) using contracts' verified `shiftInstanceAt`/`breaksWithin`
- Batched COUNTS every 5 sim-seconds, startup-window reject rate after repair/changeover, micro-stops surfacing as ALARM with zero state change (the verified small-stops-are-Performance semantics)
- mqtt@5 publisher (clean:false, stable clientId, QoS1, handlers-before-connect) + a tiny node:http control server (`/control/inject-breakdown`, `/control/speed`, `/clock`, `/healthz`)
- `main.ts` warm-starts the plant through one full prior sim-day (SIM_START 2026-01-05T06:55 -> GO_LIVE 2026-01-06T06:55) before entering the live 250ms loop — pinning the exact constants later DDS/order-backfill plans depend on
- Proven live: `docker compose up -d db mqtt` (both healthy) + a tsx-run simulator connected over MQTT, warm-started 61,888 events across 8 machines in ~1.2s wall-time, `/healthz`/`/clock` responded correctly, `inject-breakdown` produced a visible `STATE_CHANGE DOWN` with `meta.injected=true`, and `mosquitto_sub` captured 20 valid JSON events spanning multiple machines/lines
- Speed-invariance proven: identical byte-for-byte event lists whether fed in 15,000ms steps (speed-60-shaped ticks) or 150,000ms steps (speed-600-shaped ticks)
- Calibration bands proven on the first test run with no tuning needed: showcase 78-92%, typical 48-67%, problem 28-44% (hard-capped <45%), with per-shift OEE jitter stddev > 1.5 pts

## Task Commits

1. **Task 1: Seeded RNG + calibration profiles** - `01df2ec` (feat)
2. **Task 2: Machine state machine (sim-time domain) + plant assembler** - `b882795` (feat)
3. **Task 3: MQTT publisher + main loop + control endpoint** - `0f2f96b` (feat)
4. **Task 4: Speed-invariance + calibration acceptance tests** - `6537c68` (test)

**Plan metadata:** (this commit, pending)

## Files Created/Modified
- `apps/simulator/src/rng.ts` - mulberry32 PRNG, FNV-1a per-machine seeding, uniform/exponential/triangular draw helpers
- `apps/simulator/src/profiles.ts` - thin re-export of contracts `PROFILES`/`resolveCalibration` (single source of truth)
- `apps/simulator/src/machine.ts` - the core discrete-event state machine (`createMachineRuntime`/`advance`/`forceBreakdown`)
- `apps/simulator/src/plant.ts` - assembles all machines from `plant.config.json`, exposes `advanceAll`/`injectBreakdown`
- `apps/simulator/src/publisher.ts` - mqtt@5 QoS1 publisher
- `apps/simulator/src/control.ts` - node:http control server (inject-breakdown/speed/clock/healthz)
- `apps/simulator/src/main.ts` - config loader, warm-start, live loop, wiring (modified from skeleton)
- `apps/simulator/package.json` - added mqtt/pino/zod dependencies (modified)
- `docker-compose.yml` - simulator now exposes :4000 internally with a `/healthz` healthcheck (modified)
- `apps/simulator/test/rng.test.ts`, `machine.test.ts`, `invariance.test.ts`, `calibration.test.ts` - 19 new test cases

## Decisions Made
See `key-decisions` in frontmatter — product-rotation source, single-rejectReason-per-batch schema accommodation, micro-stop budget-ticking-through-pause semantics, and the DOWN-vs-BREAK calendar interaction rule.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] mqtt/pino/zod were never added as `@linelens/simulator` dependencies**
- **Found during:** Task 3, writing `publisher.ts`
- **Issue:** 01-01's skeleton `package.json` only listed `@linelens/contracts` as a dependency; `mqtt`/`pino` (required by this plan's own `<action>` text) and `zod` (needed for direct schema use) were missing, which would have blocked `tsc`/runtime entirely.
- **Fix:** Added `mqtt@5.15.2`, `pino@10.3.1`, `zod@4.4.3` to `apps/simulator/package.json` dependencies (STACK.md-pinned versions) and ran `pnpm install`.
- **Files modified:** `apps/simulator/package.json`, `pnpm-lock.yaml`
- **Verification:** `pnpm install` succeeded; `tsc --noEmit` clean; live `tsx src/main.ts` connected to MQTT successfully.
- **Committed in:** `0f2f96b` (Task 3 commit)

**2. [Rule 2 - Missing functionality] `docker-compose.yml`'s `simulator` service had no exposed port or healthcheck for the control server**
- **Found during:** Task 3, per the plan's own "Compose: expose 4000 internally... add simulator healthcheck hitting /healthz" instruction
- **Issue:** The compose file from 01-01 predated this plan's control endpoint; without `expose`/`healthcheck`, later phases (web's control proxy, Phase 3) would have nothing to depend on `service_healthy` for.
- **Fix:** Added `expose: ["4000"]`, `CONTROL_PORT` env var, and a `node -e fetch(...)`-based healthcheck to the `simulator` service.
- **Files modified:** `docker-compose.yml`
- **Verification:** `docker compose config` validates; the healthcheck command itself was exercised manually against the live tsx-run simulator (equivalent fetch call succeeded).
- **Committed in:** `0f2f96b` (Task 3 commit)

**3. [Rule 1 - Bug/convention] `control.ts`'s `/control/speed` handler initially called `Date.now()` directly, violating the plan's own grep-enforced convention ("no Date.now()/new Date() in apps/simulator/src except main.ts's clock-edge")**
- **Found during:** Task 4, running the plan's own verification grep before the final commit
- **Issue:** The speed-rebase handler legitimately needs wall-clock "now" to call `rebase()`, but calling `Date.now()` inside `control.ts` (not `main.ts`) technically violated the letter of the plan's convention, even though it's a genuine clock-edge use.
- **Fix:** Added an injected `nowRealMs: () => number` dependency to `ControlDeps`, supplied by `main.ts` as `() => Date.now()`; `control.ts` now calls `nowRealMs()` instead of `Date.now()` directly, keeping the wall-clock read owned by `main.ts`'s wiring.
- **Files modified:** `apps/simulator/src/control.ts`, `apps/simulator/src/main.ts`
- **Verification:** `grep -rn "Date.now()\|new Date(" apps/simulator/src` shows only `new Date(explicit-sim-ms)` decode calls plus `main.ts`'s two legitimate clock-edge reads.
- **Committed in:** `6537c68` (Task 4 commit)

---

**Total deviations:** 3 auto-fixed (1 blocking dependency gap, 1 missing-functionality compose wiring, 1 convention-tightening refactor). No architectural changes, no scope creep — all three were necessary to satisfy the plan's own verification criteria.

## Issues Encountered

- Full 5-service `docker compose up` (image build) remains unverified in this sandbox for the same TLS-interception reason documented in 01-01's SUMMARY — not re-tested here since it's an environment limitation, not a code defect. The simulator itself was verified live via `tsx src/main.ts` directly against the dockerized Postgres/Mosquitto pair, which exercises the exact same code path the container would run.
- The RTK token-proxy hook in this shell mangles some inline `node -e "..."` fetch commands and even created one stray zero-byte file from a mis-parsed argument during manual verification; worked around by writing small `.mjs` scripts to the scratchpad/package directory instead, and the stray file was found and removed before committing (confirmed via `git status --short`, not committed).

## User Setup Required

None - no external service configuration required beyond what 01-01 already documented (`.env` copy before `docker compose up`).

## Next Phase Readiness
- `apps/simulator` now fully satisfies Phase 1's "living plant" success criteria: `docker compose up` (once the sandbox's build-image limitation is resolved on a real dev machine) would stream believable, reason-coded, sim-time-stamped telemetry for 8 machines across 4 lines, with inject-breakdown and calibration bands proven by tests.
- 02-01 (DB seed / worker) can subscribe to `spBv1.0/LineLens/DDATA/+/+` and expect the exact contract shapes locked in 01-02, produced by this plan without any local redefinition.
- 02-02 (OEE engine) should replace this plan's `calibration.test.ts` inline reference OEE calc with the real formulas — the reference calc here was explicitly scoped as "acceptable" only for calibration verification, not as the production engine.
- **Blocker/follow-up carried forward from 01-01:** verify the full 5-service `docker compose up` (build step) on a machine without TLS-interception middleware before relying on it for the demo GIF.

---
*Phase: 01-foundation-living-plant*
*Completed: 2026-07-25*

## Self-Check: PASSED

All 10 key source/test files verified present on disk; all 4 task commits (`01df2ec`, `b882795`, `0f2f96b`, `6537c68`) verified present in git log.
