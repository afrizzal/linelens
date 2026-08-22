---
phase: 03-live-dashboard
plan: 2
subsystem: web-ui
tags: [nextjs, tailwind-v4, echarts, react, andon, oee-waterfall, turbopack]

# Dependency graph
requires:
  - phase: 03-live-dashboard
    plan: 1
    provides: "GET /api/andon, /api/oee, /api/sim-clock read-model routes; useLive SSE hook; Prisma db singleton"
provides:
  - "(dashboard) route group shell: left nav + top bar (sim clock, connection dot), shared dark-first design tokens"
  - "components/ui/state-color.ts — single source of truth for state/loss colors, consumed by andon + waterfall (and 03-03's timeline)"
  - "/andon — live andon board (DASH-04)"
  - "/oee — OEE waterfall + KPI tiles + per-machine table (DASH-01)"
  - "components/ui/{card,badge,select,icons,nav,top-bar}.tsx — hand-rolled UI atoms, no component library"
  - "hooks/use-sim-clock.ts — polls + locally interpolates /api/sim-clock for a visibly ticking sim clock"
  - "lib/oee-waterfall.ts — pure A/P/Q loss-bucket derivation, unit-tested"
affects: [03-03-live-dashboard]

# Actuals (#2632)
actuals:
  tokens: 20634
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: ["echarts@6.1.0 (apps/web, tree-shaken echarts/core imports only — no echarts-for-react)"]
  patterns:
    - "stateColor()/stateLabel() (components/ui/state-color.ts) is the ONLY place MachineState colors are read from — DOM via Tailwind --color-state-* tokens, canvas (ECharts) via the matching hex constants. Both must stay in sync with globals.css's :root block (no build-time link)."
    - "Hand-rolled ECharts React wrapper (components/oee/waterfall.tsx): init once in a mount effect, setOption in a data-change effect, dispose on unmount, resize listener — reused as-is by 03-03/04-03, no echarts-for-react dependency."
    - "@linelens/contracts internal modules import each other via self-referencing '@linelens/contracts/<name>' package specifiers (package.json exports subpaths), never a relative './x.js' path — Turbopack cannot resolve a relative .js->.ts hop between sibling files in a workspace TS-source package, only exports-map subpaths (same class of issue 03-01 hit in @linelens/db)."
    - "useSimClock: poll /api/sim-clock every 5s, interpolate locally every 1s using the sim speed multiplier for a visibly ticking clock without hammering the API — Date.now() used only to measure elapsed REAL time for the interpolation, never as the displayed value."

key-files:
  created:
    - "apps/web/src/app/(dashboard)/layout.tsx"
    - "apps/web/src/app/(dashboard)/andon/page.tsx"
    - "apps/web/src/app/(dashboard)/oee/page.tsx"
    - apps/web/src/components/ui/state-color.ts
    - apps/web/src/components/ui/card.tsx
    - apps/web/src/components/ui/badge.tsx
    - apps/web/src/components/ui/select.tsx
    - apps/web/src/components/ui/icons.tsx
    - apps/web/src/components/ui/nav.tsx
    - apps/web/src/components/ui/top-bar.tsx
    - apps/web/src/components/andon/tile.tsx
    - apps/web/src/components/oee/kpi-tiles.tsx
    - apps/web/src/components/oee/waterfall.tsx
    - apps/web/src/lib/oee-waterfall.ts
    - apps/web/src/hooks/use-sim-clock.ts
    - apps/web/test/oee-waterfall.test.ts
    - .planning/phases/03-live-dashboard/deferred-items.md
  modified:
    - apps/web/src/app/globals.css
    - apps/web/src/app/layout.tsx
    - apps/web/src/app/page.tsx
    - apps/web/src/app/api/andon/route.ts
    - apps/web/package.json
    - packages/contracts/package.json
    - packages/contracts/src/index.ts
    - packages/contracts/src/events.ts
    - packages/contracts/src/plant-config.ts
    - packages/contracts/src/reasons.ts
    - pnpm-lock.yaml

key-decisions:
  - "Line picker + shift picker default from GET /api/andon's currently-active shift (shared across all lines, already resolved server-side); falls back to today's sim date + Shift 1 when between shifts, rather than adding a dedicated shift-metadata endpoint."
  - "Line-level A/P/Q waterfall loss buckets (aLossSec/pLossSec/qLossSec) are NOT columns on v_line_shift_oee (only v_machine_shift_oee has them) — derived client-side in lib/oee-waterfall.ts using the exact same three formulas views.sql uses per-machine, applied to the line's own aggregated sums. Verified live against docker data: line-level derived losses reconcile exactly with the sum of the two machines' losses (392.04/1221.9/72.0 vs summed 392.04/1221.9/72.0)."
  - "EXECUTE displays as 'RUNNING' in the UI (STATE_LABELS) — a display-only mapping; the underlying MachineState union value stays EXECUTE everywhere else, never renamed in derivation/comparison logic."

