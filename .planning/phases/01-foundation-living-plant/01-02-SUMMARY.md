---
phase: 01-foundation-living-plant
plan: 2
subsystem: contracts
tags: [zod, typescript, oee, mqtt, sparkplug-b, sim-clock, vitest]

# Dependency graph
requires:
  - phase: 01-foundation-living-plant (plan 1)
    provides: pnpm workspace monorepo with packages/contracts scaffold, tsconfig.base.json, root vitest.config.ts
provides:
  - "@linelens/contracts: machine states, Six Big Losses taxonomy + LOSS_FACTOR mapping, reason-code taxonomy"
  - "@linelens/contracts: zod TelemetryEvent schema (STATE_CHANGE/COUNTS/ALARM) + Sparkplug-B-style topic helpers"
  - "@linelens/contracts: pure sim-clock math (simNow/rebase/pause/resume)"
  - "@linelens/contracts: shift calendar (Planned Production Time over sim time) + plant config zod schema + CalibrationParams PROFILES"
  - "plant.config.json: default 4-line/8-machine plant (showcase/typical/typical/problem), 3 products, 2-shift calendar, seed 42, speed 60"
affects: [01-03 (simulator state machine imports states/losses/reasons/events/topics/sim-clock/plant-config), 02-01 (DB seed imports PROFILES/plant-config to stay in sync with the simulator), 02-02 (OEE engine imports LOSS_FACTOR/calendar for PPT), all later phases]

# Tech tracking
tech-stack:
  added: ["zod@4.4.3 (contracts package dependency)"]
  patterns:
    - "Contracts-first: all domain vocabulary (states, losses, reasons, events, topics, clock, calendar, calibration) lives in one pure TypeScript+zod package with zero I/O; every other package/app imports, never redefines"
    - "Single source of calibration truth: CalibrationParams/PROFILES/resolveCalibration exported from contracts so simulator and DB seed can never diverge on changeoverTargetMin/startupWindowMin"
    - "Standing rule enforced by design: sim-clock.ts is the only file permitted to combine Date.now()-style wall-clock input (nowRealMs) with derivation math; calendar.ts uses new Date(simMs) only to decode calendar structure from an explicit sim-ms value, never to read the actual current time"

key-files:
  created:
    - packages/contracts/src/states.ts
    - packages/contracts/src/losses.ts
    - packages/contracts/src/reasons.ts
    - packages/contracts/src/events.ts
    - packages/contracts/src/topics.ts
    - packages/contracts/src/sim-clock.ts
    - packages/contracts/src/calendar.ts
    - packages/contracts/src/plant-config.ts
    - packages/contracts/test/losses.test.ts
    - packages/contracts/test/events.test.ts
    - packages/contracts/test/sim-clock.test.ts
    - packages/contracts/test/calendar.test.ts
    - packages/contracts/test/plant-config.test.ts
    - plant.config.json
  modified:
    - packages/contracts/src/index.ts
    - packages/contracts/package.json

key-decisions:
  - "zod pinned to 4.4.3 (matches STACK.md exactly; verified available on npm, not a canary)"
  - "REASON_CODES modeled as an array of {code,label,category} plus a Map lookup (REASON_BY_CODE), rather than a bare Record, so the taxonomy stays ordered and easy to render as a Pareto legend later"
  - "calendar.ts derives sim-midnight/minute-of-day via new Date(simMs).toISOString() rather than date-fns, since only day-boundary + minute-of-day math was needed for this plan's PPT functions — date-fns stays reserved for DDS 'yesterday' windowing in a later phase per STACK.md"

patterns-established:
  - "Every zod-validated domain type also exports its z.infer<> TypeScript type under the same name as the schema constant (e.g. `export type StateChangeEvent = z.infer<typeof StateChangeEvent>`) for ergonomic downstream imports"
  - "Package tests live in test/*.test.ts, one file per source module, following the Task boundaries in the plan"

requirements-completed: [SIM-02, SIM-03, SIM-07]

# Metrics
duration: 42min
completed: 2026-07-25
---

# Phase 01 Plan 2: Contracts Package Summary

**@linelens/contracts now exports the full producer/consumer contract — zod telemetry schemas, Sparkplug-B-style topics, pure sim-clock math, a shift calendar with verified Planned Production Time semantics, and a single-source calibration/plant-config schema, all backed by 34 passing Vitest tests.**

