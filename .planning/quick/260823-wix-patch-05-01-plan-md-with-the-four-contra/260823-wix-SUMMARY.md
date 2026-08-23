---
quick_id: 260823-wix
slug: patch-05-01-plan-md-with-the-four-contra
date: 2026-08-23
mode: quick
status: complete
files_modified:
  - .planning/phases/05-distribution/05-01-PLAN.md
---

# Quick Task 260823-wix — Summary

`05-01-PLAN.md` patched in place; `05-02-PLAN.md` left untouched. No replan.

## What was added

A `<contract_deltas>` block immediately after `<objective>`, then four targeted
edits to the task actions it affects.

**Delta 1 — `/healthz` 200 no longer means the plant is live.** Both `smoke.sh`
and `demo-scenario.ts` now have to poll for `warmStartComplete: true`. This is
the delta most likely to have bitten silently: the executor would have written a
perfectly reasonable "wait for healthy, then check data" loop and seen
intermittent empty results with no obvious cause.

**Delta 2 — the plant is idle for a third of every sim-day.** Backed by a
measurement rather than an assertion: `machine_event` holds **0 rows of any
kind** between sim 23:30 and 06:30, against 11,812 COUNTS in a single daytime
hour. `inject-breakdown` 404s there.

**Delta 3 — a restart no longer rewinds the clock.** Worth stating explicitly
because it inverts the old workaround. Before `260823-uib`, restarting reset the
simulator to go-live; now it resumes from stored history, so `down -v` is the
only way back — which `pnpm demo` needs regardless, since a scripted demo that
starts from whatever the last take left behind is not deterministic.

**Delta 4 — `README.md` already exists.** Task 2 reframed from write to extend,
with all eight README structure items annotated `[HAVE]`, `[PARTIAL]` or
`[MISSING]` so nothing already written gets redone and nothing missing gets
assumed done. LICENSE is still absent and still Task 2's job.

## The smoke.sh trap worth calling out

The plan asked `smoke.sh` to prove liveness by sampling `machine_event` count
twice and requiring growth. A clean clone boots at go-live `06:55` and S1 opens
at `07:00` — at `SIM_SPEED=60` that is roughly **5 real seconds**. Both samples
can therefore land in the pre-shift gap and report a flat count on a completely
healthy stack, failing the one script whose entire job is to prove to a stranger
that the thing works. The patch requires waiting for a non-null `shiftId` from
`/api/andon` (or the first COUNTS row) before sampling.

## Free win recorded

Task 3's GIF recording is precisely the live observation WINDOWS entries 8 and 9
are still waiting on — inject on a line, and within ~1 sim-day that line's
orders go LATE with the injected breakdown top-ranked in the drill-down. The
patch tells the executor to capture that evidence during the recording and close
both entries in the SUMMARY, instead of paying separately for a 24-real-minute
observation.

## Not changed

`05-02-PLAN.md` — case study, LinkedIn post, application attach. All human-gated
publishing work; nothing it depends on moved. Its instruction to read the porto
deploy-mechanism memory before touching that repo still stands.
