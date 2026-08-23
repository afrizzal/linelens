---
phase: quick-260823-o4c
plan: 01
subsystem: api
tags: [nextjs, date-validation, security, prisma]

requires:
  - phase: 04-difot-pareto-dds
    provides: /api/orders route + 04-SECURITY.md T-04 open finding
provides:
  - "parseDayParam() pure calendar-validity helper (apps/web/src/lib/day-param.ts)"
  - "/api/orders?day= now rejects calendar-invalid dates with 400 instead of 500"
affects: [phase-05-public-repo, api-losses, api-timeline, api-oee]

actuals:
  tokens: 2344
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "pure-core / component-shell split for validation logic (matches lib/order-headline.ts precedent) — DB-free module, relative-import tested"
    - "round-trip Date validation (parse -> re-serialize -> strict-equal) to catch JS Date's silent calendar rollover"

key-files:
  created:
    - apps/web/src/lib/day-param.ts
    - apps/web/test/day-param.test.ts
  modified:
    - apps/web/src/app/api/orders/route.ts
    - .planning/phases/04-difot-pareto-dds/04-SECURITY.md

key-decisions:
  - "Hand-rolled round-trip predicate instead of zod (D-01): zod isn't an apps/web dependency, CLAUDE.md scopes zod's mandate to MQTT/env boundaries not scalar query params, and adding it would invite scope creep into sibling routes"
  - "Tested only the pure predicate, not the route handler (D-02): apps/web has no vitest config of its own and no @/ alias resolution under Vitest — route-level behavior is covered by the live curl gate instead"
  - "400 body reuses the route's existing { error } shape (D-03) for one consistent error contract"

requirements-completed: [T-04]

coverage:
  - id: D1
    description: "GET /api/orders?day=2026-02-30 (rollover class) returns 400 { error } instead of 500"
    requirement: T-04
    verification:
      - kind: unit
        ref: "apps/web/test/day-param.test.ts#rejects a rollover date (2026-02-30 -- Feb has 28 days in 2026)"
        status: pass
      - kind: e2e
        ref: "curl http://localhost:3000/api/orders?day=2026-02-30 against rebuilt web container -> 400"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /api/orders?day=2026-99-99 (invalid-date class) returns 400 { error } instead of 500 -- the class a DB-only try/catch would have missed"
    requirement: T-04
    verification:
      - kind: unit
        ref: "apps/web/test/day-param.test.ts#rejects an invalid-date input (2026-99-99 -- the class that throws RangeError pre-fix)"
        status: pass
      - kind: e2e
        ref: "curl http://localhost:3000/api/orders?day=2026-99-99 against rebuilt web container -> 400"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/orders?day=2026-01-05 still returns 200 with unchanged response shape"
    verification:
      - kind: e2e
        ref: "curl http://localhost:3000/api/orders?day=2026-01-05 against rebuilt web container -> 200, body has day/difot/difotYesterday/byLine/orders keys"
        status: pass
    human_judgment: false

duration: 16min
completed: 2026-08-23
status: complete
---

# Quick Task 260823-o4c: Fix T-04 calendar validity check Summary