## Performance

- **Duration:** 42 min
- **Started:** 2026-07-25T19:34:00Z (approx)
- **Completed:** 2026-07-25T20:16:00Z (approx)
- **Tasks:** 4/4
- **Files modified:** 16 (14 created, 2 modified)

## Accomplishments
- Locked the verified 2-2-2 Six Big Losses taxonomy with `LOSS_FACTOR` mapping and a guard test proving no duration-threshold constant exists anywhere in the package (refutes anti-pattern §8.2)
- Locked the PackTags-lite telemetry event contract (`StateChangeEvent`/`CountsEvent`/`AlarmEvent` as a zod discriminated union) plus Sparkplug-B-style topic helpers, with round-trip and rejection tests
- Implemented pure, dependency-free sim-clock math (`simNow`/`rebase`/`pause`/`resume`) proven continuous across rebases and speed changes, with the "no Date.now() in derivation code" standing rule documented in-file
- Implemented the shift calendar's Planned Production Time logic (breaks excluded, changeover time not excluded) and validated it against the plan's hand-computed 435-minute default-shift figure
- Authored the default `plant.config.json` (4 lines × 2 machines, 3 products, 2-shift calendar) validated against a new `PlantConfigSchema`, plus `PROFILES`/`resolveCalibration` as the single calibration source for the simulator and DB seed to share

## Task Commits

1. **Task 1: Machine states, Six Big Losses, reason codes** - `4f90b5a` (feat)
2. **Task 2: Telemetry event schema + topic layout** - `18cbb04` (feat)
3. **Task 3: Sim-clock module** - `e396987` (feat)
4. **Task 4: Shift calendar + plant config schema + default plant.config.json** - `376f2a4` (feat)

**Plan metadata:** (this commit, pending)

## Files Created/Modified
- `packages/contracts/src/states.ts` - MACHINE_STATES union (PackML-inspired, documented as non-compliant)
- `packages/contracts/src/losses.ts` - SIX_BIG_LOSSES + LOSS_FACTOR verified mapping
- `packages/contracts/src/reasons.ts` - REASON_CODES taxonomy + REASON_BY_CODE lookup
- `packages/contracts/src/events.ts` - zod TelemetryEvent discriminated union (STATE_CHANGE/COUNTS/ALARM)
- `packages/contracts/src/topics.ts` - topicFor/parseTopic/TELEMETRY_SUBSCRIPTION (spBv1.0/LineLens/DDATA namespace)
- `packages/contracts/src/sim-clock.ts` - simNow/rebase/pause/resume, SIM_SPEED=60 default
- `packages/contracts/src/calendar.ts` - shiftInstanceAt/breaksWithin/plannedProductionTimeMs
- `packages/contracts/src/plant-config.ts` - CalibrationParamsSchema/PROFILES/resolveCalibration/PlantConfigSchema
- `packages/contracts/src/index.ts` - now re-exports all 8 modules (was `export {}`)
- `packages/contracts/package.json` - added `zod@4.4.3` dependency
- `plant.config.json` - default plant definition at repo root
- `packages/contracts/test/*.test.ts` (5 new files) - 33 new test cases across all 4 tasks

## Decisions Made
See `key-decisions` in frontmatter — zod version pin, REASON_CODES data shape, and calendar.ts's use of `new Date(simMs)` (an explicit-input decode, not a wall-clock read) instead of pulling in date-fns early.

## Deviations from Plan

None - plan executed exactly as written. All schemas, function signatures, default values, and the plant.config.json shape match the plan's literal spec.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `packages/contracts` is feature-complete for this plan's scope: states, losses, reasons, events, topics, sim-clock, calendar, and plant-config all exported from one `index.ts` entrypoint, all pure TypeScript+zod with zero I/O.
- Ready for 01-03 (simulator state machine) to import `@linelens/contracts` directly — no domain vocabulary needs to be reinvented downstream.
- Ready for 02-01 (DB seed) and 02-02 (OEE engine) to import `PROFILES`/`resolveCalibration`/`LOSS_FACTOR`/calendar functions from the same single source.
- No blockers carried forward from this plan.

---
*Phase: 01-foundation-living-plant*
*Completed: 2026-07-25*

## Self-Check: PASSED

All 9 key source files verified present on disk; all 4 task commits (`4f90b5a`, `18cbb04`, `e396987`, `376f2a4`) verified present in git log.
