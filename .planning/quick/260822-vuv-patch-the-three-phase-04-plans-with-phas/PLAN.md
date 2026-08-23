---
phase: quick-260822-vuv
plan: 1
type: execute
wave: 1
depends_on: []
files_modified: [.planning/phases/04-difot-pareto-dds/04-01-PLAN.md, .planning/phases/04-difot-pareto-dds/04-02-PLAN.md, .planning/phases/04-difot-pareto-dds/04-03-PLAN.md]
autonomous: true
requirements: [QUICK]   # planning-artifact patch; no ROADMAP requirement ID applies (marker only, not fabricated traceability)

estimate:
  tokens: 45000
  raw_tokens: 45000
  tasks: 4
  confidence: low       # estimate-calibration: sample_count=0, factor=1.0, applied=false

must_haves:
  truths:
    - "04-02-PLAN.md states, with repo evidence, that `loss_event.stateIntervalId` is declared-but-never-written, gives BOTH deep-link options (sim-time window vs populate the column) with their real costs, and does not pick one for the executor"
    - "04-02-PLAN.md tells whoever edits `timeline/page.tsx` that WINDOWS entries 3 and 4 already cover that file's empty-shift default and shiftDate-rollover seeding — a blank timeline during testing is expected, and the seeding bug is not to be opportunistically fixed here"
    - "Each of the three plans carries the Phase-03 web conventions that its OWN tasks actually need — Prisma singleton, raw-pg ISO-'Z' binding, `sim_now() AT TIME ZONE 'UTC'`, `useLive` as the only SSE client, N/A-never-0 — placed in the task bodies they apply to, not blanket-pasted"
    - "Every factual claim written into the three plans is traceable to a file in this repo or to a Context7 doc lookup; nothing is copied on faith from the task brief"
    - "All nine existing task blocks (3 per plan) survive un-renumbered and un-reworded; every pre-existing formula and rationale string is intact"
    - "No application source, schema, migration, config, or other planning document is modified"
  artifacts:
    - path: ".planning/phases/04-difot-pareto-dds/04-02-PLAN.md"
      expected: "patched — deep-link mechanism tradeoff in Task 2, sim-time cast rule in Task 1, WINDOWS 3/4 warning, web conventions"
    - path: ".planning/phases/04-difot-pareto-dds/04-01-PLAN.md"
      expected: "patched — views.sql authoring contract + sim-time cast in Task 2, web conventions + nav location in Task 3, two frontmatter files_modified additions"
    - path: ".planning/phases/04-difot-pareto-dds/04-03-PLAN.md"
      expected: "patched — ECharts/palette precision + nav location in Task 1, cross-app import tradeoff in Task 2, N/A-never-0 in Task 3"
  key_links:
    - from: ".planning/STATE.md Decisions (02-03 stateIntervalId entry; 03-01/03-02/03-03 entries) + .planning/WINDOWS.md entries 2-6"
      to: "the nine Phase-04 task action bodies"
      via: "verified, task-scoped insertions naming the exact repo files that prove each claim"
---

<objective>
LineLens authored all 14 PLAN.md files in one pass on 2026-07-23, before any phase executed. The standing project decision for exactly this situation is explicit: later-phase plans assume earlier-phase contracts, and when execution deviates from a contract, the downstream plans get UPDATED before they execute — never improvised around. Quick task `260822-f2w` did this for `03-01-PLAN.md` with the Phase-02 deltas (commit `deff23a`); this is the same operation for Phase 04, which has three plans and a larger delta surface.

