---
phase: quick-260823-jre
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - tests/smoke/phase4-screens.spec.ts
  - apps/web/src/app/(dashboard)/orders/page.tsx
  - apps/web/src/app/(dashboard)/orders/[id]/page.tsx
  - apps/web/src/app/(dashboard)/losses/page.tsx
  - apps/web/src/app/(dashboard)/dds/page.tsx
  - apps/web/src/components/losses/pareto.tsx
  - package.json
  - .planning/WINDOWS.md
autonomous: true
requirements: [QUICK]   # test-coverage task against already-shipped Phase-04 requirements (DIFOT-01, DASH-02, DDS-01); no new ROADMAP requirement ID applies

estimate:
  tokens: 55000
  raw_tokens: 55000
  tasks: 3
  confidence: low       # estimate-calibration: sample_count=0, factor=1.0, applied=false

must_haves:
  truths:
    - "`pnpm test:smoke` drives a real Chromium against the live compose stack and fails if `/orders`, `/orders/[id]`, `/losses`, or `/dds` stops rendering the data its own API returns"
    - "Every UI number asserted in the new spec is cross-checked against that same endpoint's JSON inside the same test run — no hardcoded expected percentages or counts that would drift as the plant runs"
    - "Both DIFOT honesty paths are asserted: a due-day that has orders renders a real percentage; a due-day that has none renders N/A and never a zero percentage"
    - "The DDS test asserts whichever Delivery branch the live payload actually took, and records which branch ran as a Playwright annotation, so a green suite can never be mistaken for coverage of the populated-Delivery path"
    - "WINDOWS entries 8, 9, and 11 end this task in a state that matches what a run actually exercised — none is marked fixed on the strength of a test that skipped or took the other branch"
    - "`pnpm smoke` starts the worker, so a cold-start run has the ingestion service every Phase-4 screen depends on"
    - "The existing `tests/smoke/compose-stack.spec.ts` still passes unchanged, and the unit/integration suite still runs 31 files / 136 tests green without collecting anything from `tests/smoke/`"
  artifacts:
    - path: "tests/smoke/phase4-screens.spec.ts"
      expected: "new browser-level spec covering the four Phase-4 screens, with a warm-up readiness gate and a header comment stating exactly which WINDOWS claims it does and does not close"
    - path: "apps/web/src/components/losses/pareto.tsx"
      expected: "canvas chart gains a screen-reader-only data table rendered from the same deriveParetoSeries buckets that feed setOption"
    - path: "package.json"
      expected: "`smoke` script brings up worker alongside db/mqtt/simulator/web"
    - path: ".planning/WINDOWS.md"
      expected: "entry 11 resolved only if the populated-Delivery branch ran; entries 8 and 9 left open with their narrowed status recorded in the SUMMARY"
  key_links:
    - from: "live REST payload (/api/orders, /api/losses, /api/dds)"
      to: "rendered DOM on the four Phase-4 screens"
      via: "data-testid hooks read in the same test that fetched the JSON"
    - from: "a ranked loss row on /orders/[id]"
      to: "/timeline pre-filtered and highlighted"
      via: "clicking the row and asserting the resulting URL carries lineId, highlightStart, highlightEnd"
    - from: "/api/sim-clock simNow"
      to: "the day /api/dds resolves as yesterday"
      via: "asserting the DDS board's displayed day is simNow minus one calendar day"
---

<objective>
Phase 04 shipped four screens whose only automated coverage is unit tests and API-shape spot-checks. Three WINDOWS `unrun-verify` entries (8, 9, 11) record live checks the executor could not complete inside its time budget. This task adds browser-level E2E coverage for the Phase-4 screens, following the convention already established by `tests/smoke/compose-stack.spec.ts`: assert against the running `docker compose` appliance, because that is where integration defects actually live.

Purpose: make the demo storyline — orders screen to drill-down to timeline, Pareto, DDS board — regression-proof at the browser level, and close the WINDOWS entries that browser tests can honestly close.

Output: one new smoke spec, a small set of test affordances on the four screens, a fixed `smoke` script, and a WINDOWS ledger that reflects what a run actually exercised.

**Scope honesty is the point of this task.** Two of the three WINDOWS claims are causal and sim-day-bound; they are scoped out below with reasons, not faked. A test that goes green without exercising the behavior it names would close a ledger entry under false pretenses — worse than leaving the entry open.