patterns-established:
  - "Any future client-side consumer of @linelens/contracts submodules must use the '@linelens/contracts/<name>' self-import specifiers (now all 8 submodules have exports subpaths) — 03-03's timeline is the next likely consumer (state/loss colors, reason labels) and will not hit the barrel-resolution wall this plan just fixed."

requirements-completed: [DASH-01, DASH-04]

coverage:
  - id: T1
    description: "Dashboard shell: left nav (Andon/OEE/Timeline + Phase-4-disabled items) + top bar (sim clock ticking ~1 sim-min/real-second at 60x, speed badge, live-connection dot); shared dark-first design tokens; state colors single-sourced via stateColor()"
    verification:
      - kind: manual_procedural
        ref: "docker compose up -d --wait; curl /andon and /oee both 200; web container logs show no compile/render errors for either route; GET /api/sim-clock polled and confirmed advancing (07:12:49 -> 08:03:06 across the verification session)"
        status: pass
      - kind: unit
        ref: "pnpm --filter @linelens/web run typecheck (clean); next build succeeds (Turbopack compiles both dashboard routes)"
        status: pass
    human_judgment: false
  - id: T2
    description: "Andon board (DASH-04): all 4 lines, one screen, live state+good+target, machines strip, full-screen toggle"
    verification:
      - kind: manual_procedural
        ref: "docker compose up -d --wait (fresh volumes); GET /api/andon returned live worst-state-wins per line (L1 DOWN/BRK-SENSOR, L2 EXECUTE, L3 DOWN/BRK-ELEC, L4 DOWN/BRK-SENSOR) with correct per-machine machines[] arrays and goodCount/targetCount climbing across repeated polls; between-shift response correctly nulls state/since/machines without a false 0"
        status: pass
      - kind: unit
        ref: "pnpm vitest run apps/web (use-live.test.ts, placeholder.test.ts) + full monorepo pnpm vitest run: 24 files / 93 tests pass"
        status: pass
    human_judgment: false
  - id: T3
    description: "OEE waterfall (DASH-01): KPI tiles (A/P/Q/OEE, N/A-safe), ict_misconfigured badge, waterfall chart, per-machine table; PPT - a - p - q = productive identity"
    verification:
      - kind: unit
        ref: "apps/web/test/oee-waterfall.test.ts — 3 cases: hand-computed golden fixture reconciles the identity to 6 decimal places, pptSec=0 yields all-null pct (never 0%), runSec<ictSec floors pLoss at 0 (ENG-05)"
        status: pass
      - kind: manual_procedural
        ref: "docker compose: GET /api/oee?lineId=L1&shiftDate=2026-01-06&shiftId=S1 returned live line+machine rows; derived line-level losses (392.04/1221.9/72.0 sec) matched the sum of the two machines' aLossSec/pLossSec/qLossSec exactly; a future shiftDate (2099-01-01) returned line:null, confirmed the page renders N/A tiles, never 0%"
        status: pass
    human_judgment: false

duration: 90min
completed: 2026-08-22
status: complete
---

# Phase 3 Plan 2: Andon Board + OEE Waterfall Summary

**The dashboard shell, live andon board, and OEE waterfall are built and verified live against a fresh `docker compose` stack — the "living plant" money view now shows real state transitions within seconds, and the A×P×Q waterfall reconciles exactly against the Phase-02 SQL views.**

## Performance

- **Duration:** ~90 min
- **Tasks:** 3 (all executed, no checkpoints — `autonomous: true`)
- **Files touched:** 27 (16 created, 11 modified)

## Accomplishments

