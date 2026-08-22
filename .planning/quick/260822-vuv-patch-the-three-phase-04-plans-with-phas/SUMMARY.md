---
status: complete
quick_task: 260822-vuv
type: execute
files_modified: [.planning/phases/04-difot-pareto-dds/04-01-PLAN.md, .planning/phases/04-difot-pareto-dds/04-02-PLAN.md, .planning/phases/04-difot-pareto-dds/04-03-PLAN.md]
completed: 2026-08-22
---

# Quick Task 260822-vuv: Patch the Three Phase-04 Plans with Phase-02/03 Contract Deltas — Summary

**One-liner:** Inlined the Phase-02 (`stateIntervalId` dead column) and Phase-03 (web conventions, ECharts pattern, nav location, `apps/web`→`apps/worker` import gap) contract deltas directly into all three Phase-04 PLAN.md task bodies — including a costed, deliberately-undecided Option A/B deep-link mechanism and a Next.js `useSearchParams()`/`next build` trap the docker demo would not have caught — so Phase 4's Sonnet executor needs no re-derivation from STATE.md/WINDOWS.md.

## What Was Done

LineLens authored all 14 PLAN.md files in one pass on 2026-07-23, before any phase executed. Per the project's standing "later-phase plans assume earlier-phase contracts — UPDATE downstream plans before executing, never improvise" decision, this quick task closed the accumulated Phase-02/03 delta surface directly in the three Phase-04 plans' task bodies (not just referenced from STATE.md/WINDOWS.md).

**Task 1 — 04-02-PLAN.md (the load-bearing delta, patched first):**
- Inserted a `<contract_deltas>` block between `<objective>` and `<execution_context>` naming all four deltas up front.
- CONTEXT: added 4 reference lines (`views.sql`, `02-03-SUMMARY.md`, `WINDOWS.md` entries 3/4/6, `timeline/page.tsx`).
- Task 1 action: added the SQL authoring contract (views.sql is the hand-maintained source; migrations are immutable) and the sim-time UTC-cast rule.
- Task 2 action: left the existing `loss_event.injected` / "no join needed" clause untouched (verified correct — E2), then added:
  - DEEP-LINK MECHANISM block with live evidence (`stateIntervalId` declared at `schema.prisma:194`, written nowhere, 0/42,768 non-null rows per `02-VERIFICATION.md:80`) and both Option A (sim-time window) and Option B (populate the column) left undecided, each with real costs stated — including that Option B does NOT remove the need for Option A (rules 3/4/5 losses have no source interval).
  - Implementation note: `timeline/page.tsx` currently reads no search params; documented the `prev ||` seeding guard AND the `useSearchParams()`-needs-Suspense-or-`next build`-fails trap (Context7-verified), flagged specifically because `docker-compose.yml` runs web as `next dev` so this would pass the demo and fail production build.
  - Phase-03 WEB CONVENTIONS block (Prisma singleton, raw-pg ISO-Z binding + CR-01 citation, useLive, console.* logging, N/A-never-0).
  - KNOWN LEDGERED ITEMS block warning that a blank timeline during testing is WINDOWS entries 3/4 (expected, not a new defect) and that the deep-link must explicitly set shiftDate/shiftId rather than rely on the broken default-seeding path.
- VERIFICATION: added the sim-time grep gate, the Option A/B decision-recorded requirement, and the apps/worker typecheck baseline note.

**Task 2 — 04-01-PLAN.md:**
- Frontmatter `files_modified` (the one authorized change): appended `packages/db/src/views.sql` and `apps/web/src/components/ui/nav.tsx`, with the wave-safety re-check recorded inline (04-01 is wave 1; no same-wave overlap with 04-02/04-03 in wave 2).
- CONTEXT: added `views.sql` and `WINDOWS.md` entries 2/3/6.
- Task 2 action: added the SQL authoring contract, both UTC-cast sites (`dueDate` open-late test + `projected_finish` base), and the trailing-60-sim-min window cast note.
- Task 3 action: added the five Phase-03 web conventions (Prisma singleton, raw-pg ISO-Z + CR-01, useLive — confirmed the existing reference was already correct and left it — nav.tsx location, `/api/andon` `machines[]`, console.* logging, `transpilePackages`/workspace-import rule) and N/A-never-0.
- VERIFICATION: added the sim-time grep gate and the worker-typecheck-baseline note.