Phase 03 has now shipped (PR #7). The three Phase-04 plans predate every convention Phase 03 established and one Phase-02 deviation that lands directly on 04-02's signature feature. Phase 4 executes on Sonnet under the project principle that plans carry the full logic so execution needs no re-derivation — so these facts must live IN the plan text, not only in STATE.md and WINDOWS.md.

Purpose: close the Phase-02/03 to Phase-04 contract deltas before Phase 4 executes, so the executor cannot (a) build the drill-down deep-link on a column that contains no data, (b) re-derive or contradict a Phase-03 web convention, or (c) burn time "fixing" a defect that is already ledgered and deliberately deferred.
Output: three patched PLAN.md files. Planning-document edit only — zero application source, schema, migration, or config changes.

No tracer task: this is a documentation patch across three sibling files with no layers to wire end-to-end. Tasks 1–3 are the changes (one per plan, 04-02 first because it carries the load-bearing delta); Task 4 is the preservation and scope gate.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/phases/04-difot-pareto-dds/04-01-PLAN.md (patch target — read fully before the first Edit)
@.planning/phases/04-difot-pareto-dds/04-02-PLAN.md (patch target — read fully before the first Edit)
@.planning/phases/04-difot-pareto-dds/04-03-PLAN.md (patch target — read fully before the first Edit)
@.planning/quick/260822-f2w-patch-planning-phases-03-live-dashboard-/260822-f2w-PLAN.md (the precedent — match its shape, depth, and Edit-only discipline)
@.planning/STATE.md (Accumulated Context > Decisions and Blockers — source of the deltas)
@.planning/WINDOWS.md (entries 2-6 — the deliberately-deferred open items)
</context>

<evidence>
Every claim the three patches assert was verified in this repo at plan-authoring time. The executor does NOT need to re-verify; it needs to transcribe accurately. Cite these paths inside the patch text so a future reader can re-check.

**E1 — `loss_event.stateIntervalId` is declared but never written.**
- Declared: `packages/db/prisma/schema.prisma:194` (`stateIntervalId BigInt?`), created by `packages/db/prisma/migrations/20260821154415_derived_state_schema/migration.sql:29`.
- Never written: a repo-wide grep for `stateIntervalId` across `*.ts`/`*.sql`/`*.prisma` (excluding `node_modules` and the Prisma-generated client) returns exactly those two lines and nothing else. `apps/worker/src/derive/prisma-store.ts#upsertLossEvent` builds its `data` object from thirteen fields and omits it; `LossEventInput` in `apps/worker/src/derive/types.ts` has no such field.
- Confirmed live: `.planning/phases/02-oee-engine/02-VERIFICATION.md:80` records `0 | 42768` — zero non-null rows out of 42,768.
- Source of the deferral: `.planning/phases/02-oee-engine/02-03-SUMMARY.md` `key-decisions` + line 234 "Phase 4 planning note".

**E2 — `loss_event.injected` IS populated.** `apps/worker/src/derive/losses.ts` sets `injected: closed.injected` for rules 1/2 (lines 43, 80, 98, 116) and `injected: false` for rules 3/4/5 (lines 141, 172, 239); `prisma-store.ts:100` writes it. `04-02-PLAN.md:64`'s existing "no join needed" claim is CORRECT — leave that clause untouched.

**E3 — `state_interval.injected` also exists and is populated** (`schema.prisma:160`, written by `prisma-store.ts#openInterval` from `intervals.ts:103` `event.meta?.injected ?? false`). This is what makes the window-based deep-link viable without any schema change.

**E4 — the timeline page reads no search params today.** `apps/web/src/app/(dashboard)/timeline/page.tsx` is `"use client"` and seeds `lineId`/`shiftDate`/`shiftId` from `GET /api/andon` in a mount effect using `setShiftDate((prev) => prev || activeShift.shiftDate!)`. No `useSearchParams`, no `searchParams` prop anywhere in the file.

**E5 — `useSearchParams()` in a Client Component needs a `<Suspense>` boundary** or the production build of a statically-rendered page fails; in development it appears to work (verified via Context7, Next.js `use-search-params.mdx` "Behavior > Prerendering"). Relevant here because `docker-compose.yml:80` runs web as `pnpm --filter @linelens/web dev` — i.e. `next dev` — so this failure mode would NOT surface in the docker demo, only in `next build`.

**E6 — nav items live in `apps/web/src/components/ui/nav.tsx`, not in `layout.tsx`.** `NAV_ITEMS` there carries `{ href: "/orders" | "/losses" | "/dds", disabled: true, disabledLabel: "Phase 4" }`. `apps/web/src/app/(dashboard)/layout.tsx` only mounts `<Nav />` and `<TopBar />`.

**E7 — `packages/db/src/views.sql` is the single hand-maintained SQL source.** Its header (lines 7-14) states the migration folder holds a byte-identical copy and that changing a view requires a NEW migration, never an in-place edit of an applied one. Its CONVENTION block (lines 16-25) states every sim-time column is naive `timestamp(3)` while `sim_now()` returns `timestamptz`, so every comparison goes through `sim_now() AT TIME ZONE 'UTC'`.

**E8 — the three Phase-04 plans use bare `sim_now()` three times and contain zero `AT TIME ZONE`.** `04-01-PLAN.md:62` (`dueDate < sim_now()`, `projected_finish = sim_now() + ...`), `04-02-PLAN.md:21` and `:46` (`GREATEST(dueDate, sim_now())`).

**E9 — the raw-pg binding rule is real and was a Critical defect in Phase 3.** `03-REVIEW.md:77` CR-01, fixed in `fd36da1` ("bind ISO Z-suffixed strings for sim-time SQL comparison in andon route"). The waiver marker convention is live: `apps/web/src/app/api/sim-clock/route.ts:22` carries `-- sim-tz-ok: scalar clock read, no comparison`, and `03-01-PLAN.md:87` defines the grep gate that honors it.

**E10 — Prisma singleton.** `apps/web/src/lib/db.ts` exports a `globalThis`-cached `db` built by `createDb()` from `@linelens/db/client`. `03-01-SUMMARY.md` key-decisions: added specifically "to avoid a new PrismaClient/connection-pool per route call".

**E11 — `useLive` is the single SSE client.** `apps/web/src/hooks/use-live.ts` exports `useLive(refetch, opts?)` with `DEBOUNCE_MS = 300`, `POLL_MS = 5000`, reconnect backoff 1000→5000ms. `04-01-PLAN.md:75`'s existing "useLive refetch" reference is ACCURATE — leave it.

**E12 — `GET /api/andon` returns a per-line `machines[]` array** (`apps/web/src/app/api/andon/route.ts`, the `machines:` key in the mapped result — 03-02 deviation), alongside `lineId`, `lineName`, `state`, `reasonCode`, `since`, `goodCount`, `targetCount`, `shiftDate`, `shiftId`.

**E13 — N/A-never-0 is enforced in code, not just doctrine.** Same route: `goodCount: currentShift ? (...) : null` and `targetCount = currentShift ? ... : null`.

**E14 — Turbopack/workspace resolution.** `apps/web/next.config.ts` sets `transpilePackages: ["@linelens/db", "@linelens/contracts"]`; the Prisma generator uses `importFileExtension = ""` and `output = "../src/generated/prisma"`; `packages/contracts/package.json` exposes nine `exports` subpaths. Both packages Phase 4's web code needs are already wired, so this rule only bites on a genuinely NEW workspace dependency.

**E15 — `@linelens/worker` is not consumable from `apps/web`.** `apps/worker/package.json` has no `exports` field and no build; `@linelens/worker` is not a dependency of `apps/web` and is not in `transpilePackages`. `apps/web/node_modules/@linelens/` contains only `db`.

**E16 — there is no shared ECharts wrapper component.** `apps/web/src/components/oee/waterfall.tsx` is a purpose-built component whose ~40-line init/`setOption`/dispose/resize PATTERN is what 03-02-SUMMARY means by "reused as-is by 03-03/04-03". It registers `[BarChart, GridComponent, TooltipComponent, CanvasRenderer]` via tree-shaken `echarts/core`.

**E17 — the loss palette is keyed by OEE factor, not by Six Big Loss.** `apps/web/src/components/ui/state-color.ts` exports `LOSS_COLORS = { availability, performance, quality, productive }`. `packages/contracts/src/losses.ts` exports `SIX_BIG_LOSSES` (6 values) and `LOSS_FACTOR: Record<SixBigLoss, OeeFactor>` mapping them onto AVAILABILITY/PERFORMANCE/QUALITY.

**E18 — apps/worker typecheck is not clean at baseline.** WINDOWS entry 2: 15 pre-existing implicit-`any` errors across `prisma-store.ts`/`runner.ts`/`golden.test.ts`, confirmed unrelated via `git stash`.

**E19 — deferred web items.** WINDOWS entry 3 (oee page empty-shift default + shiftDate seeded once, never follows sim-day rollover; sim 23:00-07:00 = 8 of every 24 real minutes at 60x), entry 4 (the same rollover bug in `timeline/page.tsx`, "fix both together"), entry 5 (inject rate limiting client-side only), entry 6 (`console.*` instead of pino; pino not installed in `apps/web`).
</evidence>

<tasks>

<task type="auto">
  <name>Task 1: Patch 04-02-PLAN.md — the drill-down deep-link delta</name>
  <files>.planning/phases/04-difot-pareto-dds/04-02-PLAN.md</files>
  <precondition>`git status --porcelain -- apps packages docker` is empty and `git rev-parse --short HEAD` is `37dc3b4`. If HEAD differs, capture the actual pre-edit HEAD as BASE and substitute it for `37dc3b4` everywhere it appears in this plan's gates.</precondition>
  <reversibility rating="reversible">Single tracked markdown file; `git checkout -- <path>` restores it.</reversibility>
  <action>
    Use Edit (scoped replacement) for every change. NEVER Write the whole file. Do not renumber, reorder, merge, or reword the three existing tasks. Every change is a pure insertion — zero deletions, zero frontmatter changes in this file.

    LINE ENDINGS: this file is CRLF (verified). Preserve CRLF on every Edit; a silent LF conversion rewrites all 98 lines and buries the real change.

    (A) Insert a new top-level `contract_deltas` XML block between the objective block and the execution_context block, in the plan's existing voice:

        Contract deltas (this plan was authored 2026-07-23, before Phases 02-03 executed; per the standing all-phase-upfront-planning decision in STATE.md, read these before Task 1):
        - `loss_event.stateIntervalId` is a DEAD column — see the DEEP-LINK MECHANISM block in Task 2. It changes how the loss-card link is built.
        - `loss_event.injected` is alive and correct — Task 2's existing 'no join needed' claim holds.
        - `apps/web/src/app/(dashboard)/timeline/page.tsx`, which this plan EDITS, carries two open WINDOWS entries (3 and 4). See the KNOWN LEDGERED ITEMS block in Task 2 before touching it.
        - Sim-time SQL against `sim_now()` needs the Phase-02 UTC cast — see Task 1.

    (B) The CONTEXT section: append these reference lines in the section's existing "@path (note)" style —
        @packages/db/src/views.sql (the sim-time cast convention in its header lines 16-25, and the "new migration, never edit an applied one" rule in lines 7-14 — this plan writes SQL into this file)
        @.planning/phases/02-oee-engine/02-03-SUMMARY.md (§ key-decisions and "Phase 4 planning note" — the source of the stateIntervalId deferral)
        @.planning/WINDOWS.md (entries 3, 4 and 6 — open, deliberately-deferred items on the files this plan touches)
        @apps/web/src/app/(dashboard)/timeline/page.tsx (the page this plan edits — read its state-seeding effect before adding the highlight param)

    (C) The ACTION body of Task 1 ("Drill-down SQL function"): append this bullet after item 5, matching the block's indentation —
        - SQL AUTHORING CONTRACT (Phase-02, 02-03): `order_loss_drilldown` goes in `packages/db/src/views.sql`, which is the single hand-maintained source; the migration under `packages/db/prisma/migrations/*` carries a BYTE-IDENTICAL copy of it. Migrations are immutable once applied — always create a NEW migration, never edit an existing one in place (rule stated in views.sql's own header, lines 7-14).
        - SIM-TIME CAST RULE (Phase-02 contract, silent-corruption class): every sim-time column in this schema is `timestamp(3) WITHOUT TIME ZONE` (naive) while `sim_now()` returns `timestamptz`. Step 2's window `COALESCE(shippedAt, GREATEST(dueDate, sim_now()))` MUST be written `GREATEST("dueDate", sim_now() AT TIME ZONE 'UTC')` — bare `sim_now()` silently shifts the whole window under a non-UTC Postgres session, returning plausible-but-wrong losses with no error. Copy the clamp form verbatim from `packages/db/src/views.sql`. The same rule applies to `customer_order.orderDate/dueDate/shippedAt`, which 04-01 creates as naive sim-time columns.

    (D) The ACTION body of Task 2 ("Order detail drill-down UI"): leave the existing loss-list bullet exactly as written (its `loss_event.injected` / 'no join needed' claim is verified correct), and append this block after it —
        - DEEP-LINK MECHANISM — READ BEFORE BUILDING THE LOSS-CARD LINK. The bullet above specifies `highlight=<stateIntervalId|window>`. The `stateIntervalId` half has no data behind it. Verified: the column is declared at `packages/db/prisma/schema.prisma:194` (`stateIntervalId BigInt?`) and created by migration `20260821154415_derived_state_schema`, but nothing writes it — `apps/worker/src/derive/prisma-store.ts#upsertLossEvent` omits it from its `data` object, `LossEventInput` in `apps/worker/src/derive/types.ts` has no such field, and a repo-wide grep finds the identifier ONLY in the schema and the migration. `.planning/phases/02-oee-engine/02-VERIFICATION.md` records the live count: 0 non-null out of 42,768 rows. This was a deliberate, documented deferral by 02-03 (out of that plan's file scope), flagged there specifically so Phase 4 would not plan around a dead column. Two ways forward — pick one, state the choice and the reason in 04-02-SUMMARY.md:
        - OPTION A — sim-time window (stays inside this plan's declared files). Link as `/timeline?lineId=<lineId>&shiftDate=<shiftDate>&shiftId=<shiftId>&machineId=<machineId>&highlightStart=<windowStart ISO>&highlightEnd=<windowEnd ISO>`. Task 1's function already returns `machineId`, `lineId`, `windowStart` and `windowEnd` per loss row, so no new query output is needed. The Gantt then pulses every band on that machine overlapping `[highlightStart, highlightEnd)`. Honest caveat to carry into the UI copy: rules 3/4/5 losses (ALARM micro-stops, the slow-cycle residual, rejects) are SUB-interval, so the highlight is "the band(s) this loss falls inside", not "the band that is this loss" — for the demo's headline case (rule 1, a DOWN interval) the window and the band coincide exactly, so the money shot is unaffected.
        - OPTION B — populate the column first (crosses this plan's file scope). Plumb `stateIntervalId` through `apps/worker/src/derive/{types,losses,store,prisma-store}.ts` for rules 1 and 2 — the only rules that have a source interval — then re-derive to backfill: delete all `state_interval` + `loss_event` rows and reset every `MachineCursor` to (0, 0); replay is deterministic and idempotent (documented on the `MachineCursor` model in schema.prisma). Buys an exact band for breakdown/changeover losses. Does NOT remove the need for Option A: rules 3/4/5 would still be NULL, so the window path must exist regardless. Also adds four files outside `files_modified` plus a worker change into a plan whose Task 3 asserts causality on a re-derived database.
        - Implementation note for either option (verified): `apps/web/src/app/(dashboard)/timeline/page.tsx` currently reads NO search params — it is a `"use client"` component seeding `lineId`/`shiftDate`/`shiftId` from `GET /api/andon` in a mount effect. Two consequences. (i) Seed the picker state FROM the URL params on first render: the effect uses `setShiftDate((prev) => prev || activeShift.shiftDate!)`, so a URL-derived initial value wins and the andon default will not clobber it — do not remove that `prev ||` guard. (ii) `useSearchParams()` inside a Client Component must sit within a `<Suspense>` boundary or the production build of a statically-rendered page fails (Next.js docs, "Behavior > Prerendering"); it appears to work in development, and `docker-compose.yml` runs web as `next dev`, so this will NOT surface in the docker demo — only in `next build`. Either wrap the param-reading part in `<Suspense>` or read the params in a server component wrapper and pass them down.
        - WEB CONVENTIONS (Phase 03) for `apps/web/src/app/api/orders/[id]/route.ts`: reach Prisma through the `apps/web/src/lib/db.ts` globalThis-cached singleton — never construct a `PrismaClient` per route (03-01 added the singleton specifically to stop a connection pool per call). If the route binds sim-time parameters through raw `pg` rather than Prisma, bind ISO 'Z'-suffixed strings via `.toISOString()`, NEVER `Date` objects — raw-pg Date serialization for naive timestamp columns is local-OS-TZ dependent, and this exact violation was Critical finding CR-01 in the Phase-03 code review (fixed in `fd36da1`); the dev machine runs Asia/Jakarta (UTC+7), so a violation returns wrong rows locally with no error. Use `useLive(refetch)` from `apps/web/src/hooks/use-live.ts` for any live refresh — it is the single SSE client (EventSource + 300ms debounce + 5s polling fallback); do not write a second one. Log with `console.*` to match the surrounding routes: pino is not installed in `apps/web` and swapping it in is ledgered as WINDOWS entry 6, out of scope here. Render `null` as "N/A", never `0` — `0` asserts "produced nothing", which is a different and false claim.
        - KNOWN LEDGERED ITEMS on the file this plan edits — do NOT "fix" these here. `timeline/page.tsx` carries WINDOWS entry 4 (its `shiftDate` is seeded once on mount and never follows a sim-day rollover) and shares WINDOWS entry 3's root cause with `oee/page.tsx` (at 60x, sim 23:00-07:00 is 8 of every 24 real minutes with no active shift, so the page's default lands on an empty shift roughly a third of the time and renders N/A). Both are deferred by explicit user decision and entry 4 says to fix them together with entry 3. Practical impact on this task: a blank timeline while you test the deep-link is EXPECTED, not a new defect — set the pickers manually, or test during a sim shift window. Do not opportunistically repair the seeding here; do make sure the deep-link explicitly SETS shiftDate/shiftId from the loss row rather than relying on the default seeding, which is the broken path.

    (E) The VERIFICATION section: append these bullets after the existing two —
        - Sim-time gate on the SQL this plan writes: `grep -n "sim_now()" packages/db/src/views.sql | grep -v "AT TIME ZONE 'UTC'" | grep -v "sim-tz-ok:"` prints nothing.
        - Deep-link decision recorded: 04-02-SUMMARY.md names Option A or Option B, with the reason, in key-decisions.
        - Baseline noise: `apps/worker` typecheck is NOT clean before this plan starts — 15 pre-existing implicit-`any` errors (WINDOWS entry 2). Do not chase them; compare against the baseline rather than expecting zero.
  </action>
  <verify>
    <automated>f=.planning/phases/04-difot-pareto-dds/04-02-PLAN.md; grep -q 'contract_deltas' "$f" && grep -q 'highlightStart' "$f" && grep -q 'OPTION A' "$f" && grep -q 'OPTION B' "$f" && grep -q '42,768' "$f" && grep -q "AT TIME ZONE 'UTC'" "$f" && grep -q 'lib/db.ts' "$f" && grep -q 'CR-01' "$f" && grep -q 'use-live.ts' "$f" && grep -q 'WINDOWS entry 4' "$f" && grep -q 'Suspense' "$f" && [ "$(grep -c '^<[t]ask type=' "$f")" -eq 3 ] && [ "$(git diff --numstat 37dc3b4 -- "$f" | cut -f2)" -eq 0 ] && echo PASS</automated>
  </verify>
  <done>04-02-PLAN.md names the dead column with its live 0/42,768 evidence, presents both deep-link options with their real costs without picking one, carries the UTC cast rule in Task 1 and the Phase-03 web conventions plus the WINDOWS 3/4 warning in Task 2, still has exactly three task blocks, and the diff is pure insertion (zero deletions).</done>
</task>

<task type="auto">
  <name>Task 2: Patch 04-01-PLAN.md — SQL authoring contract and web conventions</name>
  <files>.planning/phases/04-difot-pareto-dds/04-01-PLAN.md</files>
  <action>
    Edit-only, CRLF-preserving, no task renumbering. This file gets the ONE authorized frontmatter change in this quick task — declared in (A) below and called out explicitly because the constraint requires it.

    (A) Frontmatter `files_modified` (line 7): append two paths, leaving the seven existing entries in order.
        - `packages/db/src/views.sql` — REQUIRED, not cosmetic. Task 2 creates `v_order_status`, `v_difot` and `v_difot_line`, and 02-03 established views.sql as the single hand-maintained source of every view with a byte-identical copy in a new migration (rule in that file's header). Writing these views into a migration alone would silently break that convention on the first plan after it was established.
        - `apps/web/src/components/ui/nav.tsx` — REQUIRED. Task 3 says "enable the nav item", and the nav item is the `/orders` entry in the `NAV_ITEMS` array in this file (carrying `disabled: true, disabledLabel: "Phase 4"`). `apps/web/src/app/(dashboard)/layout.tsx`, already declared, only mounts `<Nav />` — editing it alone cannot enable anything. Leave layout.tsx in the list; the additions are purely additive.
        Wave safety check (do not skip): 04-01 is wave 1; 04-03 is wave 2 and will also touch nav.tsx, and 04-02 is wave 2 and already declares views.sql. Neither addition creates a same-wave `files_modified` overlap, so the wave assignments stay valid as-is.

    (B) The CONTEXT section: append —
        @packages/db/src/views.sql (single source of truth for every view — its header states the new-migration rule and the sim-time cast convention this plan's views must follow)
        @.planning/WINDOWS.md (entry 2 — apps/worker typecheck baseline is not clean; entries 3/6 — deferred web items)

    (C) The ACTION body of Task 2 ("FIFO allocation + shipping + status"): append after the `v_difot_line` bullet —
        - SQL AUTHORING CONTRACT (Phase-02, 02-03): `v_order_status`, `v_difot` and `v_difot_line` go in `packages/db/src/views.sql` (now declared in files_modified), with a byte-identical copy in a NEW migration under `packages/db/prisma/migrations/*`. Migrations are immutable once applied — never edit an existing one in place. Rule and rationale are in views.sql's own header, lines 7-14.
        - SIM-TIME CAST RULE (Phase-02 contract, silent-corruption class): declare `CustomerOrder.orderDate/dueDate/shippedAt` and `Allocation.producedAt` as naive sim-time columns, same convention as `machine_event.simTime` — `timestamp(3) WITHOUT TIME ZONE`. `sim_now()` returns `timestamptz`, so BOTH sim-now uses in the status rules above must be written `(sim_now() AT TIME ZONE 'UTC')`: the open-late test `"dueDate" < (sim_now() AT TIME ZONE 'UTC')` and the projection base `projected_finish = (sim_now() AT TIME ZONE 'UTC') + ...`. Bare `sim_now()` silently shifts every comparison under a non-UTC Postgres session — plausible-but-wrong LATE/AT_RISK flags, no error raised. Copy the clamp form verbatim from `packages/db/src/views.sql`, and follow its performance precedent too: 02-03 hit a 2.29s query and fixed it by driving row presence from master data with CROSS JOIN LATERAL correlated subqueries rather than a DISTINCT scan over the event table.
        - The trailing-60-sim-min `current_good_rate` window is also a sim-time comparison — same cast, same rule.

    (D) The ACTION body of Task 3 ("Orders screen"): append after the page bullet —
        - WEB CONVENTIONS (Phase 03 — these were established after this plan was authored). Prisma: reach it through the `apps/web/src/lib/db.ts` globalThis-cached singleton; never construct a `PrismaClient` per route (03-01 added the singleton to stop a connection pool per call). Raw SQL: if `/api/orders` binds sim-time parameters through raw `pg` instead of Prisma, bind ISO 'Z'-suffixed strings via `.toISOString()`, NEVER `Date` objects — raw-pg Date serialization for naive timestamp columns is local-OS-TZ dependent; this exact violation was Critical finding CR-01 in the Phase-03 code review, fixed in `fd36da1`. Live refresh: the existing "useLive refetch" reference is correct — `useLive(refetch, opts?)` in `apps/web/src/hooks/use-live.ts` is the single SSE client (EventSource + 300ms debounce + 5s polling fallback); do not write a second one. Nav: the `/orders` entry lives in the `NAV_ITEMS` array in `apps/web/src/components/ui/nav.tsx` — drop its `disabled: true, disabledLabel: "Phase 4"` fields; `layout.tsx` only mounts `<Nav />`. Line list: `GET /api/andon` now also returns a per-line `machines[]` array of `{ machineId, state }` (03-02 deviation) alongside `lineId`/`lineName`/`shiftDate`/`shiftId` — available if the orders screen reuses it to seed a line picker, as the OEE and timeline pages do. Logging: use `console.*` to match the surrounding routes; pino is not installed in `apps/web` and is ledgered as WINDOWS entry 6. Workspace deps: `@linelens/db` and `@linelens/contracts` are already in `next.config.ts`'s `transpilePackages`, so nothing new is needed here — but if this task ever DOES add a new workspace TS package to the web app, it must be reachable via a package.json `exports` subpath (never a relative `.js`-suffixed import) AND listed in `transpilePackages`; Turbopack's dev bundler cannot resolve a relative `.js`→`.ts` hop between sibling files in a workspace source package, which bit Phase 3 twice.
        - N/A NEVER 0 (project rule, enforced in code at `apps/web/src/app/api/andon/route.ts`): the DIFOT tile renders `null` → "N/A" when no orders are due in the selected sim-day. `DIFOT 0%` asserts "every order was late", which is a different and false claim. Same for the trend-vs-yesterday delta when yesterday has no due orders.

    (E) The VERIFICATION section: append —
        - Sim-time gate: `grep -n "sim_now()" packages/db/src/views.sql | grep -v "AT TIME ZONE 'UTC'" | grep -v "sim-tz-ok:"` prints nothing.
        - Baseline noise: `apps/worker` typecheck is NOT clean before this plan starts — 15 pre-existing implicit-`any` errors across `prisma-store.ts`/`runner.ts`/`golden.test.ts` (WINDOWS entry 2, confirmed unrelated via `git stash`). This plan modifies `apps/worker/src/derive/intervals.ts` and adds `apps/worker/src/orders/*`; compare typecheck output against that 15-error baseline, do not expect zero and do not chase them.
  </action>
  <verify>
    <automated>f=.planning/phases/04-difot-pareto-dds/04-01-PLAN.md; grep -q 'packages/db/src/views.sql' "$f" && grep -q 'components/ui/nav.tsx' "$f" && grep -q "AT TIME ZONE 'UTC'" "$f" && grep -q 'lib/db.ts' "$f" && grep -q 'CR-01' "$f" && grep -q 'machines\[\]' "$f" && grep -q 'transpilePackages' "$f" && grep -q 'WINDOWS entry 2' "$f" && grep -q 'N/A NEVER 0' "$f" && [ "$(grep -c '^<[t]ask type=' "$f")" -eq 3 ] && [ "$(git diff --numstat 37dc3b4 -- "$f" | cut -f2)" -le 1 ] && echo PASS</automated>
  </verify>
  <done>04-01-PLAN.md declares views.sql and nav.tsx in files_modified with the reason stated inline, carries the views/migration authoring contract and both UTC-cast sites in Task 2, and the five Phase-03 web conventions plus N/A-never-0 in Task 3. Three task blocks intact; deletions ≤ 1 (only the rewritten files_modified line).</done>
</task>

<task type="auto">
  <name>Task 3: Patch 04-03-PLAN.md — charting precision, nav location, cross-app import</name>
  <files>.planning/phases/04-difot-pareto-dds/04-03-PLAN.md</files>
  <action>
    Edit-only, CRLF-preserving, no task renumbering, no frontmatter change (see the note in (C) — the file-set consequence there is genuinely undecided, so it is surfaced as an executor decision rather than pre-committed in frontmatter).

    (A) The CONTEXT section: append —
        @apps/web/src/components/oee/waterfall.tsx (the ECharts pattern this plan's Pareto reuses — read it before writing pareto.tsx)
        @apps/web/src/components/ui/state-color.ts (the single colour source of truth — LOSS_COLORS is keyed by OEE factor, see Task 1)
        @.planning/WINDOWS.md (entries 2 and 6 — baseline typecheck noise and the console.*-not-pino deferral)

    (B) The ACTION body of Task 1 ("Losses Pareto (DASH-02)"): append after the "Reuse the chart wrapper from 03-02" bullet —
        - CHART WRAPPER, PRECISELY (Phase 03): there is no shared wrapper COMPONENT to import. What 03-02 established is a ~40-line PATTERN, implemented in `apps/web/src/components/oee/waterfall.tsx`: `"use client"`, tree-shaken `echarts/core` plus an explicit `echarts.use([...])` registration, `echarts.init(el, undefined, { renderer: "canvas" })` once in a mount effect, `setOption` in a separate data-change effect, `dispose` plus a `window` resize-listener teardown on unmount. Deliberately no `echarts-for-react` dependency. Copy the pattern into `components/losses/pareto.tsx`. The Pareto needs a second series type and a second axis, so its registration list is larger than the waterfall's `[BarChart, GridComponent, TooltipComponent, CanvasRenderer]` — add `LineChart` for the cumulative-% line and `LegendComponent` for the stack legend. `echarts@6.1.0` is already a dependency of `apps/web`; do not add a second charting library — 03-03 proved ECharts covers LineLens's hardest chart (the custom-series Gantt) end-to-end.
        - CATEGORY COLOURS (single source of truth): `apps/web/src/components/ui/state-color.ts` is the only place colours are read from, and its `LOSS_COLORS` is keyed by OEE FACTOR (`availability` / `performance` / `quality` / `productive`), NOT by Six Big Loss. Map through `LOSS_FACTOR` in `@linelens/contracts` (`packages/contracts/src/losses.ts`), which gives each of the six categories its factor: UNPLANNED_STOPS and PLANNED_STOPS → availability, SMALL_STOPS and SLOW_CYCLES → performance, STARTUP_REJECTS and PRODUCTION_REJECTS → quality. If six distinguishable colours are genuinely needed (two per factor, e.g. shade-differentiated), EXTEND state-color.ts rather than defining a palette inside pareto.tsx — and if the new tokens are also used in the DOM, add matching `--color-*` entries to `globals.css`, which has no build-time link to state-color.ts and must be kept in sync by hand (03-02 key-decision).
        - NAV: the `/losses` entry is in the `NAV_ITEMS` array in `apps/web/src/components/ui/nav.tsx` — drop its `disabled: true, disabledLabel: "Phase 4"` fields. `apps/web/src/app/(dashboard)/layout.tsx` only mounts `<Nav />`. Neither file is currently in this plan's `files_modified`; adding `apps/web/src/components/ui/nav.tsx` is an expected in-scope deviation to record in 04-03-SUMMARY.md (04-01 in wave 1 also touches it; 04-03 is wave 2, so there is no same-wave file conflict).
        - Live refresh: `useLive(refetch, opts?)` in `apps/web/src/hooks/use-live.ts` is the single SSE client (EventSource + 300ms debounce + 5s polling fallback) — the existing "useLive refetch" instruction is correct; do not write a second hook.

    (C) The ACTION body of Task 2 ("DDS aggregation + rule-generated actions"): append after the escalation-rules bullet —
        - WHERE `actions.ts` LIVES — DECIDE BEFORE WRITING IT. This task places the pure action-generator at `apps/worker/src/dds/actions.ts` and the consumer at `apps/web/src/app/api/dds/route.ts`. As written, the route cannot import it: verified, `apps/worker/package.json` declares no `exports` field and has no build step, `@linelens/worker` is not a dependency of `apps/web`, and it is not in `next.config.ts`'s `transpilePackages` (`apps/web/node_modules/@linelens/` contains only `db`). Phase 3 hit this class of Turbopack/workspace-resolution failure twice — a workspace TS package is reachable from the web app ONLY through a package.json `exports` subpath (never a relative `.js`-suffixed import) AND an entry in `transpilePackages`. Two ways forward — pick one and record it in 04-03-SUMMARY.md:
        - OPTION A — put the pure function in the web app: `apps/web/src/lib/dds-actions.ts`, unit-tested under `apps/web/test/`. Cheapest, matches where 03-02/03-03 already put pure logic consumed by the web tier (`lib/oee-waterfall.ts`, `lib/timeline-data.ts`), and adds no packaging work. Cost: the worker cannot reuse it — acceptable, since nothing in this plan makes the worker generate DDS actions.
        - OPTION B — promote it to a shared package (e.g. a `./dds` subpath on `@linelens/contracts`, which already exposes nine `exports` subpaths and is already in `transpilePackages`). Correct if the actions ever need to run worker-side. Cost: touches `packages/contracts/package.json` and its src tree — outside this plan's `files_modified` — and contracts is currently pure vocabulary/config with no domain logic, so this widens what that package means.
        - Either way `files_modified` changes; that is a Rule-2 deviation to state in the SUMMARY, not something to improvise silently. Do NOT reach for a relative `../../../worker/src/...` import — it will not resolve under Turbopack and will not survive the standalone build.
        - WEB CONVENTIONS (Phase 03) for `/api/losses` and `/api/dds`: reach Prisma through the `apps/web/src/lib/db.ts` globalThis-cached singleton, never a per-route `PrismaClient`. If either route binds sim-time parameters through raw `pg` rather than Prisma, bind ISO 'Z'-suffixed strings via `.toISOString()`, NEVER `Date` objects — raw-pg Date serialization for naive timestamp columns is local-OS-TZ dependent, and this was Critical finding CR-01 in the Phase-03 code review (fixed in `fd36da1`). Any `sim_now()` comparison used to resolve "last COMPLETED sim-day" must be written `(sim_now() AT TIME ZONE 'UTC')` — the sim-time columns are naive `timestamp(3)` while `sim_now()` returns `timestamptz`. Log with `console.*` to match the surrounding routes; pino is not installed in `apps/web` (WINDOWS entry 6).
        - N/A NEVER 0 (project rule, enforced in code at `apps/web/src/app/api/andon/route.ts`): emit `null`, not `0`, for yesterday's Q%, OEE, DIFOT% and the OEE delta when the underlying window has no data — `0%` asserts a real, bad measurement, which is a different and false claim. The warm-start guarantees one completed sim-day, so this should be rare, but the payload contract still has to allow it.

    (D) The ACTION body of Task 3 ("DDS screen"): append after the footer-microcopy bullet —
        - NAV: "Enable the nav item" means the `/dds` entry in the `NAV_ITEMS` array in `apps/web/src/components/ui/nav.tsx` (drop `disabled` / `disabledLabel`), the same file Task 1 edits for `/losses` — one Edit can cover both.
        - Tiles render `null` as "N/A", never `0` (see Task 2). This applies to the Quality, Delivery and OEE tiles; the Safety counter is a seeded synthetic number and always has a value.

    (E) The VERIFICATION section: append —
        - Baseline noise: `apps/worker` typecheck is NOT clean before this plan starts — 15 pre-existing implicit-`any` errors (WINDOWS entry 2). This plan may add `apps/worker/src/dds/actions.ts`; compare against that baseline, do not expect zero and do not chase them.
        - Sim-time gate, if any raw SQL is added under apps/web: `grep -rn "sim_now()" apps/web/src/app/api apps/web/src/lib | grep -v "AT TIME ZONE 'UTC'" | grep -v "sim-tz-ok:"` prints nothing.
        - `actions.ts` placement decision recorded in 04-03-SUMMARY.md key-decisions.
  </action>
  <verify>
    <automated>f=.planning/phases/04-difot-pareto-dds/04-03-PLAN.md; grep -q 'waterfall.tsx' "$f" && grep -q 'LineChart' "$f" && grep -q 'LOSS_FACTOR' "$f" && grep -q 'components/ui/nav.tsx' "$f" && grep -q 'OPTION A' "$f" && grep -q 'OPTION B' "$f" && grep -q 'transpilePackages' "$f" && grep -q 'lib/db.ts' "$f" && grep -q 'CR-01' "$f" && grep -q "AT TIME ZONE 'UTC'" "$f" && grep -q 'N/A NEVER 0' "$f" && [ "$(grep -c '^<[t]ask type=' "$f")" -eq 3 ] && [ "$(git diff --numstat 37dc3b4 -- "$f" | cut -f2)" -eq 0 ] && echo PASS</automated>
  </verify>
  <done>04-03-PLAN.md states the ECharts pattern precisely (no shared wrapper component exists) with the extra series registrations, routes category colours through LOSS_FACTOR into the existing LOSS_COLORS, names nav.tsx as the real nav location, surfaces the apps/web→apps/worker import problem with both resolutions costed, and carries the web conventions plus N/A-never-0. Three task blocks intact; diff is pure insertion.</done>
</task>

<task type="auto">
  <name>Task 4: Preservation and scope audit</name>
  <files>.planning/phases/04-difot-pareto-dds/04-01-PLAN.md, .planning/phases/04-difot-pareto-dds/04-02-PLAN.md, .planning/phases/04-difot-pareto-dds/04-03-PLAN.md</files>
  <action>
    Confirm the three patches were additive and stayed inside their blast radius. Repair with a further scoped Edit if anything below fails.

    - Preservation: each of these load-bearing strings still appears exactly once in its file. They encode reasoning that must not be lost to a rewrite.
      04-01: `dimensionally wrong` (the no-ICT-factor projection argument), `a documented planning heuristic, not a claim` (the honesty guard on profileOeeEstimate), `no second cursor exists` (the replay-ordering guarantee).
      04-02: `no join needed` (the verified-correct `loss_event.injected` claim), `arithmetically coherent` (the losses-vs-shortfall reconciliation), `honesty backbone` (the causality-test rationale).
      04-03: `NEVER an average of line ratios` (the plant-OEE aggregation rule), `inspired-by wording only` (the §8 no-IWS/P&G guardrail), `always resolves` (the two-level action-template requirement).
    - Structure: three task blocks in each file, nine total, names unchanged.
    - Deliberate omissions — confirm these were NOT written into any plan, because they were checked and found inapplicable: inject rate limiting (WINDOWS entry 5) touches `apps/web/src/app/api/control/inject/route.ts`, which no Phase-04 plan modifies and no Phase-04 task adds a demo control to; a bare "add pino" instruction, since pino is absent from `apps/web` by ledgered decision. If either appears, remove it — a false or irrelevant note in a plan is worse than no note.
    - Deliberate preservation — confirm these existing claims were left untouched because they were verified CORRECT: 04-02 Task 2's `loss_event.injected` / "no join needed" clause, and the `useLive` reference at 04-01 Task 3.
    - Scope: nothing changed under `apps/`, `packages/`, `docker/`, `prisma/` or `docs/` — neither in the working tree nor in commits since the pre-task base ref — and no `.planning/` file outside the three Phase-04 plans and this quick task's own directory was modified.
    - Record the three `git diff --numstat 37dc3b4 -- <file>` lines in the SUMMARY so the additions-to-deletions ratio is on the record.
  </action>
  <verify>
    <automated>d=.planning/phases/04-difot-pareto-dds; ok=1; for s in "dimensionally wrong" "a documented planning heuristic, not a claim" "no second cursor exists"; do [ "$(grep -c "$s" $d/04-01-PLAN.md)" -eq 1 ] || { echo "LOST/DUPED 04-01: $s"; ok=0; }; done; for s in "no join needed" "arithmetically coherent" "honesty backbone"; do [ "$(grep -c "$s" $d/04-02-PLAN.md)" -eq 1 ] || { echo "LOST/DUPED 04-02: $s"; ok=0; }; done; for s in "NEVER an average of line ratios" "inspired-by wording only" "always resolves"; do [ "$(grep -c "$s" $d/04-03-PLAN.md)" -eq 1 ] || { echo "LOST/DUPED 04-03: $s"; ok=0; }; done; [ "$(cat $d/04-0[123]-PLAN.md | grep -c '^  <[n]ame>Task')" -eq 9 ] || { echo "TASK COUNT"; ok=0; }; [ -z "$(git status --porcelain -- apps packages docker docs)" ] || { echo "DIRTY SOURCE TREE"; ok=0; }; [ -z "$(git diff --name-only 37dc3b4..HEAD -- apps packages docker docs)" ] || { echo "SOURCE COMMITTED"; ok=0; }; [ "$ok" = 1 ] && echo PASS</automated>
  </verify>
  <done>All nine load-bearing strings survive exactly once, nine task blocks intact across the three files, the two verified-correct existing claims are untouched, the two inapplicable notes are absent, and the diff touches only the three Phase-04 plans plus this quick task's own directory.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| planner/executor → `.planning/phases/04-*` artifacts | These three documents are the sole instruction source for a later Sonnet executor; a lossy edit degrades Phase 4 with no runtime error to catch it. |
| this quick task → the application source tree | The task must not cross into `apps/`, `packages/`, `docker/` or `docs/`; the delta text only DESCRIBES future Phase-4 work. |
| task brief → plan text | The brief's delta list is a hypothesis, not evidence. Anything transcribed without repo verification becomes a false instruction with the authority of a plan. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-Q260822V-01 | Tampering | the three `04-0*-PLAN.md` files | medium | mitigate | Edit-only (whole-file Write forbidden in every action), Task 4 preservation greps on nine load-bearing strings, and a per-file `git diff --numstat` deletion ceiling (0 for 04-02/04-03, ≤1 for 04-01's single rewritten frontmatter line) |
| T-Q260822V-02 | Tampering | `apps/**`, `packages/**`, `docker/**`, `docs/**` | medium | mitigate | Task 4 scope gate asserts empty `git status --porcelain` AND empty `git diff --name-only 37dc3b4..HEAD` for those trees |
| T-Q260822V-03 | Spoofing (false authority) | plan text asserting unverified facts | high | mitigate | The `<evidence>` block pins every claim to a file path, line number, or Context7 lookup performed at planning time; Task 4 explicitly removes the two notes that were checked and found inapplicable (WINDOWS entry 5, "add pino") |
| T-Q260822V-04 | Repudiation | other `.planning/` documents (STATE.md, ROADMAP.md, Phase-03 artifacts) | low | mitigate | Task 4 asserts no `.planning/` file outside the three plans and this quick task's directory was modified; STATE.md's quick-task row is written by the orchestrator, not by these tasks |
| T-Q260822V-SC | Tampering | npm/pip/cargo installs | low | accept | No package install runs in this task. Every package named in the patch text (`echarts@6.1.0`, `@linelens/contracts`, `@linelens/db`, `pg`) is already installed in this monorepo at pinned versions; no new supply-chain surface is introduced. |
</threat_model>

<verification>
- All four task automated gates print PASS.
- `git diff 37dc3b4 -- .planning/phases/04-difot-pareto-dds/` reviewed by eye: every hunk is an insertion except the one rewritten `files_modified` line in 04-01, and no hunk is a line-ending-only change.
- No application source, schema, migration, or config file appears anywhere in this task's diff.
- Spot-check for accuracy, not just presence: the `0 / 42,768` figure in 04-02 matches `.planning/phases/02-oee-engine/02-VERIFICATION.md:80`, and the nav file path in 04-01/04-03 matches where `NAV_ITEMS` actually lives.
</verification>

<success_criteria>
Phase 4's executor, reading only the three PLAN.md files:

1. Learns before building the loss-card link that `loss_event.stateIntervalId` contains no data, sees the live 0/42,768 evidence, and is handed both mechanisms with their real costs — including the fact that Option B does not remove the need for Option A — and makes the call itself.
2. Writes every new view into `packages/db/src/views.sql` with a byte-identical new migration, and every sim-now comparison as `(sim_now() AT TIME ZONE 'UTC')`, at all four sites where the plans use sim-now.
3. Reaches Prisma through the `lib/db.ts` singleton, binds raw-pg sim-time params as ISO 'Z' strings, reuses `useLive` rather than writing a second SSE client, edits `components/ui/nav.tsx` rather than hunting for a nav in `layout.tsx`, knows `/api/andon` now returns `machines[]`, and renders `null` as "N/A" rather than `0`.
4. Is not surprised by a blank timeline while testing, does not opportunistically fix the ledgered shiftDate-rollover bug, and does not chase the 15 pre-existing `apps/worker` typecheck errors.
5. Discovers the `apps/web` → `apps/worker` import problem in 04-03 at planning-read time rather than at build time.

Every formula, hand-computed value and rationale the three plans already encoded is still there, and nothing outside those three files changed.
</success_criteria>

<output>
Write `.planning/quick/260822-vuv-patch-the-three-phase-04-plans-with-phas/SUMMARY.md`, including the three `git diff --numstat` lines and the record of which notes were deliberately omitted as inapplicable.
</output>