No tracer task in the GSD sense is needed as a separate step, because Task 1 *is* the tracer: it wires one screen end-to-end (production affordance -> spec -> Playwright runner -> live stack -> green) before Tasks 2 and 3 expand horizontally to the remaining screens.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@tests/smoke/compose-stack.spec.ts (THE convention — read in full before writing a line of the new spec: env-var-derived URLs, failure messages that name the cause, comments explaining why each assertion exists)
@playwright.config.ts (testDir ./tests/smoke, workers 1, fullyParallel false, timeout 60s, expect timeout 15s, baseURL from LINELENS_WEB_URL, no webServer block)
@.planning/WINDOWS.md (entries 8, 9, 11 — the exact claims; 10 explains why clock-warping is off the table)
@apps/web/src/app/(dashboard)/orders/page.tsx
@apps/web/src/app/(dashboard)/orders/[id]/page.tsx
@apps/web/src/app/(dashboard)/losses/page.tsx
@apps/web/src/app/(dashboard)/dds/page.tsx
@apps/web/src/components/losses/pareto.tsx
@apps/web/src/lib/loss-pareto.ts (ParetoBucket shape the screen-reader table renders)
@apps/web/src/components/orders/status-chip.tsx (status codes render as human labels — On Time / Late / At Risk / Open)
</context>

<research_findings>

## Fixture invariants — verified from repo source, not from today's database

Every fixture below is a *structural* guarantee from the worker's own code, so the spec stays deterministic on a fresh machine and on a long-running stack alike. Each was also confirmed live against the currently-running stack while planning.

1. **2026-01-07 always has orders due.** `apps/worker/src/orders/generate.ts` exports `WARM_START_DAY = '2026-01-05'`, and `ensureOrderBookSeeded` backfills that day's order book on *every* clock-poll tick (2s). `generateOrdersForDay` sets `dueDate = orderDate + 2 days`. So any live stack with a running worker has an order book due 2026-01-07 within seconds of boot. Live check: 15 due, DIFOT populated.

2. **2026-01-06 can never have an order due.** Order books are generated only for `WARM_START_DAY` and for the current sim-day (which is never earlier than 2026-01-05). Due days are therefore 2026-01-07 and simDay+2, both at or after 2026-01-07. Live check: zero orders, `difot` null. This is a permanent, structurally guaranteed N/A fixture — exactly the surface the null-versus-zero bug fixed in `9d516fe` lived on.

3. **2026-01-05 always has loss events on every line.** The simulator replays the warm-start sim-day (2026-01-05T06:55 to 2026-01-06T06:55) on every boot, which fully covers that day's S1 (07:00–15:00) and S2 (15:00–23:00) shift windows. Live check: `/api/losses?lineId=L1&day=2026-01-05` returned 22 Pareto rows spanning both shifts.

4. **All three fixtures are completed past sim-days, so their derived rows are immutable.** This is what makes UI-versus-API cross-checks deterministic: `useLive`'s SSE-driven refetch cannot change a finished day mid-assertion, and a concurrent `inject-breakdown` from `compose-stack.spec.ts` (which targets the live present) cannot perturb them. Prefer these fixtures over "today" everywhere except the DDS board, which has no day parameter.

## What browser tests cannot honestly close, and why

**WINDOWS 8** — "inject-breakdown on a line, wait ~1 sim-day, that line's product shows lower DIFOT contribution." One sim-day is 24 real minutes at the default 60x. There is no honest way to assert this inside Playwright's 60s test timeout. **Entry 8 stays open.** What this plan adds instead is a regression guard on the surface the claim would eventually be observed on: the per-line DIFOT contribution grid is asserted against the API, so it cannot silently stop rendering before anyone gets to observe the cascade.

**WINDOWS 9** — "inject on L2, within ~1 sim-day an L2-product order shows LATE with the injected breakdown top-ranked in its drill-down." Same sim-day dependency, plus a second blocker: a scan of every day that has orders on the live stack found **zero** LATE or AT_RISK orders, and the ranked-loss list in `orders/[id]/page.tsx` only renders for those two statuses. **Entry 9 is narrowed, not closed** — this plan automates the drill-down's rendering and deep-link half; the causal half remains a live observation.

