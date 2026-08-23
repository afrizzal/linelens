# LineLens

**A real-time OEE dashboard driven by a built-in factory simulator — and a drill-down that turns machine downtime into the customer orders it broke.**

One `docker compose up` starts a living virtual plant. Four production lines stream machine events over MQTT, an ingestion worker derives state intervals and losses into Postgres, and a Next.js dashboard shows OEE, an andon board, a production timeline, a Six Big Losses Pareto, an order book with DIFOT, and a Daily Direction Setting board — all updating live.

The signature move: start from a late customer order, click the loss that caused it, and land on the exact machine-level downtime band in the timeline.

> **This is a simulated build.** Every number comes from a seeded synthetic plant (`plant.config.json`, seed 42). There is no real factory data here, no employer data, and no claim that these figures describe any actual production line. The OEE *mechanics* are held to verified industry definitions (see [`docs/00-domain-research.md`](docs/00-domain-research.md)); the *data* is clean-room.

---

## Quick start

Requires Docker and Docker Compose. Nothing else — Node, pnpm, Postgres and Mosquitto all live inside the stack.

```bash
cp .env.example .env
docker compose up -d --wait
```

Then open **http://localhost:3000**.

The stack publishes ports `3000` (dashboard), `4000` (simulator control API), `5432` (Postgres) and `1883` (MQTT). Stop it with `docker compose down`, or `docker compose down -v` to also discard the simulated history and start the plant fresh.

### What you are looking at

The simulator boots by replaying one complete sim-day (`2026-01-05`) so that "yesterday" already exists when you arrive, then runs forward at **60x** — one sim-day passes every 24 real minutes. Change the pace with `SIM_SPEED` in `.env`.

| Screen | What it answers |
|---|---|
| **Andon** (`/andon`) | What is every line doing *right now*? State, good count, target count, per-machine dots. |
| **OEE** (`/oee`) | Where did the time go? Availability × Performance × Quality as a waterfall, per line and shift. |
| **Timeline** (`/timeline`) | What actually happened, minute by minute? A color-coded Gantt of machine states over sim-time. |
| **Orders** (`/orders`) | Are we keeping our promises? The order book with DIFOT %, and per-order status. |
| **Losses** (`/losses`) | What is costing us most? Six Big Losses ranked by lost time, with a cumulative-% line. |
| **DDS** (`/dds`) | What do we do about it today? Yesterday's safety / quality / delivery / OEE summary, top loss, and generated actions. |

### The 60-second demo

1. Open **Andon** and watch the tiles change state.
2. Hit **Inject breakdown** on a line. The tile goes red immediately.
3. Open **OEE** for that line — Availability drops, and the waterfall shows where.
4. Open **Losses** — the breakdown climbs the Pareto.
5. Open **Orders**, find a `LATE` or `AT_RISK` order, and click its top-ranked loss.
6. You land on **Timeline**, on the right line and shift, with the guilty band highlighted.

That last step is the whole point: *machine downtime = broken customer promises*, shown rather than asserted.

---

## How it works

```
 simulator ──MQTT (QoS 1)──▶ Mosquitto ──▶ worker ──▶ Postgres
     │   spBv1.0/LineLens/DDATA/{line}/{machine}         │
     │   seeded state machine, 60x clock                 │   raw events → state intervals
     │                                                   │   → loss events → OEE / DIFOT
     │                                                   │
     └──── control API :4000 ◀── web :3000 ◀──SSE────────┘
                inject-breakdown          Postgres LISTEN/NOTIFY
```