- **Dashboard shell** (`(dashboard)/layout.tsx`): left nav with Andon/OEE/Timeline live links plus Phase-4-disabled Orders/Losses/DDS badges; top bar with a sim clock that visibly ticks (`useSimClock` polls every 5s and interpolates every 1s using the sim speed multiplier) and a live-connection dot wired to `useLive`.
- **Design tokens**: dark-first theme (`#0B0F14`/`#121821`/`#E6EDF3`) plus MachineState and A/P/Q loss colors registered as both CSS custom properties (Tailwind `--color-state-*`/`--color-loss-*` utilities) and matching TS hex constants (`components/ui/state-color.ts`) for ECharts canvas rendering — one `stateColor()`/`stateLabel()` helper every screen must use, so andon/waterfall/(03-03) timeline can never disagree on a color.
- **Andon board** (`/andon`, DASH-04): grid of line tiles, giant state word (pulsing when DOWN), reason + sim-time duration, good/target progress bar (N/A-safe), per-machine state-dot strip, full-screen toggle. Verified live against a **freshly reset** docker stack (`docker compose down -v` + `up -d --wait`): worst-state-wins reduction (DOWN > CHANGEOVER > BREAK > EXECUTE) confirmed correct across all 4 lines with real simulator data.
- **OEE waterfall** (`/oee`, DASH-01): line/shift picker, KPI tiles (N/A-safe, `ict_misconfigured` amber badge), hand-rolled ECharts waterfall (tree-shaken `echarts/core`, no `echarts-for-react`), per-machine mini-table. The PPT − Availability − Performance − Quality = Productive identity is both unit-tested (hand-computed golden fixture) and confirmed against live docker data (line-level derived losses matched the exact sum of the two machines' losses).
- Root `/` now redirects to `/andon` instead of showing the unmodified `create-next-app` placeholder (Rule 2).

## Task Commits

1. **Task 1: Shell + design tokens** — `4c9307c` (feat)
2. **Task 2: Andon board (DASH-04)** — `fcd30e1` (feat)
3. **Task 3: OEE waterfall (DASH-01)** — `d1ec0f4` (feat)

## Files Created/Modified

See `key-files` in frontmatter for the full list. Highlights beyond the plan's `files_modified`:
- `apps/web/src/hooks/use-sim-clock.ts` — shared sim-clock ticking hook (top bar + andon durations)
- `apps/web/src/lib/oee-waterfall.ts` + `apps/web/test/oee-waterfall.test.ts` — pure, tested loss-bucket derivation isolated from the chart component
- `apps/web/src/app/api/andon/route.ts` — extended with a `machines` field (deviation, see below)
- `packages/contracts/{package.json,src/index.ts,src/events.ts,src/plant-config.ts,src/reasons.ts}` — Turbopack fix (deviation, see below)

## Decisions Made

- Line/shift picker defaults sourced from `/api/andon`'s already-resolved current shift, with a same-day/Shift-1 fallback when between shifts — no new shift-metadata endpoint.
- Line-level waterfall loss buckets derived client-side from `v_line_shift_oee`'s own aggregated sums using the identical per-machine formula from `views.sql`, rather than adding new SQL view columns (would be a migration/schema change, out of a UI plan's scope).
- `EXECUTE` displays as "RUNNING" — a display-only label mapping; never changes the underlying `MachineState` value used in comparisons/priority ordering.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - missing critical functionality] `GET /api/andon` didn't expose per-machine states**
- **Found during:** Task 2, building the andon tile's "machines strip: small per-machine state dots" (an explicit `<action>` requirement).
- **Issue:** 03-01's route collapsed straight to the line's worst state via `SELECT DISTINCT ON (lineId)`, discarding every other machine's open interval.
- **Fix:** Removed the `DISTINCT ON` collapse; the query now returns every open interval (cheap — a handful of rows at demo scale), and the exact same worst-state priority/tie-break logic moved into JS, plus a new `machines: [{machineId, state}]` field per line.
- **Files modified:** `apps/web/src/app/api/andon/route.ts`
- **Verification:** Live against docker — worst-state-wins output unchanged (matches the pre-fix `DISTINCT ON` semantics exactly), `machines` array populated correctly per line.
- **Committed in:** `fcd30e1`

**2. [Rule 1 - bug/missing feature] Line-level A/P/Q loss buckets don't exist as SQL columns**
- **Found during:** Task 3, wiring the waterfall's required `a_loss`/`p_loss`/`q_loss` values.
- **Issue:** `v_line_shift_oee` (the line-level view) only has `pptSec`/`runSec`/`ictSec`/etc aggregates, not `aLossSec`/`pLossSec`/`qLossSec` — those columns only exist on `v_machine_shift_oee`.
- **Fix:** `lib/oee-waterfall.ts` applies the identical formula `views.sql` uses per-machine (`aLoss = ppt - run`, `pLoss = max(0, run - ict)`, `qLoss = ict * (1 - quality)`) to the line's own already-aggregated sums — no schema/migration change.
- **Files modified:** `apps/web/src/lib/oee-waterfall.ts` (new)
- **Verification:** Unit tests (hand-computed golden fixture) plus a live-docker check: derived line-level losses (392.04s / 1221.9s / 72.0s) matched the exact sum of both machines' `aLossSec`/`pLossSec`/`qLossSec` from a real `/api/oee` response.
- **Committed in:** `d1ec0f4`