**WINDOWS 11** — `/api/dds` Delivery populated. Closable by this plan's DDS test, but only on a run where sim time has passed 2026-01-08T00:00, because the route derives "yesterday" from `sim_now()` and takes no `day` parameter. The board's yesterday must reach 2026-01-07 (the first due-day) for Delivery to be non-null. The test asserts the correct branch either way and annotates which branch ran; **mark entry 11 fixed only after a run whose annotation records the populated branch.**

## Two techniques that are explicitly forbidden here

**Do not fast-forward the sim clock via `POST /control/speed` to reach a data state.** It looks like a shortcut and is a trap: (a) `ensureOrderBookSeeded` only generates an order book for the sim-day it observes on a poll tick, so warping past days leaves permanent holes in the demo order book; (b) the simulator publishes in real time, so raising speed multiplies event throughput proportionally, and the worker's documented ingestion cost (WINDOWS entry 10) means the pipeline falls behind and the appliance is left lagging. Sim time is one-way — a smoke test must not mutate the appliance's calendar.

**Do not inject a breakdown to try to manufacture an AT_RISK order.** `v_order_status`'s rate CTE is `COALESCE(NULLIF(recent.goodPerSec, 0), fallback.goodPerSec, 0)` — when the measured trailing-60-sim-minute rate reaches exactly zero, it falls back to the *ideal* rate, so a fully-downed product reads as healthy. Only a partial rate collapse trips the projection, which is a transient timing-dependent window. Not deterministic, therefore not testable.

## Environment facts to honor

- Chromium is present in the local Playwright cache, but the plan still runs an explicit install step — it is a no-op when present and the difference between a clear setup step and a cryptic launch failure on another machine.
- `apps/web` has zero `data-testid` attributes today. Tasks 1–3 add a small, named set to the four Phase-4 screens.
- `vitest.config.ts` sets `projects: ["packages/*", "apps/*"]`, so a root-level `tests/smoke/` directory is structurally excluded from the unit suite. Do not add a root project entry.
- The unit/integration suite runs green under `volta run --node 24.10.0 -- pnpm run test` (plain `pnpm` spawns Node 20 on this machine and breaks jsdom).
- `Select` renders a native `select` with `aria-label`; both date pickers already carry `aria-label` ("Due date" on orders, "Sim day" on losses). Use those roles; add testids only where a value sits in an unlabelled sibling div.

</research_findings>

<tasks>

<task type="tracer">
  <name>Task 1: Orders list end-to-end — one screen wired from testid to green suite</name>
  <files>apps/web/src/app/(dashboard)/orders/page.tsx, tests/smoke/phase4-screens.spec.ts, package.json</files>
  <precondition>The compose stack is up and healthy (`docker compose ps` shows db, mqtt, simulator, worker, web running) and the worker has ingested the warm-start replay — `/api/orders?day=2026-01-07` must return a non-null `difot`.</precondition>
  <action>
Fix the `smoke` script in `package.json` first: it currently brings up db, mqtt, simulator and web but omits `worker`, which is the service that generates the order book, allocates production, and derives loss events. Every Phase-4 screen is empty without it. Add `worker` to the `docker compose up -d --wait` service list, leaving the `test:smoke` script untouched.

Add `data-testid` attributes to `orders/page.tsx` — nothing else about the file changes. Name them: `difot-value` on the large percentage div, `difot-subtitle` on the "on time, in full" / "no orders due" line beneath it, `difot-by-line` on the per-line grid container, `difot-line-tile` on each per-line tile (with a `data-line-id` attribute carrying `l.lineId` and a nested `difot-line-value` on its percentage), `orders-table` on the table element, `order-row` on each table row (with a `data-order-id` attribute carrying `o.orderId`), and `orders-empty` on the empty-state paragraph. These exist because the values sit in unlabelled sibling divs where a positional selector would be brittle.

Create `tests/smoke/phase4-screens.spec.ts`. Mirror `compose-stack.spec.ts`'s style exactly: a file-header block comment explaining what human check this automates, env-derived URLs, and a short comment above each non-obvious assertion saying why it exists. The header comment must also state plainly which WINDOWS claims this spec closes and which it does not (see the research findings above) — a future reader must not infer more coverage than exists.

