---
quick_id: 260823-uib
slug: fix-demo-blockers-before-phase-5-oee-tim
date: 2026-08-23
mode: quick
windows_ref: [3, 4, 14]
status: complete
---

# Quick Task 260823-uib — Clear the Phase-5 demo blockers

Phase 5 (Distribution) is graded on "a stranger clones the repo, runs
`docker compose up`, and it works" plus "a 60-second deterministic GIF". Three
open windows attack exactly that, so they get cleared before Phase 5 planning.

## Blocker A — WINDOWS 3 + 4: the dashboard lands on an empty shift

`/api/andon` resolves only the *currently active* shift. Shifts are S1
07:00–15:00 and S2 15:00–23:00, so sim 23:00–07:00 — **8 of every 24 sim-hours,
a third of the time** — has no active shift. Both `oee/page.tsx` and
`timeline/page.tsx` then fall back to "sim today + S1", which has zero
production, and the whole page renders N/A.

The N/A itself is correct (project rule: N/A, never a false 0). The defect is
*landing there by default* — a stranger's first screenshot is blank a third of
the time.

Second, un-deferred half (entry 4): `shiftDate` is seeded once via
`setShiftDate(prev => prev || …)` and never follows a sim-day rollover, so a
long-open dashboard silently shows a stale date.

### Task A1 — `/api/andon`: expose a per-line last-shift-with-data fallback

**File:** `apps/web/src/app/api/andon/route.ts`

Add `lastShiftDate` / `lastShiftId` to **each line element** — the shift window
containing that line's most recent `state_interval`. Per-line (not one global
value) because the OEE page is per-line; appended fields (not a new top-level
object) so the array response shape stays unchanged and no consumer or smoke
test breaks.

```sql
WITH last_activity AS (
  SELECT "lineId", max("startTime") AS ts FROM state_interval GROUP BY "lineId"
)
SELECT la."lineId", w."shiftDate", w."shiftId"
FROM last_activity la
JOIN v_shift_windows w ON la.ts >= w."shiftStart" AND la.ts < w."shiftEnd"
```

Intervals falling outside every shift window naturally drop out of the join, so
between-shift BREAK time can never be offered as a default.

**Verify:** during a between-shift sim window, `/api/andon` returns
`shiftId: null` **and** a non-null `lastShiftId`.

### Task A2 — Pages: default to the last shift with data, and follow rollover

**Files:** `apps/web/src/app/(dashboard)/oee/page.tsx`,
`apps/web/src/app/(dashboard)/timeline/page.tsx`

- Default precedence: currently-active shift → that line's
  `lastShiftDate`/`lastShiftId` → existing sim-today+S1 fallback.
- Re-run the andon-default effect when the sim **day** changes, so an
  untouched dashboard follows the rollover instead of pinning a stale date.
- Introduce an explicit "pinned" flag: once the user picks a line/shift, stop
  auto-following. On `timeline`, the URL deep-link counts as pinned from the
  first render.

**MUST NOT REGRESS — CR-01.** `timeline/page.tsx` already tracks URL provenance
in `shiftIdFromUrl` because `shiftId`'s default (`"S1"`) collides with its own
unset sentinel. A deep link must still win over the andon effect; smoke test 9
(`expect(shiftSelect).toHaveValue(linkedShiftId)`) is the guard.

**Verify:** during a between-shift window the OEE page shows a populated
waterfall for the last worked shift, not N/A; a deep-linked timeline URL still
lands on its own shift.

## Blocker B — WINDOWS 14: restart desyncs the clock from history

The simulator warm-starts from `WARM_START_DAY` on **every** container start,
while the Postgres volume keeps events from prior runs that reached later sim
times. Observed: `machine_event` max simTime `2026-01-11 12:17` versus
`sim_now()` `2026-01-10 16:34` — ~20 sim-hours of data sitting in the *future*
relative to the clock. `/api/andon` then reports every machine `BREAK` with a
future `since`, and `POST /control/inject-breakdown` 404s with "no injectable
machine found" because nothing is in `EXECUTE` — which kills the
inject-breakdown demo, i.e. the GIF.

### Task B1 — Resume the clock from history instead of blind warm-start

**Files:** `apps/worker/src/main.ts`, `apps/simulator/src/control.ts`,
`apps/simulator/src/main.ts`

Extend the readiness handshake added in `260823-tkx` — the worker already
speaks to the simulator at exactly the right moment, before any event is
published.

- Worker: before signalling, `SELECT max("simTime") FROM machine_event`, and
  send it as `{ maxSimTimeMs }` in the `POST /control/ingestor-ready` body.
- Simulator: if `maxSimTimeMs > GO_LIVE`, **resume** instead of warm-starting —
  fast-forward the plant to that instant with publishing **muted**, then start
  the live clock there. Muting is what prevents republishing a span the DB
  already holds.
- Determinism note: the muted replay is the same seed over the same span as the
  previous process, so it reconstructs the same plant state. Injected
  breakdowns from the prior run are *not* replayed — an acceptable, documented
  divergence.
- Otherwise (empty DB, or history ≤ go-live) behave exactly as today.

**Verify:** `docker compose restart` (volume intact) → `sim_now()` lands at or
after `max(machine_event.simTime)`, no machine shows a future `since`, and
`POST /control/inject-breakdown` succeeds instead of 404ing.

### Task B2 — Live verification

- Cold start on a clean volume still works (must not regress `260823-tkx`).
- Restart with volume intact: clock resumes, inject works.
- `pnpm test:smoke` green.

## Must-haves

- truths:
  - The dashboard defaults to a shift that has data, at any sim hour.
  - An untouched dashboard follows a sim-day rollover.
  - A timeline deep link still overrides the andon default (CR-01).
  - Restarting the stack leaves the clock at/after the newest stored event.
  - `inject-breakdown` works after a restart.
  - A clean cold start still ingests the warm-start day.