**3. [Rule 2 - missing critical functionality] Root `/` still showed the `create-next-app` placeholder**
- **Found during:** Task 1, reviewing the objective ("the first visible screens").
- **Issue:** Neither the plan's `files_modified` nor the (dashboard) route group touches root `layout.tsx`/`page.tsx` — a viewer hitting `/` would see the unmodified Next.js starter template, not the dashboard.
- **Fix:** Updated root `layout.tsx` metadata (title "LineLens") and `page.tsx` to `redirect("/andon")`.
- **Files modified:** `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`
- **Committed in:** `4c9307c`

**4. [Rule 3 - blocking] `@linelens/contracts`'s own barrel hit the Turbopack relative-import wall on its first client-side use**
- **Found during:** Task 2's `next build` verification (andon tile importing `REASON_BY_CODE`).
- **Issue:** `next build` (and, separately, `next dev` would hit the same class of failure) failed with `Module not found: Can't resolve './states.js'` etc. — the exact Turbopack limitation 03-01-SUMMARY.md documents for `@linelens/db` ("cannot resolve a `.js`-suffixed relative import to a sibling `.ts` file except through a package.json `exports` subpath"), now hitting `@linelens/contracts`'s own internal barrel (`index.ts` and three submodules: `events.ts`, `plant-config.ts`, `reasons.ts`) since this is the package's first CLIENT-side (not just server/tsx-side) import.
- **Fix:** Applied the same proven pattern: every internal relative import replaced with a self-referencing `@linelens/contracts/<name>` package specifier, backed by 8 new `exports` subpaths in `packages/contracts/package.json` (one per submodule).
- **Files modified:** `packages/contracts/package.json`, `packages/contracts/src/{index,events,plant-config,reasons}.ts`
- **Verification:** `next build` succeeds; full monorepo `pnpm vitest run` (24 files/93 tests, including `apps/simulator` — another `tsx` consumer of `@linelens/contracts`) passes unchanged; `apps/simulator`/`packages/db`/`apps/web` typecheck clean.
- **Committed in:** `d1ec0f4`

---

**Total deviations:** 4 auto-fixed (1 blocking, 3 missing-functionality/bug). No architectural changes, no user decisions required.

## Out-of-Scope Discovery (logged, not fixed)

`apps/worker` has 15 pre-existing `tsc --noEmit` implicit-any errors (`prisma-store.ts`, `runner.ts`, `golden.test.ts`), confirmed via `git stash` to exist identically without any 03-02 change. Runtime/tests are unaffected (full suite 93/93 passing). Logged in `.planning/phases/03-live-dashboard/deferred-items.md` and the WINDOWS.md ledger (`lint-warning`, phase 03) rather than fixed, per the executor's scope boundary (only auto-fix issues directly caused by this plan's changes).

## Issues Encountered

None beyond the deviations above. The docker verification required a `docker compose down -v` + fresh `up -d --wait` cycle to get a clean read on andon "since" timestamps — the first attempt reused a stale `postgres-data` volume from an earlier manual session, whose leftover open `state_interval` rows had `since` timestamps ahead of the freshly-restarted sim clock's fixed epoch. This is an environment/volume artifact of ad-hoc prior manual testing, not a code defect.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The dashboard shell, `stateColor()`/`stateLabel()` single source of truth, and the hand-rolled ECharts wrapper pattern (`components/oee/waterfall.tsx`) are all reusable as-is by 03-03's timeline.
- `@linelens/contracts`'s exports-subpath fix (deviation 4) means 03-03 can safely import `MACHINE_STATES`/`REASON_BY_CODE`/etc from the barrel client-side without re-hitting the Turbopack wall this plan just resolved.
- Andon and OEE both verified live against a **freshly reset** docker stack — reminder for 03-03/later plans: reset volumes (`docker compose down -v`) before a from-scratch verification run if reusing an existing dev volume, since the sim clock resets to a fixed epoch on worker restart while `state_interval`/`machine_event` persist.

## Self-Check: PASSED

All 16 created files verified present on disk; all 3 task commits (`4c9307c`, `fcd30e1`, `d1ec0f4`) verified present in `git log`.

---
*Phase: 03-live-dashboard*
*Completed: 2026-08-22*