Give the file a shared warm-up gate in `test.beforeAll`: using Node's global `fetch` against `process.env.LINELENS_WEB_URL ?? 'http://localhost:3000'`, poll until `/api/orders?day=2026-01-07` reports a non-null `difot` with at least one order. Raise the hook's timeout well past the 60s default and fail with a message naming the real cause — the worker is still ingesting the warm-start replay, wait and re-run — rather than a bare assertion failure. The gate is required because a cold `pnpm smoke` needs several minutes for the worker to ingest 24 sim-hours of replay before any Phase-4 screen has data.

Write two tests in an "orders list" describe block.

Test one, the real-data cross-check: register a `pageerror` listener, navigate to `/orders`, wait until the "Due date" input has a non-empty value (the page seeds it once from the sim clock; filling before that seed lands would be overwritten), then fill it with 2026-01-07. Fetch `/api/orders?day=2026-01-07` through Playwright's `request` fixture in the same test. Assert: `difot-value` matches the API's `difot.difotPct` rounded to a whole percent; `difot-subtitle` contains the API's `onTimeCount` and `totalDue`; `difot-by-line` contains exactly one `difot-line-tile` per entry in the API's `byLine`, and each tile keyed by `data-line-id` shows that line's rounded percentage; `orders-table` contains exactly `orders.length` rows; and every row's status chip text is one of the four human labels the StatusChip component renders. Assert no page errors were collected.

Test two, the null-versus-zero honesty guard: same navigation, but fill the date with 2026-01-06 — a day that structurally can never have an order due. Assert `orders-empty` is visible, `difot-value` reads exactly the not-available marker, and `difot-subtitle` states no orders are due. Then assert that the `difot-value` element's text does not match a percentage pattern at all — this is the regression guard for the class of bug fixed in commit `9d516fe`, where an absent measurement was rendered as a real zero.

Do not hardcode expected percentages or counts anywhere; every expected value comes from the API response fetched in the same test.
  </action>
  <verify>
    <automated>pnpm exec playwright install chromium &amp;&amp; pnpm exec playwright test --grep "orders list"</automated>
  </verify>
  <done>`pnpm smoke` lists worker among the services it starts; both orders-list tests pass against the live stack; `orders/page.tsx` changed only by added attributes.</done>
</task>

<task type="auto">
  <name>Task 2: Order drill-down navigation and the Losses Pareto</name>
  <files>apps/web/src/app/(dashboard)/orders/[id]/page.tsx, apps/web/src/components/losses/pareto.tsx, apps/web/src/app/(dashboard)/losses/page.tsx, tests/smoke/phase4-screens.spec.ts</files>
  <action>
Add `data-testid` attributes to `orders/[id]/page.tsx`: `order-customer`, `order-product`, `order-qty` on their value divs; `order-status` on a span wrapping the header StatusChip (wrap it rather than changing the shared component, which several screens use); `order-headline` on the headline Card; `loss-list` on the ranked-loss container and `loss-row` on each loss Link, each row carrying a `data-est-units` attribute with the raw `estLostUnits` value so ranking can be asserted numerically instead of by parsing display text; `allocations-table` on the table and `allocation-row` on each row.

Give `components/losses/pareto.tsx` a screen-reader-only data table. Today the entire chart is a canvas with no text alternative, so there is no honest way to assert its ranking claim from a browser, and no way for assistive tech to read it either. Lift the `deriveParetoSeries(rows, groupBy)` call out of the effect into a `useMemo` in render scope (it is a pure function, and `lib/loss-pareto.ts` already exists specifically to keep this math outside the canvas), feed the memoized value to both the existing `setOption` effect and a new table. Render the table inside the existing container as a visually-hidden element using Tailwind's `sr-only`, marked `data-testid="pareto-table"`, one `data-testid="pareto-row"` per bucket carrying `data-label`, `data-minutes` and `data-cumulative` attributes plus visible-to-screen-reader cells for the same three values. Keep the chart's own rendering untouched — same registration list, same options object.

In `losses/page.tsx` add `data-testid="pareto-chart"` on the Card that hosts the chart and `data-testid="losses-empty"` on the empty-state paragraph.

Add three tests to the spec.

