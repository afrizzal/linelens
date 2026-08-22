---
status: complete
quick_task: 260822-f2w
type: execute
files_modified: [.planning/phases/03-live-dashboard/03-01-PLAN.md]
completed: 2026-08-22
---

# Quick Task 260822-f2w: Patch 03-01-PLAN.md with Phase-02 Sim-Time Contract Deltas — Summary

**One-liner:** Inlined both Phase-02→Phase-03 contract deltas (ISO-'Z' raw-pg timestamp binding; `sim_now() AT TIME ZONE 'UTC'` cast rule) directly into 03-01-PLAN.md's Task 1/Task 2 action bodies, plus a runnable grep gate, so Phase 3's Sonnet executor needs no re-derivation from STATE.md.

## What Was Done

LineLens uses all-phase upfront planning: all 14 PLAN.md files were authored 2026-07-23, before Phase 2 executed. Phase 02 produced two contract facts (recorded in STATE.md as the "02-02:" decisions) that `03-01-PLAN.md` did not yet carry:

1. **Delta 1 (silent-corruption class):** raw `pg.Client` parameter binding for naive `timestamp(3)` columns is LOCAL-OS-TZ-dependent (unlike Prisma, which serializes UTC-safely) — must always bind ISO `'Z'`-suffixed strings, never `Date` objects.
2. **Delta 2 (missing dependency):** `apps/web/package.json` declares only next/react/react-dom plus tailwind/types/typescript — it is missing `@linelens/db`, `pg`, and `@types/pg`, which Task 1 (dedicated `pg.Client` for LISTEN) and Task 2 (Prisma client for the read-model routes) both require.

Per the project's standing "later-phase plans assume earlier-phase contracts — UPDATE downstream plans before executing, never improvise" decision, this quick task closed both deltas directly in `03-01-PLAN.md`'s task bodies (not just referenced from STATE.md), following the plan's five scoped Edit operations:

- **(A)** Frontmatter `files_modified`: appended `apps/web/package.json` as the eighth array element.
- **(B)** CONTEXT section: appended two `@path (note)` reference lines pointing at `packages/db/src/views.sql` (the canonical sim-time clamp idiom) and `apps/worker/test/sim-now-timezone.test.ts` (the Phase-02 regression proof pattern).
- **(C)** Task 1 action body: appended a DEPENDENCIES bullet naming the exact three dep specs (copied verbatim from `apps/worker/package.json`: `"@linelens/db": "workspace:*"`, `"pg": "8.22.0"`, devDep `"@types/pg": "8.20.0"`) and a SIM-TIME BINDING RULE bullet.
- **(D)** Task 2 action body: appended a SIM-TIME COMPARISON RULE bullet covering every route (`/api/andon`, `/api/oee`, `/api/timeline`), naming `packages/db/src/views.sql` as the copyable clamp precedent, and defining the `sim-tz-ok` waiver marker for the one legitimate uncast use (`/api/sim-clock`'s scalar `timestamptz` read).
- **(E)** VERIFICATION section: appended a runnable grep gate (`grep -rn "sim_now()" ... | grep -v "AT TIME ZONE 'UTC'" | grep -v "sim-tz-ok:"` prints nothing) plus an eyeball-only note for the ISO-'Z' raw-pg binding discipline (too many legitimate `new Date(` uses to grep cleanly).

Task 2 audited the patch: all five load-bearing strings (the ~2x andon-target-undercount formula, "machines produce IN PARALLEL", "never 0" N/A semantics, "debounce 300ms", "subscriber count returns to 0") survive exactly once each; the three task blocks are unrenamed and unrenumbered; the `sim-tz-ok` waiver marker appears in both the inserted rule and the inserted gate; no file under `apps/`, `packages/`, or `docker/` was touched; `03-02-PLAN.md` and `03-03-PLAN.md` are byte-identical to the pre-task base ref. All checks passed with no repair needed.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' automated verification gates printed `PASS` on the first pass; no Edit required repair.

## Verification Results

**Task 1 gate:**
```
f=.planning/phases/03-live-dashboard/03-01-PLAN.md
grep -q "apps/web/package.json" "$f" && [ "$(grep -c "AT TIME ZONE 'UTC'" "$f")" -ge 2 ] \
  && grep -q "ISO 'Z'" "$f" && grep -q "@types/pg" "$f" && grep -q 'workspace:\*' "$f" \
  && [ "$(grep -cE '^<[t]ask type=' "$f")" -eq 3 ] \
  && [ "$(git diff --numstat cc22ee2 -- "$f" | cut -f2)" -le 2 ] && echo PASS
```
→ `PASS`

**Task 2 gate:** all five load-bearing strings present exactly once; `sim-tz-ok` count = 2; task-name count = 3; `git status --porcelain -- apps packages docker` empty; `git diff --name-only cc22ee2..HEAD -- apps packages docker` empty; `03-02-PLAN.md`/`03-03-PLAN.md` byte-identical to `cc22ee2` → `PASS`.

**CRLF preservation:** verified byte-level — 97 `\r\n` sequences, 0 LF-only line endings after all five Edits (started at 90 `\r\n`, +7 from the 7 newly-inserted lines, all CRLF-terminated).

**Final numstat (per plan's `<output>` requirement):**
```
$ git diff --numstat cc22ee2 -- .planning/phases/03-live-dashboard/03-01-PLAN.md
8	1	.planning/phases/03-live-dashboard/03-01-PLAN.md
```
8 insertions, 1 deletion — the single deletion is the rewritten `files_modified` frontmatter line (edit A); every other change is a pure insertion, matching the plan's deletion-ceiling gate (`<=2`).

**Full diff eyeball (per `<verification>`):** every hunk is an insertion except the one rewritten frontmatter line; no hunk is a line-ending-only change; no application source, schema, or config file appears anywhere in the diff.

## Key Files

- `.planning/phases/03-live-dashboard/03-01-PLAN.md` — patched (the deliverable)

## Commits

- `deff23a` — `docs(03-01): patch Phase-02 sim-time contract deltas into 03-01-PLAN.md`

## Self-Check: PASSED

- FOUND: `.planning/phases/03-live-dashboard/03-01-PLAN.md` contains `apps/web/package.json`, both sim-time rules, `@types/pg`, `workspace:*`, exactly 3 task blocks.
- FOUND: commit `deff23a` in `git log --oneline`.
- Working tree: `.planning/config.json` left untouched (pre-existing whitespace-only diff, not staged/committed by this task) as instructed.
