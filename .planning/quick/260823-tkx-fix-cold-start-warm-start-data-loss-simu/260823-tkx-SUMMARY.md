---
quick_id: 260823-tkx
slug: fix-cold-start-warm-start-data-loss-simu
date: 2026-08-23
mode: quick
status: complete
windows_ref: 15
windows_resolved: [15]
commit: 0227886
files_modified:
  - apps/simulator/src/main.ts
  - apps/simulator/src/control.ts
  - apps/worker/src/ingest.ts
  - apps/worker/src/main.ts
---

# Quick Task 260823-tkx — Summary

## What was wrong

A clean `docker compose down -v && docker compose up` silently discarded the
entire warm-start sim-day. The simulator published `2026-01-05T06:55Z` →
`2026-01-06T06:55Z` as a ~1.5 s burst at boot; the worker subscribed ~16 s
later with `sessionPresent: false`. MQTT `clean:false` + QoS 1 only replays
into a session that already exists, so the backlog was published to nobody.

Structural, not a flaky race: `worker.depends_on.simulator: service_healthy`
guarantees the worker starts last.

Discovered while closing the Phase-04 UAT item — smoke test 10 failed its
fixture invariant (`line L1 must have losses on 2026-01-05`) on the first
genuinely clean stack anyone had run since the invariant was written. The
invariant had only ever been observed on *restarted* stacks, where the worker's
MQTT session already existed.

## What changed

A readiness handshake between worker and simulator.

**`apps/simulator/src/main.ts`**
- `createControlServer(...)` now runs **before** the warm-start burst. compose
  gates the worker on this service's healthcheck, so the endpoint has to be
  answering before we can wait on the worker — otherwise the two deadlock.
- The clock starts **paused** at go-live (`startedAtRealMs === pausedAtRealMs`
  ⇒ `simNow()` is pinned to `GO_LIVE`), so waiting cannot advance sim time past
  a backlog that has not been published yet. The live clock is installed only
  after the burst completes.
- The burst waits on a one-shot gate, with `INGESTOR_READY_TIMEOUT_MS`
  (default 120 000) as a loud, non-fatal backstop.

**`apps/simulator/src/control.ts`**
- New `POST /control/ingestor-ready`, idempotent by design — the worker
  re-signals on every MQTT reconnect, and a worker restart long after go-live
  must be a no-op rather than a second warm-start.
- `/healthz` now also reports `ingestorReady` / `warmStartComplete`, because
  "healthy" no longer implies "backlog published".

**`apps/worker/src/ingest.ts`**
- New optional `onSubscribed` hook, fired only after the **broker confirms**
  the subscription. Firing on `connect` would still race the burst.

**`apps/worker/src/main.ts`**
- `signalIngestorReady()` POSTs to the simulator with 5 bounded retries.
  Never fatal — the simulator's timeout is the backstop and ingestion must
  continue even if the control endpoint is unreachable.

## Verification (all live, clean volume)

| Must-have | Result |
|---|---|
| Clean `docker compose up` ingests the warm-start day | ✅ earliest `machine_event.simTime` = `2026-01-05 07:00` (was `2026-01-06 07:00`); 64 126 events |
| Handshake ordering | ✅ sim `waiting for ingestor` 14:25:45.862 → worker `mqtt subscribed` 14:25:58.882 → `ingestor-ready signalled` 14:25:58.887 → sim releases burst (`waitedMs: 13026`) |
| Losses on the warm-start day | ✅ all four lines (`L1..L4`) return Pareto rows for `2026-01-05` |
| DDS "yesterday" populated on first run | ✅ OEE 65.75 %, quality 97.35 %, top loss L4 `BRK-MECH` 43.7 min, 3 actions |
| Smoke suite | ✅ 10 passed / 1 skipped — **test 10 (losses pareto) green** |
| Worker-only restart is a no-op | ✅ reconnects `sessionPresent: true`, re-signals, sim logs `ingestor-ready received` with `warmStartComplete: true`; no second warm-start, no hang |
| Simulator alone still starts | ✅ isolated run, `INGESTOR_READY_TIMEOUT_MS=5000`: waited exactly 5000 ms, `warn`-level message, then warm-started |
| Typecheck | ✅ `apps/simulator`, `apps/web`, `packages/db` clean; `apps/worker` shows only the 15 pre-existing implicit-`any` errors tracked as WINDOWS entry 2 |

`GET /api/dds` Delivery stays `null` on `2026-01-05` — correct, not a
regression: no orders are due on the warm-start day (due dates start
`2026-01-07`). That is the honest N/A path fixed under WINDOWS entry 11.

## Notes

- Smoke test 9 ("drill-down money shot") still skips on a young stack — it
  needs a `LATE`/`AT_RISK` order, which only exists once sim time passes a due
  date. It was separately observed **passing** earlier the same day, closing
  WINDOWS entry 13.
- WINDOWS entry 14 (restart puts data *ahead* of the clock) is untouched and
  remains open — this task fixed its mirror image, not entry 14 itself.
