---
phase: 04-difot-pareto-dds
verified: 2026-08-23T10:15:00Z
status: verified
score: 4/4 must-have truths present, wired, and live-observed
behavior_unverified: 0
overrides_applied: 0
behavior_unverified_items: []
resolved_behavior_items:
  - truth: "A viewer drills down from a late/at-risk order to the specific contributing machine-level loss events with one click, and the highlighted Timeline band actually renders (success criterion 3, first half)"
    resolved: 2026-08-23T14:40:00Z
    how: "The sim clock produced a genuine AT_RISK order unaided (ORD-2026-01-05-CYC-C-0, due 2026-01-07) on a live clean-volume docker stack. The 'drill-down money shot' smoke test then RAN rather than test.skip()ing -- 1 passed (15.5s) -- executing the CR-01 regression guard expect(shiftSelect).toHaveValue(linkedShiftId) along with the ranked-loss ordering and deep-link param assertions. No breakdown injected, no clock fast-forward. WINDOWS entry 13 closed."
    caveat: "AT_RISK is transient; a full-suite re-run minutes later skipped test 9 again because the order had reverted to OPEN. The assertion ran and passed once, on demand it is not reproducible until sim time passes a due date."
---

# Phase 4: DIFOT, Losses Pareto & DDS Verification Report

