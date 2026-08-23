---
quick_id: 260823-uib
slug: fix-demo-blockers-before-phase-5-oee-tim
date: 2026-08-23
mode: quick
status: complete
windows_resolved: [3, 4, 14]
windows_opened: [16]
commits: [4e03a3c, 46065a7]
files_modified:
  - apps/web/src/app/api/andon/route.ts
  - apps/web/src/app/(dashboard)/oee/page.tsx
  - apps/web/src/app/(dashboard)/timeline/page.tsx
  - apps/simulator/src/main.ts
  - apps/simulator/src/control.ts
  - apps/worker/src/main.ts
  - tests/smoke/dashboard-defaults.spec.ts
---

# Quick Task 260823-uib — Summary

Cleared the two demo blockers standing between Phase 4 and Phase 5.

## Blocker A — WINDOWS 3 + 4 (fixed)

`/api/andon` resolved only the *currently active* shift, and shifts cover only
07:00-23:00. For sim 23:00-07:00 — a third of every sim-day — both dashboards
fell back to "sim today + S1", which has zero production, so the page rendered
all N/A. Separately, `shiftDate` was seeded once and never followed a sim-day
rollover.

`/api/andon` now carries `lastShiftDate`/`lastShiftId` per line (appended
fields — array shape unchanged, no consumer broken), and both pages resolve
active shift → that line's last shift with data → the old fallback, re-running
on sim-day change, with a `shiftPinned` ref that stops auto-following once the
user picks a shift. A deep link pins from first render, preserving CR-01.

**A wrong first attempt, caught by the new test.** The initial query took
`max(startTime)` per line and joined it to its containing shift window. At sim
23:39 the newest interval on every line is the BREAK that *starts* at 23:00 —
outside every shift window — so the join dropped it and the fallback came back
`null` in exactly the between-shift case it exists to serve. Corrected to
`DISTINCT ON` over the joined set. The trap is recorded in the route comment.

## Blocker B — WINDOWS 14 (fixed)

The simulator warm-started from `WARM_START_DAY` on every start while the
volume kept later events, leaving the clock *behind its own data* — every
machine reading BREAK with a future `since`, and `inject-breakdown` 404ing
because nothing was in EXECUTE.

Extended the `260823-tkx` handshake: the worker sends `maxSimTimeMs`, and if
that is past go-live the simulator **resumes** — fast-forwards the plant there
with publishing muted — instead of warm-starting over history it already holds.
Deterministic (same seed, same span); breakdowns injected during the prior run
are not replayed, which is documented in the code.

## Verification (all live)

| Must-have | Result |
|---|---|
| Dashboard defaults to a shift with data at any sim hour | PASS — at sim **05:02**, inside the window that used to render blank, `/oee` defaulted to `2026-01-07/S2` and rendered **zero** "N/A" strings |
| `/api/andon` fallback non-null between shifts | PASS — at sim 02:26 (no active shift): `shiftId: null`, `lastShift: 2026-01-07/S2` on all four lines |
| Untouched dashboard follows sim-day rollover | PASS — andon effect re-keyed on sim day; the fallback advanced S1 to S2 as the sim crossed 15:00 |
| Timeline deep link still overrides the default (CR-01) | PASS — new spec test 3, plus smoke test 12 green |
| Restart leaves the clock at/after the newest stored event | PASS — resumed to `2026-01-07T13:46:32` (1.2 s muted catch-up); clock-vs-data gap went from ~20 sim-hours to ~36 sim-seconds |
| `inject-breakdown` works after a restart | PASS — `POST /control/inject-breakdown {lineId:"L2"}` returned `L2-M1`, no 404 |
| Clean cold start still ingests the warm-start day | PASS — empty DB took the warm-start path (not resume); earliest event `2026-01-05 07:00`, 65,494 events; Pareto rows on all four lines; DDS `2026-01-05` OEE 65.75%, quality 97.35%, 3 actions — matching the previous clean run to 13 decimal places, so seed-42 determinism is intact |
| Full smoke suite | PASS — **14 passed, 0 skipped** (with a shift active) |
| Typecheck | PASS — web + simulator clean; worker unchanged at the 15 pre-existing errors of WINDOWS 2 |

## New window opened — 16

The full suite at sim ~05:00 failed 2 tests; the identical suite at sim 07:22
passed 5/5 with no code change in between. Cause: during the no-shift window
nothing is in EXECUTE, so `inject-breakdown` 404s and telemetry is sparse.

Same two tests as WINDOWS 12, **different cause** — 12 blames an already-down
machine from a prior inject; this needs no prior run at all. It matters for
Phase 5: the README will tell a stranger to run `pnpm smoke`, and it will fail
one time in three with no hint that waiting 8 minutes fixes it. Logged
separately rather than silently folded into 12.

## Ledger after this task

16 total, 7 fixed, 9 open (2, 5, 6, 7, 8, 9, 10, 12, 16).

Entries 8 and 9 — "inject on a line, and within ~1 sim-day that line's orders
go LATE with the injected breakdown top-ranked" — are left open deliberately:
that is the money-shot narrative of the Phase-5 GIF, so Phase 5 closes them as
a by-product rather than paying for the 24-real-minute observation twice.