An "order drill-down" test: navigate to `/orders`, set the date to 2026-01-07 as in Task 1, fetch the same day's API payload, take the first order it returns, click that order's row link matched by its `data-order-id`, and assert the URL now ends with that order id. Fetch `/api/orders/{id}` and cross-check `order-customer`, `order-product`, `order-qty` and `order-status` against it, mapping the API's status code to the human label StatusChip renders. Assert `allocations-table` has exactly as many `allocation-row` elements as the API returned allocations — call `test.slow()` on this test, because a completed warm-start order can carry thousands of allocations and rendering them is genuinely slow. For an ON_TIME order additionally assert that `order-headline` is present (the fulfillment-story contrast beat) and that `loss-list` is absent — that absence is the UI's documented rendering rule, that the ranked loss list is reserved for LATE and AT_RISK, not an accident. Assert no page errors.

A "drill-down money shot" test that is honest about its own reachability: fetch `/api/orders?day=` across the small set of due-days that the fixture invariants and the current sim day imply, looking for an order whose status is LATE or AT_RISK. If none exists, call `test.skip()` with a message that says plainly that the stack currently has no late or at-risk order so the ranked-loss path was not exercised and the corresponding WINDOWS claim remains unverified. If one is found, navigate to it and assert: `order-headline` is present and names the top loss's line name; the `data-est-units` values across `loss-row` elements are in non-increasing order; the first row's href carries `lineId`, `highlightStart` and `highlightEnd`; and clicking it lands on `/timeline` with those three parameters still present and no page errors on the destination. A skip here is the honest outcome — never soften this into an assertion that passes when the path was not taken.

A "losses pareto" test: navigate to `/losses`, wait for the "Line" select to have options, select the first line, set "Sim day" to 2026-01-05 (structurally guaranteed to hold a full replayed day of losses on every line). Fetch `/api/losses?lineId=&day=` for the same pair. Assert `losses-empty` is absent and `pareto-chart` contains a canvas with non-zero width. Assert `pareto-table` has one `pareto-row` per distinct reason code in the API rows, that `data-minutes` is non-increasing across rows, that `data-cumulative` is non-decreasing and its final value is within a small tolerance of one hundred, and that the summed minutes match the API's summed `lostTimeSec` converted to minutes within a small tolerance. Then click the group-by-category control and assert the row labels are now drawn from the six-loss-category vocabulary while the summed minutes are unchanged — the toggle must move real data, not just button styling.
  </action>
  <verify>
    <automated>pnpm exec playwright test --grep "drill-down|losses pareto"</automated>
  </verify>
  <done>Drill-down navigation and Pareto tests pass; the money-shot test either passes or skips with an explicit unreachability message; the Pareto canvas keeps rendering identically and now has a screen-reader table beside it.</done>
</task>

<task type="auto">
  <name>Task 3: DDS board, full-suite run, and WINDOWS reconciliation</name>
  <files>apps/web/src/app/(dashboard)/dds/page.tsx, tests/smoke/phase4-screens.spec.ts, .planning/WINDOWS.md</files>
  <action>
Add `data-testid` attributes to `dds/page.tsx`: `dds-day` on the yesterday label; `dds-safety-value`, `dds-quality-value`, `dds-quality-sub`, `dds-delivery-value`, `dds-delivery-sub`, `dds-oee-value` on the four tiles' value and sub-line divs; `dds-top-loss` on the top-loss Link and `dds-top-loss-empty` on its empty state; `dds-actions` on the actions list with `dds-action-row` per item; `dds-escalations` on the escalations container with `dds-escalation-row` per item, and `dds-no-escalations` on the no-escalations state.

Add a "dds board" test. Navigate to `/dds` and register a `pageerror` listener. Read the day from `dds-day`, then fetch `/api/dds`; if the two days differ, re-read the UI and re-fetch once — the board's yesterday rolls over every 24 real minutes and a single retry covers straddling that boundary. Assert the resolved day equals the sim clock's day minus one, using `/api/sim-clock` for the sim now — this proves the route's yesterday resolution rather than assuming it.

Cross-check every tile against the payload: safety days-since-incident; quality percentage and reject count; OEE percentage; and the top-loss card, which must either show the API's reason label, line name and rounded minutes, or show the empty state when `topLoss` is null. Assert `dds-action-row` count equals the API's actions length and that each row's text contains its action's owner. Assert `dds-escalation-row` count equals the API's escalations length, or that `dds-no-escalations` is visible when there are none.