**Task 3 — 04-03-PLAN.md:**
- CONTEXT: added `waterfall.tsx`, `state-color.ts`, and `WINDOWS.md` entries 2/6.
- Task 1 action: added the CHART WRAPPER PRECISELY block (no shared component exists — the reusable thing is the ~40-line init/setOption/dispose pattern in `waterfall.tsx`; the Pareto needs `LineChart` + `LegendComponent` on top of the waterfall's registration list), the CATEGORY COLOURS block (route the six Six-Big-Loss categories through `LOSS_FACTOR` into the existing `LOSS_COLORS`, which is keyed by OEE factor, not by loss category — do not invent a second palette), the nav.tsx location, and the useLive confirmation.
- Task 2 action: added the WHERE `actions.ts` LIVES block — verified `apps/worker/package.json` has no `exports` field, no build, is not an `apps/web` dependency, and is not in `transpilePackages`, so the plan's literal `apps/web` import of `apps/worker/src/dds/actions.ts` cannot resolve under Turbopack — presented as a costed Option A (move to `apps/web/src/lib/dds-actions.ts`) / Option B (promote to a `@linelens/contracts` subpath) decision, left undecided for the Phase-4 executor, plus the Phase-03 web conventions and N/A-never-0.
- Task 3 action: added the nav.tsx location (same file/edit as Task 1's `/losses` entry) and the N/A-never-0 tile rule.
- VERIFICATION: added the worker-typecheck-baseline note, a conditional sim-time grep gate for any raw SQL added under `apps/web`, and the `actions.ts` placement-decision-recorded requirement.

**Task 4 — Preservation and scope audit:** ran the plan's automated gate. First pass FAILED: the `contract_deltas` block inserted in Task 1 quoted the preserved `loss_event.injected` clause's exact phrase "no join needed" verbatim, duplicating a load-bearing string that the gate requires to appear exactly once. Applied a Rule 1 auto-fix — reworded the reference ("Task 2's existing claim that the column needs no join still holds") to keep the same meaning without repeating the literal string — then re-ran both the Task 1 gate for 04-02 and the full Task 4 gate; both passed.

Spot-checked two of the plan's highest-stakes cited facts directly against the repo rather than trusting the brief: the `0 | 42768` figure matches `02-VERIFICATION.md:80` verbatim, and `NAV_ITEMS` does live in `apps/web/src/components/ui/nav.tsx` (confirmed via grep) — `layout.tsx` only mounts `<Nav />`, as claimed. Also independently re-confirmed E1 (a repo-wide grep for `stateIntervalId` across `*.ts`/`*.sql`/`*.prisma` returns only `schema.prisma` and the one migration file — no writer anywhere).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a self-inflicted string duplication in 04-02-PLAN.md's preservation gate**
- **Found during:** Task 4 (preservation and scope audit)
- **Issue:** Task 1's own instructions specified inserting the literal phrase "Task 2's existing 'no join needed' claim holds" into the new `contract_deltas` block, which duplicates the pre-existing, must-stay-exactly-once clause "... the column exists on the ledger per 02-02 — no join needed" in Task 2's body. Task 4's automated gate (`grep -c "no join needed"` must equal 1) failed with count 2.
- **Fix:** Reworded the `contract_deltas` bullet to convey the identical meaning without repeating the literal preserved substring: "Task 2's existing claim that the column needs no join still holds."
- **Files modified:** `.planning/phases/04-difot-pareto-dds/04-02-PLAN.md`
- **Verification:** Re-ran Task 1's automated gate for 04-02 (still PASS, still 0 deletions vs base) and Task 4's full preservation/scope gate (PASS).
- **Committed in:** `61d4617`

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in the plan's own literal instruction text, not in the target files)
**Impact on plan:** No scope creep; the fix is a wording-only change inside content this task itself just added, and it restores exactly the invariant Task 4 exists to check.

## Issues Encountered

None beyond the deviation above.

## Verification Results

**Precondition:** `git status --porcelain -- apps packages docker` empty and `git rev-parse --short HEAD` = `37dc3b4` at start — matched the pinned base ref, no substitution needed.

**Task 1 gate (04-02-PLAN.md):** checks for `contract_deltas`, `highlightStart`, `OPTION A`, `OPTION B`, `42,768`, `AT TIME ZONE 'UTC'`, `lib/db.ts`, `CR-01`, `use-live.ts`, `WINDOWS entry 4`, `Suspense`, exactly 3 task blocks, and 0 deletions vs base 37dc3b4 → PASS (re-verified after the Task 4 wording fix — still PASS, still 0 deletions).

**Task 2 gate (04-01-PLAN.md):** checks for `packages/db/src/views.sql`, `components/ui/nav.tsx`, `AT TIME ZONE 'UTC'`, `lib/db.ts`, `CR-01`, `machines[]`, `transpilePackages`, `WINDOWS entry 2`, `N/A NEVER 0`, exactly 3 task blocks, and at most 1 deletion vs base → PASS.

**Task 3 gate (04-03-PLAN.md):** checks for `waterfall.tsx`, `LineChart`, `LOSS_FACTOR`, `components/ui/nav.tsx`, `OPTION A`, `OPTION B`, `transpilePackages`, `lib/db.ts`, `CR-01`, `AT TIME ZONE 'UTC'`, `N/A NEVER 0`, exactly 3 task blocks, and 0 deletions vs base → PASS.

**Task 4 gate (preservation + scope audit):** all nine load-bearing strings (04-01: "dimensionally wrong", "a documented planning heuristic, not a claim", "no second cursor exists"; 04-02: "no join needed", "arithmetically coherent", "honesty backbone"; 04-03: "NEVER an average of line ratios", "inspired-by wording only", "always resolves") present exactly once each; 9 task-name headers across the three files; `git status --porcelain -- apps packages docker docs` empty; `git diff --name-only 37dc3b4..HEAD -- apps packages docker docs` empty → PASS (after the Rule 1 wording fix above).

**Deliberate omissions confirmed absent:** a case-insensitive search for "rate limit" across all three files → no matches (WINDOWS entry 5, inject rate limiting, is out of scope — no Phase-04 plan touches `apps/web/src/app/api/control/inject/route.ts`). No "add pino" / "install pino" instruction present anywhere — only informational "pino is not installed" deferral notes (WINDOWS entry 6).

**Deliberate preservation confirmed:** 04-02 Task 2's `loss_event.injected` / "no join needed" clause is byte-identical to the original (verified via the exactly-once grep count above); 04-01 Task 3's "useLive refetch" reference was left untouched and confirmed accurate against `apps/web/src/hooks/use-live.ts`.

**Fact spot-checks (not just presence, accuracy):**
- `0 | 42768` in 04-02 matches `.planning/phases/02-oee-engine/02-VERIFICATION.md:80` verbatim.
- `NAV_ITEMS` genuinely lives in `apps/web/src/components/ui/nav.tsx` (line 14) — confirmed via grep; `layout.tsx` only mounts `<Nav />`.
- Repo-wide grep for `stateIntervalId` across `*.ts`/`*.sql`/`*.prisma` returns exactly `packages/db/prisma/schema.prisma` and the one migration file — matches E1 exactly.

**CRLF preservation:** `file` reports "CRLF line terminators" for all three plan files both before and after every Edit; no LF-only or mixed-EOL warning at any point.

**Eyeball diff review (per plan verification):** `git diff 37dc3b4 -- .planning/phases/04-difot-pareto-dds/` — every hunk across all three files is a pure insertion except the one rewritten `files_modified` line in 04-01; no hunk is a line-ending-only change; no file under `apps/`, `packages/`, `docker/`, or `docs/` appears anywhere in this task's diff.

**Final numstat (per plan's output requirement):**
```
10	1	.planning/phases/04-difot-pareto-dds/04-01-PLAN.md
23	0	.planning/phases/04-difot-pareto-dds/04-02-PLAN.md
18	0	.planning/phases/04-difot-pareto-dds/04-03-PLAN.md
```
51 insertions, 1 deletion total across the three files — the single deletion is the rewritten `files_modified` frontmatter line in 04-01 (the one authorized frontmatter change); every other change is a pure insertion.

## Key Files

- `.planning/phases/04-difot-pareto-dds/04-01-PLAN.md` — patched (SQL authoring contract, both sim-time UTC-cast sites, Phase-03 web conventions, N/A-never-0, `files_modified` +2 entries)
- `.planning/phases/04-difot-pareto-dds/04-02-PLAN.md` — patched (contract_deltas block, dead-column evidence, undecided Option A/B deep-link, Suspense/`next build` trap, Phase-03 web conventions, WINDOWS 3/4 warning)
- `.planning/phases/04-difot-pareto-dds/04-03-PLAN.md` — patched (ECharts pattern precision, LOSS_FACTOR colour routing, nav.tsx location, undecided Option A/B cross-app import, N/A-never-0)

## Commits

- `372b0f2` — `docs(quick-260822-vuv): patch 04-02-PLAN.md with Phase-02/03 contract deltas`
- `7da0bdf` — `docs(quick-260822-vuv): patch 04-01-PLAN.md with SQL authoring contract and web conventions`
- `bb142b1` — `docs(quick-260822-vuv): patch 04-03-PLAN.md with charting precision, nav location, cross-app import`
- `61d4617` — `docs(quick-260822-vuv): fix duplicated 'no join needed' string in 04-02-PLAN.md`

## Self-Check: PASSED

- FOUND: `.planning/phases/04-difot-pareto-dds/04-01-PLAN.md` contains `packages/db/src/views.sql`, `components/ui/nav.tsx`, both UTC-cast sites, `lib/db.ts`, `CR-01`, `machines[]`, `transpilePackages`, `N/A NEVER 0`, exactly 3 task blocks.
- FOUND: `.planning/phases/04-difot-pareto-dds/04-02-PLAN.md` contains `contract_deltas`, `highlightStart`, `OPTION A`, `OPTION B`, `42,768`, `Suspense`, exactly 3 task blocks, "no join needed" exactly once.
- FOUND: `.planning/phases/04-difot-pareto-dds/04-03-PLAN.md` contains `waterfall.tsx`, `LineChart`, `LOSS_FACTOR`, `OPTION A`, `OPTION B`, `transpilePackages`, exactly 3 task blocks.
- FOUND: commits `372b0f2`, `7da0bdf`, `bb142b1`, `61d4617` in `git log --oneline`.
- Working tree: no other file modified; `apps/`, `packages/`, `docker/`, `docs/` untouched throughout.
