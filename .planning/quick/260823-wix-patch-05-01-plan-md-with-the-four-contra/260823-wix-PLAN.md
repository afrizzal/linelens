---
quick_id: 260823-wix
slug: patch-05-01-plan-md-with-the-four-contra
date: 2026-08-23
mode: quick
status: complete
targets: [.planning/phases/05-distribution/05-01-PLAN.md]
---

# Quick Task 260823-wix — Patch 05-01 with post-authoring contract deltas

## Why patch rather than replan

Both Phase-5 plans were authored 2026-07-23 as part of the upfront 14-plan pass
and hardened by a 3-reviewer adversarial pass. Their structure is still right:
the task breakdown, the ordering, and the `checkpoint:human-assist` gating on
GIF capture and publishing all hold. What has drifted is a handful of concrete
contracts the plans reference, exactly the situation quick task `260822-vuv`
handled for the Phase-4 plans — patch the deltas, keep the plans.

`05-02-PLAN.md` needs no change: it is human-gated publishing work (case study,
LinkedIn, application) and nothing it depends on moved.

## The four deltas

1. **`/healthz` 200 no longer means the plant is live.** The WINDOWS-15 fix
   (`260823-tkx`) starts the control server *before* the warm-start burst,
   because compose gates the worker on the simulator's healthcheck and the two
   would otherwise deadlock. `docker compose up -d --wait` now returns while the
   warm-start day is still unpublished. `/healthz` gained `warmStartComplete`
   for precisely this; both `smoke.sh` and `demo-scenario.ts` must poll it.

2. **The plant is idle for a third of every sim-day.** Measured 2026-08-23:
   `machine_event` has **0 rows of any kind** between 23:30 and 06:30, against
   11,812 COUNTS in one daytime hour. `inject-breakdown` 404s there. WINDOWS 16.

3. **A restart no longer rewinds the clock.** The WINDOWS-14 fix (`260823-uib`)
   made the simulator resume from stored history. `down -v` is now the only way
   back to go-live — and a scripted demo needs it anyway to be deterministic.

4. **`README.md` already exists** (`260823-vtw`), so Task 2 is extend-and-
   complete, not a from-scratch write.

## Tasks

### Task 1 — Add a `<contract_deltas>` block to 05-01

Placed immediately after `<objective>` so it is read before Task 1, with the
measurement behind each claim.

### Task 2 — Patch the affected task actions

- **Task 1 / `demo-scenario.ts`**: require `down -v` first; wait on
  `warmStartComplete: true`; note that a fresh boot lands at 06:55 with S1 at
  07:00 so the t+30s inject is safe at 120x, but each take must be a fresh
  `pnpm demo`; require a plain-language message if inject ever 404s.
- **Task 1 / `smoke.sh`**: wait on `warmStartComplete`; and do **not** require
  `machine_event` growth across two samples without first confirming a shift is
  open — a clean clone boots at 06:55 and S1 starts at 07:00, only ~5 *real*
  seconds later at 60x, so both samples can land in the gap and report a flat
  count on a perfectly healthy stack.
- **Task 2 / README**: reframe as extend; annotate each of the eight structure
  items `[HAVE]` / `[PARTIAL]` / `[MISSING]`.
- **Task 3 / GIF**: re-takes must be fresh `pnpm demo` runs; and record that
  this session is the live check WINDOWS 8 and 9 are waiting on, so they close
  as a by-product.

## Must-haves

- truths:
  - Every delta carries the measurement that established it, not an assertion.
  - No task is rewritten beyond what the deltas require.
  - 05-02 is left untouched.
