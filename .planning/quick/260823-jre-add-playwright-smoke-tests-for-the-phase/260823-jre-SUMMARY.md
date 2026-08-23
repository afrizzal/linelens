---
phase: quick-260823-jre
plan: 1
subsystem: testing
tags: [playwright, e2e, smoke-test, next.js, echarts, accessibility]

requires:
  - phase: 04-difot-pareto-dds
    provides: "Orders/DIFOT, Order detail drill-down, Losses Pareto, and DDS board screens plus their backing /api/orders, /api/orders/{id}, /api/losses, /api/dds routes"
provides:
  - "tests/smoke/phase4-screens.spec.ts: 6 Playwright tests (2 orders-list, 1 drill-down, 1 money-shot, 1 pareto, 1 dds board) run against the live docker compose stack"
  - "Screen-reader-only Pareto data table (components/losses/pareto.tsx) fed by the same deriveParetoSeries buckets as the canvas chart"
  - "data-testid affordances on all four Phase-4 screens for future browser-level tests"
  - "Card component now accepts arbitrary HTML attributes (rest-spread), unblocking data-testid on any Card instance"
affects: [phase-05, future-phase4-regressions]

actuals:
  tokens: 5745
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Playwright browser-level cross-check: every UI assertion is fetched from the same REST endpoint in the same test run, never a hardcoded expected value"
    - "Honest-skip pattern: a test that cannot exercise its claim calls test.skip() with an explicit reason string rather than passing hollow"
    - "Branch-annotation pattern: testInfo.annotations.push() records which of two mutually-exclusive code paths a test actually exercised, making a green run auditable"

key-files:
  created:
    - tests/smoke/phase4-screens.spec.ts
  modified:
    - apps/web/src/app/(dashboard)/orders/page.tsx
    - apps/web/src/app/(dashboard)/orders/[id]/page.tsx
    - apps/web/src/app/(dashboard)/losses/page.tsx
    - apps/web/src/app/(dashboard)/dds/page.tsx
    - apps/web/src/components/losses/pareto.tsx
    - apps/web/src/components/ui/card.tsx
    - package.json
    - .planning/WINDOWS.md

key-decisions:
  - "Card component (components/ui/card.tsx) extended to spread rest HTML attributes so data-testid can be applied to any Card instance — a Rule 3 blocking fix, not scope creep, since two of the plan's own testid placements (order-headline, pareto-chart) sit on Card wrappers"
  - "WINDOWS entry 11 marked fixed: two independent live runs of the new DDS test both recorded the populated Delivery branch via a dds-delivery-branch Playwright annotation, cross-checked against /api/orders' independent read of the same underlying view"
  - "WINDOWS entries 8 and 9 left open per plan instruction (no new ledger rows for a narrowed, not closed, claim) — entry 9's rendering/deep-link half is now automated and was actually exercised live (a real LATE order existed at run time), but the causal inject-breakdown-to-LATE mechanism itself is not exercised by this spec"

requirements-completed: [QUICK]

coverage:
  - id: D1
    description: "Orders list screen (DIFOT tile, per-line grid, orders table) renders live /api/orders data with the null-vs-zero honesty rule enforced"
    verification:
      - kind: e2e
        ref: "tests/smoke/phase4-screens.spec.ts#orders list > real-data cross-check against /api/orders"
        status: pass
      - kind: e2e
        ref: "tests/smoke/phase4-screens.spec.ts#orders list > null-versus-zero honesty guard on a day with no orders due"
        status: pass
    human_judgment: false
  - id: D2
    description: "Order detail drill-down navigates from the orders table and cross-checks every field against /api/orders/{id}, including the ON_TIME headline/loss-list absence rule"
    verification:
      - kind: e2e
        ref: "tests/smoke/phase4-screens.spec.ts#order drill-down navigates and cross-checks against /api/orders/{id}"
        status: pass
    human_judgment: false
  - id: D3
    description: "Ranked loss list on a LATE/AT_RISK order deep-links to /timeline with lineId/highlightStart/highlightEnd — money-shot path (WINDOWS-9 rendering half)"
    verification:
      - kind: e2e
        ref: "tests/smoke/phase4-screens.spec.ts#drill-down money shot: ranked loss list, deep-link to timeline"
        status: pass
    human_judgment: false
  - id: D4
    description: "Losses Pareto chart renders API-matching buckets with a screen-reader-accessible data table, cumulative-% line, and a real (not cosmetic) by-category toggle"
    verification:
      - kind: e2e
        ref: "tests/smoke/phase4-screens.spec.ts#losses pareto renders API-matching buckets, cumulative line, and category toggle"
        status: pass
    human_judgment: false
  - id: D5
    description: "DDS board resolves yesterday correctly against an independent sim-clock read and cross-checks every tile, handling Delivery as an explicit annotated two-branch assertion (WINDOWS-11)"
    verification:
      - kind: e2e
        ref: "tests/smoke/phase4-screens.spec.ts#dds board resolves yesterday correctly and cross-checks every tile against /api/dds"
        status: pass
    human_judgment: false

