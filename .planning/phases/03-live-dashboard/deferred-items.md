# Deferred Items

Out-of-scope discoveries logged during execution, per the executor's SCOPE BOUNDARY rule
("only auto-fix issues DIRECTLY caused by the current task's changes").

## 03-02

- **`apps/worker` pre-existing `tsc --noEmit` failures (not caused by 03-02, not fixed).**
  `pnpm -r run typecheck` fails on `apps/worker` with 15 `TS7006: Parameter '...' implicitly
  has an 'any' type` errors across `src/derive/prisma-store.ts`, `src/derive/runner.ts`, and
  `test/golden.test.ts` (callback params on raw-SQL/`$transaction` results: `s`, `r`, `tx`).
  Confirmed pre-existing via `git stash` (errors persist identically with all 03-02 changes
  reverted) — unrelated to the `@linelens/contracts` Turbopack fix or any 03-02 file. Runtime
  is unaffected: the full monorepo `pnpm vitest run` suite (24 files / 93 tests, including
  `apps/worker`'s testcontainers-based `ingest.integration.test.ts`) passes. Left unfixed per
  the executor's scope boundary — flag for a future phase's typecheck cleanup.

## OEE/timeline page defaults land on an empty shift (deferred 2026-08-22)

**Where:** `apps/web/src/app/(dashboard)/oee/page.tsx:83` (check `timeline/page.tsx` for the same pattern)
**Windows ledger:** entry 3 (`unmet-truth`, open)
**Found:** 03-03 human checkpoint, step 2 of the walkthrough.

Sim runs at 60x. Shifts are S1 07:00-15:00 and S2 15:00-23:00, so sim 23:00-07:00
— **8 of every 24 real minutes** — has no active shift at all.

In that window `/api/andon` reports no active shift, so the page falls back to
"sim today + S1". That shift has zero production, `/api/oee` returns `line: null`,
and the entire page renders N/A.

**The N/A is correct** and must stay: the project rule is N/A, never `0`, because
`0` means "produced nothing" while N/A means "no shift". Verified live — the same
query that showed N/A at sim 00:xx returned OEE 91.3% at sim 10:35.

This is a **demo-credibility** problem, not a correctness defect: a recruiter
watching a 60-second demo has roughly a one-in-three chance of opening the OEE
page on a blank screen.

**Two fixes when picked up:**
1. Default to the most recent shift **that has data**, not "sim today + S1".
2. `setShiftDate((prev) => prev || ...)` seeds once on mount and never follows a
   sim-day rollover — a long-open dashboard silently shows a stale date. Make the
   date track the sim day, and badge the view when it is not the running shift.

Deferred at the checkpoint by explicit user decision — correctness is fine, so it
does not block Phase 3.