**Phase Goal:** Connect machine-level losses to broken customer promises and management-language decisions — the differentiator plus the analytical and synthesis screens that compose the loss ledger and live pipeline.
**Verified:** 2026-08-23T10:15:00Z
**Status:** verified
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria, ROADMAP.md)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A viewer sees a Six Big Losses Pareto / Top Losses report, stackable per shift | ✓ VERIFIED | `apps/web/src/components/losses/pareto.tsx` — real ECharts bar+line combo, `stack: "loss"` per shift with per-shift alpha shading over the same category hue, cumulative-% line on a second axis, By-reason/By-category toggle. Backed by `GET /api/losses` reading `v_loss_pareto` (`packages/db/src/views.sql:343`). `deriveParetoSeries` (`apps/web/src/lib/loss-pareto.ts`) unit-tested (5 tests: sort, cumulative-to-100%, per-shift-sum reconciliation). Live docker check in 04-03-SUMMARY.md returned 13 real rows across 6 reason codes and both shifts. Nav item enabled (no `disabled` field in `nav.tsx`'s `/losses` entry). |
| 2 | A viewer sees DIFOT % computed from a simulated order book fulfilled from simulated production output | ✓ VERIFIED | `apps/worker/src/orders/generate.ts` (deterministic seeded order generation from PPT/ICT × profile heuristic) + `apps/worker/src/orders/allocate.ts` (`allocateGoodProduction`, wired as an inline hook inside `intervals.ts`'s single derivation transaction — real FIFO-by-due-date allocation of actual `goodDelta` counts, not a simulated/mocked value). `v_order_status`/`v_difot`/`v_difot_line` (`views.sql:372-491`) compute ON_TIME/LATE/AT_RISK/OPEN and DIFOT% with correct sim-time UTC casts and dimensionally-correct projection math (no ICT-factor bug). `GET /api/orders` wires these views directly, no static fallback. Live-verified: 26 real orders generated across two sim-days; `/api/orders?day=2026-01-08` returned real DIFOT 72.7% (11 due, 8 on-time). |
| 3 | A viewer drills down from a late/at-risk order to the specific contributing machine-level loss events, and injecting a different breakdown changes which order goes late — a genuinely causal link, not a hardcoded demo path | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (causal mechanism itself: ✓ VERIFIED) | The **causal-link claim** is rigorously proven by `apps/worker/test/causality.test.ts` — a real-pipeline (real simulator, real derivation, real FIFO allocation, real `order_loss_drilldown` SQL — nothing mocked or re-implemented) seed-42 A/B test: injecting a 4h breakdown on L2 (i) flips a real CYC-B order ON_TIME→LATE/AT_RISK with a genuine remaining-qty shortfall, (ii) leaves the untouched control line L3's raw telemetry byte-identical between runs (proven at the simulator/RNG-stream level, not just by observation), and (iii) ranks the injected breakdown in the newly-late order's drill-down top 3. All 4 assertions pass. This directly discharges "not a hardcoded demo path." **The UI drill-down mechanism** (`order_loss_drilldown` SQL, order-detail page headline/loss-cards, Timeline deep-link + pulsing Gantt highlight) is present, wired, and unit/component-tested (`order-headline.test.ts`, 8 tests; Gantt highlight props unit-tested) — and a real bug in it (CR-01: Timeline shift-picker silently overriding an explicit deep-link `shiftId=S1`) was found by code review and fixed in `4650a12`. But the one test built to exercise this exact behavior end-to-end in a browser — `tests/smoke/phase4-screens.spec.ts`'s "drill-down money shot" — has `test.skip()`'d on every run so far because no LATE/AT_RISK order has existed in the live stack since the fix landed (WINDOWS.md entry 13, open). No live click-through (loss card → timeline → band pulses) has ever been observed, before or after the fix. |
| 4 | A viewer sees a Daily Direction Setting screen: yesterday's safety/quality/delivery + OEE + top loss, top-3 actions with owners, and escalation status | ✓ VERIFIED | `apps/web/src/app/(dashboard)/dds/page.tsx` — real S/Q/D tiles (safety=synthetic days-since-incident counter, quality=real Q%+rejects, delivery=real DIFOT%+late count), OEE tile with delta, "Top loss yesterday" card, "Today's top 3 actions" list with owner chips, Escalations card (or green all-clear), TPM-inspired footer microcopy (no IWS/P&G claim). `GET /api/dds` computes plant OEE via sums-of-components (never an average of ratios), calls `generateDdsActions`/`deriveEscalations` (`apps/web/src/lib/dds-actions.ts`, deterministic two-level reason-code template map + 45min/80%-DIFOT thresholds, 18 unit tests including exhaustive per-reason-code coverage and exact-boundary escalation tests — no LLM, no unseeded randomness). Live-verified against docker with real derived data: plant OEE 65.75%, 3 ranked actions with owners, 2 real escalations. A real N/A-vs-0 bug (`lateCount` returning 0 instead of null on a zero-orders-due day) was found live and fixed (`9d516fe`); WINDOWS entry 11 (the non-null Delivery path check) is marked `fixed`. |

**Score:** 4/4 truths have present, wired, substantively-correct implementations; 3/4 are behaviorally proven end-to-end (including, notably, criterion 3's core "not hardcoded" causal claim via `causality.test.ts`). 1/4 (criterion 3's UI click-through half) is present + wired but behaviorally unexercised by any passing live/e2e test — routed to human verification below.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/worker/src/orders/allocate.ts` | FIFO allocation from good deltas to open orders | ✓ VERIFIED | `planFifoAllocation` (pure) + `allocateGoodProduction` (I/O wrapper) exist, wired into `intervals.ts` as an in-transaction hook (04-01-SUMMARY.md), unit-tested for the 30%-output/earliest-due-ships and never-over-allocate invariants. |
| `packages/db/src/views.sql` — `order_loss_drilldown` | SQL function ranking loss events per order | ✓ VERIFIED | Present at `views.sql:555`, paired with `order_drilldown_context` (LEFT JOIN guarantee so a zero-loss order still returns shortUnits/totalEstLostUnits), correct A/P vs Q unit-conversion math, correct `sim_now() AT TIME ZONE 'UTC'` casts throughout. |
| `apps/web/src/app/(dashboard)/dds/page.tsx` | The management screen | ✓ VERIFIED | Full DDS-01 content spec implemented and wired to `GET /api/dds`; see truth #4 evidence above. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `customer_order` + `allocation` | `loss_event` | line/product/time-window join, consumed by drill-down | ✓ WIRED | `order_drilldown_context`/`order_loss_drilldown` resolve producing line(s) via `machine.currentProductId` OR any in-window COUNTS event for the product (handles real product rotation, confirmed live), then join `loss_event` rows overlapping `[orderDate, COALESCE(shippedAt, GREATEST(dueDate, sim_now()))]`. |
| `customer_order` | `loss_event` | product → line(s) → loss windows | ✓ WIRED | Same as above; live-verified against docker (`ORD-2026-01-05-CYC-A-0` returned 12 correctly-shaped ranked loss rows spanning two lines). |
| DIFOT drill-down loss card | Timeline page | `/timeline?lineId&shiftDate&shiftId&machineId&highlightStart&highlightEnd` deep link | ⚠️ WIRED, behavior unverified live | Code present (`orders/[id]/page.tsx`'s `deepLinkHref`, `timeline/page.tsx`'s URL-param seeding + `shiftIdFromUrl` ref, `gantt.tsx`'s pulsing highlight overlay); CR-01 bug in this exact link was found and fixed; the live click-through has never been exercised by a passing test (see truth #3). |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DASH-02 | 04-03 | Six Big Losses Pareto, stackable per shift | ✓ SATISFIED | Truth #1 above. |
| DIFOT-01 | 04-01 | Simulated order book fulfilled from simulated production, DIFOT % | ✓ SATISFIED | Truth #2 above. |
| DIFOT-02 | 04-02 | Drill-down from late/at-risk order to machine-level loss events (money shot) | ✓ SATISFIED (causal mechanism proven); UI click-through unexercised live — see behavior_unverified_items | Truth #3 above. |
| DDS-01 | 04-03 | Daily Direction Setting screen | ✓ SATISFIED | Truth #4 above. |

No orphaned requirements found — REQUIREMENTS.md's traceability table maps exactly these four IDs to Phase 4, and all four appear in a plan's `requirements` frontmatter field.

### Anti-Patterns Found

None. Grep for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|not yet implemented|coming soon` across every file this phase created/modified under `apps/worker/src/orders`, `apps/web/src/app/api/{orders,losses,dds}`, `apps/web/src/app/(dashboard)/{orders,losses,dds}`, and `apps/web/src/lib/{order-headline,loss-pareto,dds-actions}.ts` returned zero matches.

### Behavioral / Test Evidence (already gathered this session, independently spot-checked)

- Full vitest suite (regression gate), current HEAD, Node 24: 31 files / 136 tests, all passing.
- `apps/web` vitest after the CR-01 fix: 7 files / 34 tests green.
- `pnpm run build`: clean; all Phase-4 routes compile (`/orders`, `/orders/[id]`, `/losses`, `/dds`, plus their API routes).
- `apps/worker/test/causality.test.ts` read in full (this verification): the A/B design is genuinely rigorous — same production code paths (real `plant.ts`, real `startDerivationLoop`, real `generateOrdersForDay`/`allocateGoodProduction`, real `order_loss_drilldown` SQL), an unconfounded control-line comparison at the simulator/RNG level (not just order-status level), and an explicit sanity check that the injected loss only exists in Run B. This is not "a test named causality" — it exercises and asserts the exact causal chain success criterion 3 requires.
- Playwright smoke suite against the live docker stack: 10 passed, 1 skipped (the "drill-down money shot" test, `phase4-screens.spec.ts:252`), 0 failed — confirmed the skip is because no LATE/AT_RISK order existed on that run, not a failure.
- CR-01 fix (`4650a12`) read directly in `timeline/page.tsx`: `shiftIdFromUrl` ref correctly gates the andon-default effect from overriding an explicit `?shiftId=` param; matches the code-review's prescribed fix exactly.

## Gaps Summary

No blocking gaps. All four ROADMAP success criteria have real, substantive, wired implementations backed by SQL that follows every documented domain/sim-time convention, and three of the four are behaviorally proven end-to-end by passing tests (including, for criterion 3, the specific "not a hardcoded demo path" claim via a rigorous real-pipeline A/B test).

The one open item is narrower than the full criterion: the **UI half** of criterion 3 ("one click reaches the ranked machine-level loss events... [and] the highlighted band renders") is present and wired in code, has a real bug found-and-fixed by code review (CR-01), but has never been observed passing end-to-end against a live LATE/AT_RISK order — the regression test built specifically to catch a reintroduction of CR-01 has skipped on every run since the fix landed. This is honestly recorded by the phase itself as WINDOWS.md entries 9 and 13 (both open, `unrun-verify`), not something the phase tried to hide. It is expected to self-resolve as the demo stack's sim clock naturally produces a LATE order (or via a fixture-seeded test in a follow-up), and the project's own WINDOWS ledger already tracks it as such.

This does not indicate cosmetic or hardcoded behavior — the causal mechanism underneath is independently and rigorously proven — it indicates that the specific browser-level "click and watch it pulse" moment has not yet been witnessed by any test or human. Recorded here as a human-verification item rather than a gap, per the verifier's behavior-dependent-truth handling.

## Human Verification Required

### 1. Live drill-down click-through on a real LATE/AT_RISK order

**Test:** Once the running (or a freshly warm-started) docker stack's sim clock has produced at least one LATE or AT_RISK order (check `GET /api/orders?day=<a due day>`), open that order's detail page (`/orders/[id]`), confirm the headline sentence and ranked loss cards render, then click the top loss card.
**Expected:** The Timeline page opens with `lineId`/`shiftDate`/`shiftId` matching the loss row (not silently reverted to the sim's currently-active shift), and the linked state-interval band visibly pulses amber.
**Why human:** No passing automated run (Playwright or otherwise) has yet exercised this path since the CR-01 fix landed — every verification run's live stack happened to have zero LATE/AT_RISK orders, so the "drill-down money shot" smoke test skipped rather than asserted. The underlying fix is correct by code reading and the mechanism is unit-tested piecewise, but the composed live behavior is unproven.

---

_Verified: 2026-08-23T10:15:00Z_
_Verifier: Claude (gsd-verifier)_


---

## Post-verification addendum (2026-08-23T14:40Z)

The UAT run that closed this phase's one outstanding item also surfaced a
**new, more serious defect** on the first genuinely clean stack anyone had run:
smoke test 10 failed its fixture invariant (`line L1 must have losses on
2026-01-05`).

Root cause: the simulator published the entire warm-start sim-day as a ~1.5 s
burst at boot, ~16 s before the ingestion worker subscribed
(`sessionPresent: false`), and `clean:false` + QoS 1 only replays into a session
that already exists. Structural rather than flaky —
`worker.depends_on.simulator: service_healthy` guarantees the worker starts
last. It killed the DDS "yesterday" board (all-null) and the warm-start day's
Losses Pareto on exactly the Phase-05 target scenario.

Tracked as WINDOWS entry 15 and fixed in quick task `260823-tkx` (commit
`0227886`) via a worker→simulator readiness handshake. Re-verified live on a
clean volume: earliest event `2026-01-05 07:00`, losses on all four lines, DDS
yesterday populated, smoke suite 10 passed / 1 skipped with test 10 green.

This did not change any Phase-04 must-have truth — the Phase-04 screens were
correct; the data feeding them was missing.