duration: ~75min
completed: 2026-08-23
status: complete
---

# Quick Task 260823-jre: Playwright smoke tests for Phase 4 screens Summary

**Browser-level Playwright coverage for all four Phase-4 screens (Orders, Order detail, Losses Pareto, DDS board), cross-checked live against their own REST APIs in the same test run — closing WINDOWS entry 11 and live-exercising (though not fully closing) entry 9's ranked-loss/deep-link path.**

## Performance

- **Duration:** ~75 min (dominated by two `docker compose build web` cycles — the container runs a built image snapshot, not a host bind-mount, so testid changes require a rebuild before Playwright can see them)
- **Tasks:** 3
- **Commits:** 5 (3 feat, 1 docs for WINDOWS, plan metadata pending from orchestrator)
- **Files modified:** 8

## Accomplishments

- New `tests/smoke/phase4-screens.spec.ts` with 6 tests, all passing against the live compose stack, plus a warm-up readiness gate for cold-start `pnpm smoke` runs.
- `pnpm smoke` script fixed to bring up `worker` (previously missing — every Phase-4 screen was empty without it).
- Losses Pareto chart (`components/losses/pareto.tsx`) gained a screen-reader-only data table fed by the same `deriveParetoSeries` buckets as the canvas — closing a real accessibility gap, not just a test-hook.
- data-testid affordances added to all four Phase-4 screens (Orders, Order detail, Losses, DDS) for this and future browser-level tests.
- WINDOWS entry 11 (`/api/dds` populated-Delivery path) marked **fixed** — observed live twice, with a Playwright annotation recording which branch ran on each run.
- WINDOWS entry 9's rendering + deep-link half was **actually exercised live** (not skipped): the stack had a genuine LATE order at run time, and the "money shot" test walked the full ranked-loss-ordering → `/timeline` deep-link chain end to end.

## Task Commits

Each task was committed atomically:

1. **Task 1: Orders list end-to-end (tracer)** — `7e925a4` (feat)
2. **Task 2: Order drill-down navigation and the Losses Pareto** — `0622e86` (feat)
3. **Task 3: DDS board, full-suite run, and WINDOWS reconciliation** — `aab9c3d` (feat)