**Closed a route-level DoS finding (T-04) by adding a pure round-trip calendar-validity check to `/api/orders?day=`, fixing two distinct failure classes a DB-only try/catch would only have half-solved.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-08-23T10:35:00Z (approx)
- **Completed:** 2026-08-23T10:41:03Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `parseDayParam()` — a pure, DB-free helper in `apps/web/src/lib/day-param.ts` that closes both the ROLLOVER class (`2026-02-30` silently normalized to Mar 2 by `new Date()`) and the INVALID-DATE class (`2026-99-99` throwing `RangeError` on `.toISOString()`) via a strict order: shape regex → NaN guard (before any `toISOString()` call) → round-trip re-serialization equality check.
- Wired the helper into `GET /api/orders`, replacing the old regex-only guard and the second, independently-constructed `yesterday` Date — `day` and `yesterday` now derive from one validated instant and can no longer disagree.
- Added 15 regression test cases in `apps/web/test/day-param.test.ts`, confirmed RED (module didn't exist) before the implementation, GREEN after.
- Live-verified against the rebuilt `web` container: `2026-02-30`, `2026-99-99`, `2026-13-01`, `2026-01-32` all now return `400 { "error": "..." }`; `2026-01-05` still returns `200` with the unchanged response shape.
- Recorded an additive T-04 resolution note in `04-SECURITY.md` that also corrects the original finding's attribution — it credited only the Postgres `22008` cast error, but the `2026-99-99` class never reached SQL; it threw one line earlier at `route.ts:57`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pure parseDayParam() helper + regression test** - `73f8515` (test)
2. **Task 2: Wire parseDayParam into /api/orders and record the T-04 resolution** - `5bb7f12` (fix)

_Note: Task 1 followed the plan's tdd="true" flow — test file written and confirmed RED (module-not-found) before the implementation was written and confirmed GREEN, both landed in the single `test(...)` commit per the plan's `<output>` instructions._

## Files Created/Modified

- `apps/web/src/lib/day-param.ts` - Pure `parseDayParam(day: string | null)` calendar-validity helper; returns `{ day, yesterday } | null`
- `apps/web/test/day-param.test.ts` - 15 regression cases covering both failure classes, leap-year/year-boundary derivation, and shape rejections
- `apps/web/src/app/api/orders/route.ts` - Replaced the regex-only guard + second Date construction with a single `parseDayParam()` call; updated header docblock
- `.planning/phases/04-difot-pareto-dds/04-SECURITY.md` - Additive T-04 resolution note (audit history preserved, table row/log/sign-off untouched)

## Decisions Made

- **D-01 (from plan):** Hand-rolled round-trip predicate, not zod — zod is not a dependency of `apps/web`, CLAUDE.md scopes its mandate to MQTT payloads / env config (not scalar query params), and introducing it here would invite scope creep into `/api/losses`, `/api/timeline`, `/api/oee`.
- **D-02 (from plan):** No route-handler unit test attempted — `apps/web` has no Vitest config of its own and the `@/` alias only resolves under `tsc`/Next, not Vitest. Route-level behavior is proven by the live curl gate instead (all 5 statuses confirmed against the rebuilt container).
- **D-03 (from plan):** 400 body reuses the route's pre-existing `{ error: "..." }` shape rather than introducing a new error contract.

## Deviations from Plan

None - plan executed exactly as written. Both failure classes, the derivation-agreement fix, and the additive SECURITY.md note all match the plan's `<action>` blocks verbatim.

## Issues Encountered

None. The `docker compose up -d --build web` rebuild and live curl gate both worked on the first attempt.

## Honesty note on live verification

Per the plan's `<precondition>` and this task's constraints: the compose stack was already up and healthy at task start. Before asserting any live curl result, the `web` container was explicitly rebuilt (`docker compose up -d --build web`) so the running image reflected the source edit — the 400/400/400/400/200 sequence and response-body shapes reported above were observed live against that rebuilt container, not inferred from unit tests alone.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- T-04 closed; `04-SECURITY.md` Sign-Off section's "T-04 (medium) ... remain open" line is now stale prose sitting above an additive resolution note — left untouched per the plan's "additive only, do not rewrite" instruction, but a future phase-05 pre-ship pass may want to fold the resolution into the Sign-Off summary line itself.
- Per the plan's `<follow_up_notes>` (not tasks, recorded for a future decision): `/api/losses`, `/api/timeline`, and `/api/oee` share the same permissive `^\d{4}-\d{2}-\d{2}$` regex and don't currently crash only by luck (no `::date` cast, or no cast at all). `parseDayParam()` now exists in `src/lib/` ready to drop into any of them — a natural ~15-minute follow-up before the Phase-05 public repo cut, deliberately excluded here to keep this fix minimal and reviewable.

---
*Phase: quick-260823-o4c*
*Completed: 2026-08-23*

## Self-Check: PASSED

All created/modified files confirmed present on disk; both task commits (`73f8515`, `5bb7f12`) confirmed present in `git log`.
