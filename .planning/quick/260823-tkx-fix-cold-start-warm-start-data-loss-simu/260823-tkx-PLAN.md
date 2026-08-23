---
quick_id: 260823-tkx
slug: fix-cold-start-warm-start-data-loss-simu
date: 2026-08-23
mode: quick
windows_ref: 15
status: complete
---

# Quick Task 260823-tkx — Cold-start warm-start data loss

## Problem

On a clean `docker compose down -v && docker compose up`, the entire warm-start
sim-day (`SIM_START 2026-01-05T06:55Z` → `GO_LIVE 2026-01-06T06:55Z`) is
published into Mosquitto with no subscriber attached and is lost forever.

Measured 2026-08-23 on a fresh volume:

| Real time | Event |
|-----------|-------|
| 14:03:21.015 | simulator begins warm-start burst |
| 14:03:22.530 | burst complete (~1.5 s for a full sim-day) |
| 14:03:25.487 | worker process starts |
| 14:03:38.748 | worker `mqtt subscribed`, `sessionPresent: false` |

`clean:false` + QoS 1 only replays into a session that already exists. The
worker's session did not exist yet, so nothing was retained.

This is **structural, not intermittent**: `docker-compose.yml`
`worker.depends_on.simulator: condition: service_healthy` guarantees the worker
starts *after* the simulator, and the simulator bursts at boot.

Damage on a clean stack:
- earliest `machine_event.simTime` = `2026-01-06 07:00`
- `/api/losses?day=2026-01-05` → 0 rows on **every** line (fails the fixture
  invariant at `tests/smoke/phase4-screens.spec.ts:351`)
- `GET /api/dds` resolves yesterday = `2026-01-05` with `quality`, `delivery`,
  `oee`, `topLoss` all `null` and 0 actions — the DDS screen's entire premise

Exact mirror of WINDOWS entry 14 (a *restart* puts data ahead of the clock; a
clean *cold start* drops the warm-start day entirely).

## Approach — readiness handshake

Make the simulator withhold its warm-start burst until the ingestion worker has
actually subscribed. Rejected alternatives: inverting `depends_on` (creates a
cycle — the worker already depends on the simulator for `/clock`), MQTT retained
messages (retains only the last message per topic), and having the simulator
write events directly to Postgres (violates worker-owns-ingestion).

Deadlock is avoided by starting the control server **before** the wait: the
simulator reports healthy immediately, so compose releases the worker, which
then signals back.

## Tasks

### Task 1 — Simulator: start control server before warm-start, gate the burst

**Files:** `apps/simulator/src/main.ts`, `apps/simulator/src/control.ts`

- Move `createControlServer(...)` above `plant.advanceAll(GO_LIVE)`.
- Hold the clock **paused at `GO_LIVE`** during the wait
  (`startedAtRealMs === pausedAtRealMs` ⇒ `simNow()` is constant at `GO_LIVE`),
  so sim time cannot drift forward while we wait for the worker.
- Add `POST /control/ingestor-ready` which resolves a one-shot readiness gate.
  Idempotent: once warm-start is done it returns `{ warmStartComplete: true }`
  immediately, so a later worker restart is a harmless no-op.
- `await` the gate with a timeout (`INGESTOR_READY_TIMEOUT_MS`, default 120000).
  On timeout, log loudly at `warn` and proceed anyway — a stranger running the
  simulator alone must still get a working sim.
- After the burst, install the live clock (`startedAtRealMs: Date.now()`,
  `pausedAtRealMs: null`) and only then start the tick interval.
- Extend `/healthz` with `warmStartComplete` / `ingestorReady` for debuggability.

**Verify:** simulator logs `waiting for ingestor` then `ingestor ready` then
`warm-start complete`, in that order, with the worker's `mqtt subscribed`
timestamp *between* the first two.

**Done:** warm-start burst provably happens after the worker subscribes.

### Task 2 — Worker: signal readiness after subscribe

**Files:** `apps/worker/src/ingest.ts`, `apps/worker/src/main.ts`

- Add an optional `onSubscribed` callback to `IngestDeps`, fired after a
  successful `client.subscribe` (including on reconnect — the endpoint is
  idempotent).
- In `main.ts`, POST `${SIMULATOR_URL}/control/ingestor-ready` from that
  callback, with bounded retries and warn-level logging on failure. Never fatal:
  the simulator's timeout is the backstop.

**Verify:** worker logs `ingestor-ready signalled`; simulator logs receipt.

**Done:** the handshake closes end-to-end on a cold `docker compose up`.

### Task 3 — Live verification on a clean volume

**Files:** none (verification only)

- `docker compose down -v && docker compose up -d --wait`
- `/api/losses?day=2026-01-05` returns rows on **every** line
- `GET /api/dds` shows a populated non-null yesterday board
- `volta run --node 24.10.0 -- pnpm test:smoke` → test 10 (losses pareto) passes
- Restart-only-the-worker check: `docker compose restart worker` must not
  re-trigger or hang on warm-start.

**Done:** all four acceptance checks observed live; WINDOWS entry 15 marked
fixed only then.

## Must-haves

- truths:
  - A clean `docker compose up` ingests the full warm-start sim-day.
  - The DDS "yesterday" board is populated on first run.
  - Restarting only the worker neither re-runs nor blocks on warm-start.
  - A simulator with no worker still starts (timeout fallback, logged loudly).
- artifacts:
  - `apps/simulator/src/main.ts`, `apps/simulator/src/control.ts`
  - `apps/worker/src/ingest.ts`, `apps/worker/src/main.ts`