**WINDOWS ledger update:** `21b9caf` (docs — required by the plan's own `.planning/WINDOWS.md` file scope; not a SUMMARY/STATE/PLAN artifact excluded by the quick-task constraints)

**Plan metadata:** pending — orchestrator commits SUMMARY.md/STATE.md per the quick-task workflow contract.

## Files Created/Modified

- `tests/smoke/phase4-screens.spec.ts` — new spec: warm-up gate + 6 tests covering all four Phase-4 screens
- `apps/web/src/app/(dashboard)/orders/page.tsx` — testids for DIFOT tile, per-line grid, orders table, empty state
- `apps/web/src/app/(dashboard)/orders/[id]/page.tsx` — testids for order fields, status chip wrapper, headline card, ranked loss rows (with `data-est-units`), allocations table
- `apps/web/src/app/(dashboard)/losses/page.tsx` — testids on the chart card and empty state
- `apps/web/src/app/(dashboard)/dds/page.tsx` — testids on the day label, all four KPI tiles, top-loss card/empty state, actions list, escalations list/empty state
- `apps/web/src/components/losses/pareto.tsx` — `deriveParetoSeries` lifted to `useMemo`; new sr-only `<table>` beside the canvas chart, same source data
- `apps/web/src/components/ui/card.tsx` — rest-spreads HTML attributes so `data-testid` (and any other prop) can be applied to a `Card` instance
- `package.json` — `smoke` script now brings up `worker` alongside db/mqtt/simulator/web
- `.planning/WINDOWS.md` — entry 11 marked fixed

## Decisions Made

- **Card rest-spread (Rule 3 blocking fix):** the plan's own testid placements on `order-headline` and `pareto-chart` sit on `Card` wrappers; `Card`'s prop type didn't accept arbitrary attributes, so `data-testid` would have been silently dropped (and TypeScript would have rejected it). Extended `Card` to accept `React.HTMLAttributes<HTMLDivElement>` and spread `...rest` — a minimal, backward-compatible change with no visual effect on any existing `Card` usage.
- **Two docker rebuilds, not one:** the `web` service runs a container image snapshot (no host bind-mount for `apps/web/src`), so every testid edit is invisible to Playwright until `docker compose up -d --build web` runs. Task 1's tests initially failed against the stale image; rebuilt once after Task 1's edits, then again after Tasks 2+3's edits landed together. Both rebuilds targeted `web` only — db/mqtt/simulator/worker were never torn down, honoring the "stack must remain available" environment constraint.
- **Atomic-commit reconstruction:** all three tasks' spec-file content was authored in one continuous editing pass (to minimize docker rebuild cycles), then the file was deliberately split into three faithful historical snapshots — verified to pass standalone at each snapshot — before committing, so the git history matches the plan's task boundaries rather than landing as one large diff.
- **WINDOWS entry 9 narrowed, not closed:** per the plan's explicit instruction, no new ledger row was added for the narrowing. The live run this session actually found a LATE order and exercised the full ranked-loss/deep-link rendering path — a stronger result than the plan anticipated (it expected likely skip) — but the causal half (inject-breakdown → that specific order going LATE ~1 sim-day later) remains unautomated and is out of Playwright's 60s budget by construction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Card component didn't accept arbitrary HTML attributes**
- **Found during:** Task 2 (adding `data-testid` to the order-headline and pareto-chart Card instances)
- **Issue:** `Card`'s prop type only declared `children`, `className`, `style` — passing `data-testid` would fail TypeScript and silently not render in the DOM
- **Fix:** Extended the prop type with `React.HTMLAttributes<HTMLDivElement>` and spread `...rest` onto the wrapping `div`
- **Files modified:** `apps/web/src/components/ui/card.tsx`
- **Verification:** `pnpm typecheck` clean for apps/web; `pareto-chart` and `order-headline` testids resolve correctly in the live Playwright runs
- **Committed in:** `0622e86` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to implement the plan's own testid placement instructions as written; no scope creep beyond what Task 2 already specified.

## Issues Encountered

- **Docker image staleness (not a plan defect, an environment characteristic):** the `web` service has no host bind-mount, so `apps/web/src` edits are invisible until an explicit `docker compose up -d --build web`. This cost two ~2-minute rebuild cycles and caused Task 1's and Task 2's tests to fail on first attempt against the pre-edit image — not a code bug, confirmed by testid presence in the raw HTML before vs. after each rebuild.
- **`data-est-units` ordering assertion initially failed with a headline-text bug, not a data bug:** the money-shot test's first run asserted `order-headline` contained `top.lineId` (e.g. `"L4"`), but `composeLateHeadline` renders the human-readable `lineName` (`"Line 4"`). Fixed the test's expectation, not the component — the component was correct.
- **rtk (Rust Token Killer) shell hook intermittently swallowed Playwright's list-reporter output** (`[RTK:PASSTHROUGH] playwright parser: All parsing tiers failed`), making pass/fail counts hard to read from some invocations. Worked around with `rtk proxy <cmd>` (documented meta-command for raw passthrough) and `--reporter=json` piped to a file for the DDS delivery-branch annotation extraction. Not a project defect — a local dev-environment tool interaction.

## Test Results (live, this session)

**`pnpm test:smoke` — 11/11 passing**, including the pre-existing `tests/smoke/compose-stack.spec.ts` unchanged:

```
✓ compose stack smoke › simulator control endpoint reports a running plant
✓ compose stack smoke › sim clock advances faster than wall-clock
✓ compose stack smoke › broker streams contract-valid telemetry
✓ compose stack smoke › inject-breakdown is accepted and takes a real machine down
✓ compose stack smoke › web service renders without client-side errors
✓ phase4 screens › orders list › real-data cross-check against /api/orders
✓ phase4 screens › orders list › null-versus-zero honesty guard on a day with no orders due
✓ phase4 screens › order drill-down navigates and cross-checks against /api/orders/{id}
✓ phase4 screens › drill-down money shot: ranked loss list, deep-link to timeline (EXERCISED, not skipped — a live LATE order existed)
✓ phase4 screens › losses pareto renders API-matching buckets, cumulative line, and category toggle
✓ phase4 screens › dds board resolves yesterday correctly and cross-checks every tile against /api/dds (annotation: dds-delivery-branch = "populated (difotPct non-null)")
```

**DDS Delivery-branch annotation (recorded twice, independently):** `populated (difotPct non-null)` — WINDOWS entry 11 closed on this evidence.

**`pnpm typecheck`:** apps/web clean. `apps/worker` fails with pre-existing implicit-any errors (WINDOWS entry 2, phase 03, unrelated to this task's files — confirmed by file list: `apps/worker/src/derive/prisma-store.ts`, `runner.ts`, `test/golden.test.ts`, none touched this session).

**`volta run --node 24.10.0 -- pnpm run test`:** 31 files / 136 tests passing, run after all `apps/web` source edits for this task were in place (confirmed no `apps/web/src` file was touched after this run started). No collection from `tests/smoke/` (excluded by `vitest.config.ts`'s `projects: ["packages/*", "apps/*"]`, as expected).

## WINDOWS Ledger Reconciliation

| Entry | Before | After | Basis |
|---|---|---|---|
| 8 | open | **open** (unchanged) | No honest way to assert a 24-real-minute causal claim inside a 60s Playwright test. The per-line DIFOT contribution grid (the surface the eventual cascade would render on) is now regression-guarded by the "real-data cross-check" test, so a future silent rendering break would be caught even though the causal claim itself stays unautomated. |
| 9 | open | **open, narrowed** | The rendering + deep-link half is now automated in `phase4-screens.spec.ts`'s "drill-down money shot" test. This session's live run actually found a genuine LATE order and walked the full ranked-loss-ordering → `/timeline?lineId=&highlightStart=&highlightEnd=` chain end to end (not a skip). The causal half — inject-breakdown on L2 → an L2-product order specifically going LATE ~1 sim-day later with that injected breakdown top-ranked — remains a live observation only Task 04-02's `causality.test.ts` (proven against the real pipeline, 4/4 tests) has exercised so far. Forbidden techniques (`/control/speed` fast-forward, breakdown-injection-to-manufacture-AT_RISK) were correctly NOT used to force this closed. |
| 11 | open | **fixed** | Two independent live DDS-board test runs both pushed a `dds-delivery-branch` annotation of `"populated (difotPct non-null)"`, cross-checked against `/api/orders`' independent read of the same `v_difot`-backed view. Closure procedure (had it come back empty): leave the stack up until sim time passes 2026-01-08T00:00 (~24 real min at 60x), re-run the DDS test, check the annotation. |

## Next Phase Readiness

- Phase 4's four screens now have durable browser-level regression coverage; a future change that silently breaks live data rendering on any of the four screens will fail `pnpm test:smoke`, not just unit tests.
- The `data-testid` convention established here (screen-scoped, kebab-case, carrying raw data attributes like `data-est-units`/`data-line-id` for numeric assertions) is reusable for the next screen that needs browser-level coverage.
- WINDOWS entries 8 and 9's causal halves remain the only outstanding Phase-4 live-verification gaps; both require either a long-running sim-day wait or accepting `causality.test.ts`'s pipeline-level proof as sufficient — a call for a future planning session, not this task.

---
*Quick task: 260823-jre-add-playwright-smoke-tests-for-the-phase*
*Completed: 2026-08-23*

## Self-Check: PASSED

All created files confirmed on disk; all 4 task/docs commit hashes confirmed in `git log`.