Handle Delivery as an explicit two-branch assertion, and record which branch ran. When the payload's `delivery.difotPct` is null, assert `dds-delivery-value` reads the not-available marker, assert `dds-delivery-sub` does not display a numeric late-order count, and push a test annotation recording that the Delivery path was the empty one. When it is non-null, assert the tile matches the rounded percentage, assert the sub-line shows the API's `lateCount`, additionally cross-check the percentage against `/api/orders?day={dds.day}`'s own `difot.difotPct` (two independent read paths over the same underlying view), and push an annotation recording that the populated Delivery path ran. The annotation is what makes a green run auditable — without it, nobody can tell from the report which branch was exercised.

Now run the full suite and reconcile the ledger. Run `pnpm test:smoke` — the whole file plus the pre-existing `compose-stack.spec.ts`, which must still pass untouched. Run `pnpm typecheck` and `volta run --node 24.10.0 -- pnpm run test` (plain pnpm spawns the wrong Node on this machine) and confirm the unit suite is still 31 files / 136 tests green with nothing collected from `tests/smoke/`.

Then update `.planning/WINDOWS.md` strictly according to what the run exercised, using `gsd-tools windows fixed <id>` (invoke via the runtime's gsd-tools entry point). Mark entry 11 fixed **only if** the DDS test's annotation recorded the populated Delivery branch; if it recorded the empty branch, leave 11 open and write the closure procedure into the SUMMARY: leave the stack up until the sim clock passes 2026-01-08T00:00 (roughly 24 real minutes per sim-day at the default speed), re-run the DDS test, and mark it fixed if the annotation flips. Leave entries 8 and 9 open — do not append new ledger entries for them, since that would inflate `open_count` without adding information. Record their narrowed status in the task SUMMARY instead: the rendering and deep-link halves are now automated, and only the live causal observation remains outstanding for each.
  </action>
  <verify>
    <automated>pnpm test:smoke &amp;&amp; pnpm typecheck &amp;&amp; volta run --node 24.10.0 -- pnpm run test</automated>
  </verify>
  <done>Full smoke suite green including the pre-existing compose spec; unit suite still 31 files / 136 tests; WINDOWS entry 11 resolved only if its populated branch actually ran; entries 8 and 9 left open with their narrowed status written into the SUMMARY.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| test harness -> simulator control port (4000) | Already-documented trusted-network-only surface (Phase 3 audit T-04); this task adds no new calls to it |
| browser -> web API routes | Unchanged; this task adds no route, parameter, or auth path |
| build toolchain -> package registry | No new dependency is added; Playwright is already pinned at 1.61.1 |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-jre-01 | Information disclosure | data-testid attributes on four Phase-4 pages | low | accept | Testids name UI regions and echo values already rendered on the page; no identifier, secret, or internal path is newly exposed |
| T-quick-jre-02 | Tampering | dependency surface | low | mitigate | Zero packages installed. `playwright install chromium` fetches a browser binary for an already-pinned existing dependency; no Package Legitimacy audit table is required because no package is added |
| T-quick-jre-03 | Denial of service | live compose appliance | medium | mitigate | Spec is forbidden from calling `/control/speed` or injecting breakdowns; it reads completed past sim-days only, so it cannot perturb the running plant or leave the ingestion pipeline backlogged |
</threat_model>

<verification>
- `pnpm test:smoke` green against the live stack, including the untouched `compose-stack.spec.ts`.
- `pnpm typecheck` clean for the changed web files.
- `volta run --node 24.10.0 -- pnpm run test` still 31 files / 136 tests, no `tests/smoke/` collection.
- The Losses page renders identically to before by eye; the added table is screen-reader-only.
- Every assertion in the new spec traces to a value fetched from an API in the same test, or to a structural fixture invariant documented in this plan's research findings.
</verification>

<success_criteria>
- The four Phase-4 screens have browser-level regression coverage that fails when a screen stops rendering its API's real data.
- The null-versus-zero honesty rule is guarded automatically on both the orders and DDS surfaces.
- WINDOWS entry 11 is closed if and only if a run exercised the populated Delivery branch; entries 8 and 9 remain open with an accurate written account of what is now automated and what still needs a live sim-day.
- No test in the suite can pass without exercising the behavior its name claims — the money-shot test skips loudly rather than passing hollow.
</success_criteria>

<output>
Create `.planning/quick/260823-jre-add-playwright-smoke-tests-for-the-phase/260823-jre-SUMMARY.md` when done.
</output>