- **`apps/simulator`** — a seeded, hand-rolled state machine per machine (EXECUTE / DOWN / CHANGEOVER / BREAK), publishing PackTags-lite JSON on a Sparkplug-B-style topic. Also serves the control API behind the demo's inject-breakdown button.
- **`apps/worker`** — the *sole* MQTT consumer and the *sole* writer to Postgres. Persists raw events losslessly, then derives state intervals, classified loss events, order allocation and shipping.
- **`apps/web`** — Next.js App Router. Route handlers query Postgres for history; live updates arrive over SSE, fanned out from the worker via Postgres `LISTEN/NOTIFY`.
- **`packages/contracts`** — zod schemas shared by all three, so an MQTT payload is validated at the boundary rather than trusted.
- **`packages/db`** — Prisma schema, migrations, and the SQL views (`v_shift_windows`, `v_order_status`, `v_difot`, `order_loss_drilldown`) that do the analytical heavy lifting.

### Startup ordering

The simulator publishes its warm-start day as a burst, so it **waits for the worker to confirm its MQTT subscription** before releasing it — otherwise that entire day would be published to nobody, because `clean:false` + QoS 1 only replays into a session that already exists. On a restart against a surviving volume it goes further and *resumes* the clock from the newest stored event rather than warm-starting over history it already holds.

---

## Credibility notes

The point of a portfolio build in this domain is that a factory person watching it must not spot a classification error. Choices made deliberately:

- **OEE is A × P × Q** (the preferred definition), aggregated per line and shift, with **Performance > 100% flagged** as a misconfigured Ideal Cycle Time rather than silently clamped.
- **Losses are classified the industry way**: small stops count against Performance, changeover against Availability (Setup & Adjustments), with a configurable "changeover as planned" policy and a planned-to-unplanned transition on overage.
- **`N/A`, never a false `0`.** If no shift is running, or no orders are due that day, the tile says N/A. A zero would be a lie, and a plant manager would notice.
- **Availability uses Planned Production Time** per shift, not wall-clock.

Definitions are traced to sources in [`docs/00-domain-research.md`](docs/00-domain-research.md); §8 of that document lists the anti-patterns this build refuses.

---

## Tech stack

TypeScript end to end: Node 24, Next.js 16 (App Router), PostgreSQL 18, Eclipse Mosquitto 2.0.22, Prisma 7 with the `pg` driver adapter, MQTT.js 5, Apache ECharts 6, Tailwind 4, zod 4, pino. Tested with Vitest 4 and Playwright.

Deliberately *not* used: WebSockets (SSE is enough for one-way fan-out), TimescaleDB (native Postgres suffices at demo scale), full Sparkplug B protobuf, and the complete 17-state PackML machine — each adds surface without adding demo value. The reasoning is recorded in `CLAUDE.md`.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test          # unit + integration (Vitest; testcontainers spins up Postgres)
pnpm test:smoke    # Playwright, against a stack that is already running
pnpm smoke         # brings the stack up first, then runs the smoke suite
```

The OEE engine is the credibility centerpiece, so it is tested hardest: hand-computed golden scenarios to 4 decimal places, an acceleration-invariance test proving OEE is identical at 1x and 60x, a `SET TimeZone='Asia/Jakarta'` regression pinning the sim-time SQL contract, and a causality test that proves the drill-down's claim against the real pipeline with nothing mocked.

## Project status

Phases 1–4 are complete: the simulator and plant, the OEE engine, the live dashboard, and the DIFOT / Pareto / DDS screens. Phase 5 (distribution — public repo, hero GIF, case study) is still open, which is why this README carries no demo GIF yet.

Rough edges are tracked openly in [`.planning/WINDOWS.md`](.planning/WINDOWS.md) rather than quietly. Two are worth knowing before you run it:

- **`pnpm smoke` fails during the simulated night.** Shifts run 07:00–15:00 and 15:00–23:00, so for sim 23:00–07:00 — 8 of every 24 real minutes — nothing is producing, and two compose-stack tests that need a running machine will fail. Check `/api/sim-clock` and re-run once a shift is active.
- **The drill-down smoke test skips on a young stack.** It needs a genuinely late order, which only exists once sim time passes a due date (due dates start `2026-01-07`). It skips loudly rather than passing hollow.
