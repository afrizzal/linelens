# Architecture Research

**Domain:** Real-time OEE / manufacturing analytics dashboard with a built-in MQTT factory telemetry simulator (LineLens)
**Researched:** 2026-07-22
**Confidence:** HIGH on structure (derived from verified `docs/00-domain-research.md` + PROJECT.md constraints); MEDIUM on the two platform mechanics (Next.js SSE streaming, Postgres LISTEN/NOTIFY) which were web-verified because Context7 was unreachable during this session.

> This document designs the **internal** architecture. The external service topology (simulator → Mosquitto → worker → Postgres → Next.js/SSE) is fixed by PROJECT.md. Every OEE mechanic below implements the verified definitions in `docs/00-domain-research.md` — do not re-derive them.

---

## Standard Architecture

### System Overview (service topology — fixed by PROJECT.md)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         DATA PLANE (telemetry)                            │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌────────────┐   spBv1.0/LineLens/#   ┌──────────────┐   writes   ┌────┐ │
│  │ simulator  │ ─────────────────────► │  mosquitto   │ ─────────► │ w  │ │
│  │ (producer) │      JSON payloads     │ (MQTT broker)│  subscribe │ o  │ │
│  └─────┬──────┘                        └──────────────┘            │ r  │ │
│        │ owns SIM CLOCK, stamps event_time (sim time)              │ k  │ │
│        │                                                           │ e  │ │
│        │                          single consumer / single writer │ r  │ │
│        │                                                           └─┬──┘ │
├────────┼─────────────────────────────────────────────────────────────┼───┤
│        │  CONTROL PLANE                          DERIVATION + STORE   │   │
├────────┼─────────────────────────────────────────────────────────────┼───┤
│        │ POST /control/inject-breakdown        ┌───────────────────┐  │   │
│        │ POST /control/speed, /pause           │    PostgreSQL     │◄─┘   │
│        ▼                                        │  machine_event    │      │
│  ┌────────────┐   proxied control call         │  state_interval   │      │
│  │            │◄──────────────────────────────►│  loss_event       │      │
│  │  web       │                                │  counts / orders  │      │
│  │ (Next.js   │   pooled READS (SQL views)     │  sim_clock (1 row)│      │
│  │  App       │◄──────────────────────────────►│  OEE / DIFOT views│      │
│  │  Router)   │                                └─────────┬─────────┘      │
│  │            │   dedicated LISTEN connection            │ NOTIFY         │
│  │            │◄─────────────────────────────────────────┘ (small payload)│
│  └─────┬──────┘                                                           │
├────────┼──────────────────────────────────────────────────────────────────┤
│        │ SSE (text/event-stream) — in-process fan-out                      │
│        ▼                                                                    │
│  ┌────────────┐                                                            │
│  │  browser   │  andon board · OEE waterfall · timeline · Pareto · DIFOT   │
│  └────────────┘                                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

### The two golden rules of this topology

1. **Single consumer, single writer = the worker.** Only the worker subscribes to MQTT and only the worker writes derived state to Postgres. The Next.js app is **read-only on Postgres** plus a thin **control-plane proxy** to the simulator. This prevents split-brain derivation and double-processing. (Do not let Next.js subscribe to MQTT.)
2. **Accelerate time at the source, treat it as normal timestamps everywhere else.** The simulator owns the clock and stamps every event with a **sim-time** timestamp. Postgres, the views, the dashboard, and the DDS "yesterday" logic never know time is accelerated — they just see `timestamptz` values.

### Component Responsibilities

| Component | Responsibility (what it owns) | Talks to | Notes |
|-----------|-------------------------------|----------|-------|
| **simulator** | The virtual plant: per-machine state machines mapped to the Six Big Losses; the authoritative **sim clock**; MQTT publishing; operator-style reason-code annotation; HTTP **control endpoints** (inject breakdown, speed, pause). | → Mosquitto (publish); ← web (control) ; → Postgres (`sim_clock` row + seed only) | Calibrated OEE distribution (most lines 50–65%, one ~85%, one <45%). Stateless w.r.t. derived data — it only produces events. |
| **mosquitto** | MQTT broker. Pure infra. Optional **retained** last-state message per machine for fast andon recovery. | ↔ simulator, worker | No business logic. |
| **worker** | The OEE engine: subscribe MQTT → persist raw `machine_event` (idempotent) → derive `state_interval` (close-on-next-event) → derive `loss_event` attribution ledger → maintain counts → issue coalesced `NOTIFY`. **The only writer of derived state.** | ← Mosquitto; → Postgres (write) | Deterministic replay from `machine_event` on restart. Batches high-rate inserts under accelerated clock. |
| **postgres** | Durable store + **derivation-of-record** via SQL: raw events, intervals, loss ledger, counts, orders/allocations, `sim_clock` singleton, and OEE/DIFOT **views**. | ← worker (write); ← web (read + LISTEN) | Aggregation lives here as views, not in app code. |
| **web (Next.js App Router)** | Dashboard rendering; SSE endpoint; the **LISTEN→in-process→SSE** fan-out bridge; control-plane proxy to simulator. | ← Postgres (read + LISTEN); → simulator (control); → browser (SSE) | Long-lived self-hosted Node process (NOT serverless) — an in-process client registry persists. |
| **browser** | Consumes SSE, renders andon / waterfall / timeline / Pareto / DIFOT drill-down / DDS. | ← web (SSE + fetch) | Applies diffs; no polling if SSE is used. |

---

## Data Model (the spine)

This is the load-bearing design. Three derived layers sit on one append-only fact stream, and **one loss-attribution ledger unifies the OEE waterfall, the Six Big Losses Pareto, and the DIFOT drill-down**.

```
                       ┌─────────────────────────────────────────┐
   RAW (source)        │  machine_event  (append-only, immutable) │
                       │  event_time(sim), ingested_at(real),     │
                       │  type STATE|COUNT|REJECT|ALARM, payload  │
                       └───────────────┬─────────────────────────┘
                                       │  worker derivation (deterministic)
              ┌────────────────────────┼────────────────────────────┐
              ▼                        ▼                             ▼
   ┌───────────────────┐   ┌─────────────────────┐      counts (good/reject
   │  state_interval   │   │     loss_event      │      deltas on COUNT/REJECT
   │  coarse timeline: │   │  attribution ledger │      events, aggregated)
   │  Running/Down/    │   │  category(6 losses),│
   │  Changeover/Break │   │  reason, lost_time, │
   │  → Availability & │   │  lost_units, window │
   │    the timeline UI│   │  → Pareto + drill-  │
   └─────────┬─────────┘   │    down + waterfall │
             │             └──────────┬──────────┘
             └──────────┬─────────────┘
                        ▼
        ┌───────────────────────────────┐     ┌──────────────────────────┐
        │  OEE views (A×P×Q per line/    │     │  customer_order +        │
        │  shift, on-read, P≤100% guard) │     │  allocation → DIFOT view │
        └───────────────────────────────┘     └────────────┬─────────────┘
                                                            │ joins loss_event
                                              DRILL-DOWN: late order → the
                                              loss_events that starved its line
```

### Table sketch

**Configuration / dimensions** (seeded, rarely change)
- `line(id, name, oee_profile)` — profile drives the simulator's calibrated distribution target.
- `machine(id, line_id, name, machine_class)` — MTBF/MTTR defaults per class (configurable; no hardcoded industry claim — see PROJECT open items).
- `product(id, sku, name)` and `machine_product(machine_id, product_id, ideal_cycle_time_sec)` — **ICT is per machine × product**, the fastest theoretical cycle (not a budget number).
- `shift(id, name, start_local, end_local, weekday_mask)` and `break_period(shift_id, start, end)` — drive **Planned Production Time**. Model Indonesian 2-vs-3-shift as config (PROJECT open item).
- `reason_code(id, six_big_loss_category, label, default_planned bool)` — the operator-annotation vocabulary; maps every loss to exactly one of the six categories.

**Facts / derived**
- `machine_event(id bigserial, machine_id, event_time timestamptz /*sim*/, ingested_at timestamptz /*real*/, type, state, good_delta, reject_delta, cycle_time_ms, reason_code_id, seq, payload jsonb)` — **append-only, the replay source**. Natural key `(machine_id, seq)` for idempotent upsert.
- `state_interval(id, machine_id, line_id, state, start_time, end_time NULL, reason_code_id, is_planned bool, source_event_id)` — **coarse** machine timeline. `end_time NULL` = open/in-progress. **Only `Down` and `Changeover` intervals subtract from Run Time.** Feeds the color timeline + Availability.
- `loss_event(id, machine_id, line_id, factor /*A|P|Q*/, six_big_loss_category, reason_code_id, window_start, window_end, lost_time_sec, lost_units, state_interval_id NULL)` — **the attribution ledger, everything in lost-time units**:
  - Availability losses (Equipment Failure, Setup & Adjustments) → one `loss_event` per Down/Changeover interval (`lost_time_sec` = interval duration).
  - Performance losses (Small Stops, Slow Cycles) → in-run windows; `lost_time_sec` = `ideal_time_for_missed_units` (they do **not** touch Availability).
  - Quality losses (Process Defects, Startup Rejects) → `lost_units` = reject count, `lost_time_sec` = rejects × ICT.
  - This single ledger is what makes the **Six Big Losses waterfall, the Pareto, and the DIFOT drill-down all derive from one place** — design it in the derivation phase, do not retrofit it after the dashboard.

**Order book / DIFOT (the differentiator)**
- `customer_order(id, product_id, qty_ordered, order_date /*sim*/, due_date /*sim*/, customer, priority)`.
- `allocation(id, order_id, produced_from_line_id, qty, produced_at /*sim*/)` — FIFO allocation of good production per SKU to open orders by due date (simplest credible model).
- **DIFOT view:** on-time = shipped by `due_date`; in-full = shipped ≥ ordered; DIFOT% = orders both / total.
- **Drill-down query (money shot):** given a late/at-risk order for SKU `S`, find the line(s) producing `S`, then rank the `loss_event`s overlapping the production window `[order_date, due_date]` by `lost_units` / `lost_time_sec`. Output: *"Line 2 breakdown 14:20–15:05 cost ~180 units → order #123 is 120 short."* This is an **on-read SQL function/view** (data volume is tiny; always-current beats materialized here).

---

## Recommended Project Structure

TypeScript end-to-end, npm/pnpm workspace monorepo, one `docker compose up` (mirrors AIDA's app+worker shape).

```
linelens/
├── docker-compose.yml          # mosquitto, postgres, simulator, worker, web
├── packages/
│   ├── contracts/              # THE shared contract (built first, depended on by all)
│   │   ├── events.ts           #   PackTags-lite payload schema (zod) — Status+Admin subset
│   │   ├── topics.ts           #   spBv1.0/LineLens/<type>/<line>/<machine> builders+parsers
│   │   ├── sim-clock.ts        #   sim-time math (real↔sim mapping, piecewise on speed change)
│   │   └── losses.ts           #   Six Big Losses enum + factor(A|P|Q) mapping (from research doc)
│   ├── db/                     # migrations, SQL views, seed data, typed client
│   │   ├── migrations/         #   tables + indexes
│   │   ├── views/              #   oee_by_line_shift, six_big_losses_pareto, difot, drilldown fn
│   │   ├── functions/          #   sim_now(), sim_today(), overlap() helpers
│   │   └── seed/               #   lines, machines, shifts, products, order book
│   ├── simulator/              # state machines, sim clock owner, MQTT publisher, HTTP control
│   ├── worker/                 # MQTT subscriber → persist → derive intervals+losses → NOTIFY
│   └── web/                    # Next.js App Router dashboard + SSE route + LISTEN bridge
└── docs/                       # 00-domain-research.md (verified), case study
```

### Structure Rationale

- **`contracts/` is the keystone and is built first.** Event schema, topic layout, sim-clock math, and the loss-category mapping are shared by simulator, worker, and web. Fixing this contract before writing any producer/consumer de-risks the whole build (see Build Order step 1).
- **`db/` owns aggregation.** OEE and DIFOT are SQL views/functions, not TypeScript. This keeps the math auditable against the verified definitions and testable with fixed scenarios.
- **`simulator`, `worker`, `web` are separate deployables** (three docker services) because they have different lifecycles and the topology demands separate processes. They communicate only through Mosquitto and Postgres — never direct imports across service boundaries (only through `contracts`/`db`).

---

## Architectural Patterns

### Pattern 1: Event-sourced interval derivation — close-on-next-event

**What:** The raw `machine_event` stream is the source of truth. State intervals are derived, not stored primarily. When a `STATE_CHANGE` arrives, close the machine's open interval (`end_time = new event.event_time`) and open a new one. The live interval stays open (`end_time NULL`).
**When to use:** Any event-sourced timeline where transitions are discrete and you want exact, replayable history. **Chosen over periodic-close** because it is exact, timer-free, and rebuildable on worker restart.
**Trade-offs:** An idle machine leaves a stale open interval — correct, but live "duration so far" must be computed at read time as `sim_now() − start_time`. Shift-boundary splitting is handled at **query time** (clamp interval to shift window) rather than by writing synthetic split events — keeps the event log honest.

```typescript
// worker: on STATE_CHANGE for a machine
async function onStateChange(ev: MachineStateEvent) {
  await tx`UPDATE state_interval SET end_time = ${ev.eventTime}
           WHERE machine_id = ${ev.machineId} AND end_time IS NULL`;
  await tx`INSERT INTO state_interval (machine_id, line_id, state, start_time, is_planned, reason_code_id, source_event_id)
           VALUES (${ev.machineId}, ${ev.lineId}, ${ev.state}, ${ev.eventTime}, ${ev.isPlanned}, ${ev.reasonCodeId}, ${ev.id})`;
  // emit availability loss_event if the CLOSED interval was Down/Changeover; then coalesced NOTIFY.
}
```

### Pattern 2: Aggregate on-read via SQL views (defer materialization)

**What:** OEE (A×P×Q), Six Big Losses Pareto, and DIFOT are computed on-read from `state_interval` + `loss_event` + counts + shift calendar, clamped to the shift window.
**When to use:** When data volume is small (a handful of lines/machines; accelerated sim produces thousands, not billions, of rows). **Do not materialize up front** — this mirrors PROJECT.md's explicit DuckDB discipline ("only if Postgres aggregates prove insufficient").
**Trade-offs:** Recomputes each query (trivially cheap here). If a multi-day Pareto later gets slow, add a per-shift rollup table or `MATERIALIZED VIEW` refreshed by the worker — but only then.

```sql
-- OEE per line/shift, implementing the verified "preferred calculation"
-- Availability = Run Time / Planned Production Time  (changeover STAYS a loss in the denominator)
-- Performance  = (ICT × Total Count) / Run Time      (captures small stops + slow cycles)
-- Quality      = Good Count / Total Count
-- Guard: Performance > 1.0 ⇒ ICT misconfigured (flag, do not silently clamp)
SELECT line_id, shift_id,
       run_time / NULLIF(planned_production_time,0)            AS availability,
       (ict * total_count) / NULLIF(run_time,0)                AS performance,
       good_count::numeric / NULLIF(total_count,0)             AS quality,
       ((ict*total_count)/NULLIF(run_time,0)) > 1.0            AS ict_misconfigured_flag
FROM oee_inputs_by_line_shift;  -- run_time excludes Down+Changeover; PPT excludes only breaks/no-intent
```

### Pattern 3: LISTEN/NOTIFY → in-process fan-out → SSE (with poll+diff as the safe fallback)

**What:** The worker `NOTIFY`s a small payload (channel + `line_id`) after a write. The Next.js server holds **one dedicated, unpooled** pg connection permanently `LISTEN`ing. On notification it coalesces per line (~250 ms window), re-queries a compact "live line snapshot," and pushes to an **in-process EventEmitter**; each browser SSE connection is a subscriber.
**When to use:** Self-hosted long-lived Node (LineLens runs in docker, **not** serverless) — so a global in-process client registry genuinely persists, which is exactly what the Vercel-serverless SSE caveat warns is impossible. That caveat does not apply here; this is a strength to lean on.
**Trade-offs:**
- NOTIFY payload cap is **8000 bytes** → send IDs/channels only, never full snapshots; the app re-queries.
- pgBouncer **transaction pooling silently drops LISTEN** → use a dedicated unpooled `Client` for the listener (LineLens has no pgBouncer, so just don't route the listener through a pool).
- Under the accelerated clock, per-event NOTIFY floods → the worker must **coalesce/throttle per line** (notify on meaningful transitions + a periodic tick, not every count).
- **Fallback:** if LISTEN wiring proves fiddly, a **poll+diff** SSE route (re-query every ~1 s real-time, send only changed fields) is a perfectly acceptable, more robust demo default at this scale. Recommend LISTEN/NOTIFY as primary (better latency + shows engineering competence for the portfolio), poll+diff as the escape hatch.

```typescript
// web: Next.js App Router SSE Route Handler (self-hosted, long-lived)
export const dynamic = "force-dynamic";          // never statically optimize an SSE route
export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      const send = (snap: LiveSnapshot) =>
        controller.enqueue(`data: ${JSON.stringify(snap)}\n\n`);
      liveBus.on("tick", send);                   // in-process bus fed by the LISTEN client
      const heartbeat = setInterval(() => controller.enqueue(`: keep-alive\n\n`), 10_000);
      // NOTE: do NOT `await` a processing loop here — the Response must return immediately or it buffers.
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
               "Connection": "keep-alive", "X-Accel-Buffering": "no" }, // defeat proxy buffering
  });
}
```

### Pattern 4: Simulated clock as a single-row source of truth in Postgres

**What:** The simulator owns the clock but persists its parameters to a singleton `sim_clock(epoch_sim, started_at_real, speed_factor, paused_at)` row. `sim_now()` is a **SQL function** every component can call. Because event timestamps are already sim-time, this only matters for **live/open** computations (open-interval duration, "as of now" OEE, "yesterday" for DDS).

```sql
CREATE FUNCTION sim_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN paused_at IS NOT NULL THEN epoch_sim + (paused_at - started_at_real)*speed_factor
              ELSE epoch_sim + (clock_timestamp() - started_at_real)*speed_factor END
  FROM sim_clock;
$$;
```

**When to use:** Any accelerated-time demo. `sim_today()`/`sim_yesterday()` derive from `sim_now()` + the shift calendar so the **DDS "yesterday" screen** reads the most recent *completed* sim day.
**Trade-offs:** On **speed change**, rebase (`epoch_sim := sim_now(); started_at_real := now()`) so the piecewise-linear mapping stays continuous and past timestamps remain immutable. **Pause** freezes `sim_now()` via `paused_at`; resume shifts `started_at_real` forward. Choose N for demo pacing: e.g. `N=60` → a full sim day passes in 24 real minutes, so a fresh completed "yesterday" (great for DDS) and multiple shift turnovers are watchable in a short demo.

---

## Data Flow

### Live telemetry → dashboard (hot path)

```
[machine state machine tick] (simulator, sim clock)
     ↓ publish spBv1.0/LineLens/<type>/<line>/<machine>  (JSON PackTags-lite: state, counts, cycle, alarms)
[Mosquitto]
     ↓ subscribe (worker, single consumer)
[worker] upsert machine_event (idempotent by machine_id,seq)
     ↓ derive: close/open state_interval · emit loss_event · update counts
     ↓ NOTIFY linelens_line, '<line_id>'   (small payload)
[Postgres]
     ↓ (dedicated LISTEN client in web)
[web] coalesce per line → re-query live snapshot view → EventEmitter.emit("tick")
     ↓ SSE frame (text/event-stream)
[browser] apply diff → andon / waterfall / timeline update
```

### Control action (inject breakdown — the demo trigger)

```
[dashboard button] → Next.js route/server action → POST simulator /control/inject-breakdown
     → simulator forces machine into Down state → next MQTT event carries it
     → (rejoins the hot path above) → visibly cascades OEE ↓ → andon red → DIFOT at-risk
```

### DIFOT drill-down (differentiator, on-read)

```
[order list] --late/at-risk--> [order] → drill-down SQL fn:
   line(s) producing order.sku  →  loss_event WHERE window overlaps [order_date, due_date]
   → rank by lost_units / lost_time_sec  →  "Line 2 breakdown cost ~180 units → order #123 short 120"
```

### Build-time / seed flow

```
db/seed → lines, machines, products(ICT), shifts+breaks, reason_codes, order book, sim_clock row
simulator reads config → starts state machines → begins publishing
```

---

## Build Order (dependencies — feeds roadmap phase structure)

Each step is independently verifiable before the next begins. The ordering is **schema-first contract → producer → raw store → derivation → aggregation → live UI → differentiator → DDS → distribution.**

| # | Build unit | Depends on | Verifiable when | Why here |
|---|-----------|-----------|-----------------|----------|
| 1 | **Contracts + skeleton** — docker compose (Mosquitto+Postgres+empty worker+web), event schema, topic layout, sim-clock math, loss-category map, base migrations | — | `docker compose up` runs; types compile; `sim_now()` returns | Fixing the contract first de-risks every downstream consumer; nothing to retrofit later. |
| 2 | **Simulator** — state machines→Six Big Losses, sim clock owner, MQTT publish, calibrated distribution, reason-code annotation, HTTP control | 1 | `mosquitto_sub` shows a living plant on the wire (no DB needed) | The producer is testable in isolation; unblocks everything. |
| 3 | **Ingestion + raw persistence** — worker subscribes → idempotent `machine_event` | 1,2 | `SELECT` shows raw event log filling; restart-safe | Establishes the source-of-truth stream before any derivation. |
| 4 | **Interval + loss derivation** — `state_interval` (close-on-next-event) + `loss_event` ledger | 3 | Intervals reconstruct the plant timeline; losses classify correctly | The OEE engine core; **loss ledger must be designed with the DIFOT drill-down in mind now**, not later. |
| 5 | **OEE + losses aggregation (SQL views)** — A×P×Q per line/shift, Six Big Losses Pareto, P≤100% guard, changeover policy | 4 | Numbers match hand-computed values for a fixed scenario | **The credibility gate** — a factory person must not spot a classification error. |
| 6 | **Dashboard read + live fan-out** — Next.js views + LISTEN/NOTIFY→SSE; andon, waterfall, timeline, Pareto | 5 | Live dashboard updates within ~1 s of a state change | First end-to-end "wow"; validates the hot path. |
| 7 | **Order book + DIFOT + drill-down** — orders, FIFO allocation, DIFOT view, late-order→loss_event drill-down | 4,5 | Late order links to the loss events that starved its line | The signature differentiator; composes the loss ledger + aggregation. |
| 8 | **DDS screen** — yesterday summary (safety/quality/delivery+OEE+top loss), top-3 actions, escalation | 5 (+sim calendar) | Renders the most recent completed sim day | Mostly a read view over existing aggregates + `sim_yesterday()`. |
| 9 | **Distribution** — 60 s inject-breakdown→OEE→DIFOT GIF, README quick-start, case study, LinkedIn | 6,7,8 | GIF captures the money shot; one-command start works | First-class deliverable per PROJECT.md (fixes the recurring demo-URL gap). |

**Ordering rationale:** the DIFOT drill-down (7) sits deliberately late because it *composes* the loss ledger (4) and aggregation (5) — but its data needs are baked into the ledger design at step 4 so nothing is retrofitted. The live SSE hot path (6) precedes the differentiator so you validate real-time plumbing on the simpler andon before layering order linkage.

---

## Scaling Considerations

"Scale" here is a **demo appliance**, not user count: more lines/machines, a faster clock (higher N), and longer sim history.

| Dimension | This scale (v1 demo) | If pushed further | Fix |
|-----------|----------------------|-------------------|-----|
| Event insert rate | A handful of machines × N — thousands of rows | High N × many machines floods `machine_event` inserts | Batch inserts / `COPY`; worker buffers per real-tick before flush. |
| OEE view latency | On-read over short history — trivial | Multi-day Pareto over long history slows | Index `(machine_id, start_time)` / `(line_id, window_start)`; then a per-shift rollup table or `MATERIALIZED VIEW` refreshed by the worker — **only then**. |
| SSE fan-out | Dozens of browser tabs — in-process emitter fine | Hundreds of tabs | Still fine on one Node process; a second app instance would need Redis pub/sub (avoid — not in the stack). |
| NOTIFY volume | Coalesced per line — fine | Very high N | Increase coalescing window; switch andon to poll+diff. |

### Scaling Priorities

1. **First bottleneck:** `machine_event` insert rate under high N → batch/`COPY`, don't insert per message.
2. **Second bottleneck:** long-history aggregate queries → indexes, then (and only then) materialized rollups. Matches PROJECT.md's "don't add DuckDB up front" discipline.

---

## Anti-Patterns

### Anti-Pattern 1: Computing OEE in application (TypeScript) code
**What people do:** Sum intervals and counts in JS to produce OEE.
**Why it's wrong:** The math drifts from the verified definitions, becomes hard to audit, and can't be tested against a fixed SQL scenario.
**Do this instead:** OEE/DIFOT are **SQL views** over the derived facts; the app only renders them.

### Anti-Pattern 2: Treating small stops as downtime
**What people do:** Log a small stop as a `Down` interval, subtracting it from Availability.
**Why it's wrong:** Double-counts the loss and understates Performance. Verified research: **small stops are a Performance loss, not Availability.**
**Do this instead:** Keep the machine in `Running` for availability; record the small stop as an **in-run `loss_event`** (factor = Performance). `Performance = (ICT × Total Count)/Run Time` already absorbs it.

### Anti-Pattern 3: Excluding changeover from Availability by default
**What people do:** Drop changeover time out of the denominator so OEE looks better.
**Why it's wrong:** Overstates OEE; a factory person spots it immediately. Changeover = **Setup & Adjustments, an Availability loss** (verified).
**Do this instead:** Changeover subtracts from Run Time but **stays inside Planned Production Time**. Make exclusion a **configurable policy**, and transition **planned→unplanned on overage** (verified best practice).

### Anti-Pattern 4: Letting the Next.js app also subscribe to MQTT
**What people do:** Have the dashboard read MQTT directly "for speed."
**Why it's wrong:** Two consumers derive state independently → split-brain, double writes, inconsistent counts.
**Do this instead:** **Worker is the only MQTT consumer and only writer.** The app reads Postgres and gets change signals via LISTEN/NOTIFY.

### Anti-Pattern 5: NOTIFY with full payloads / LISTEN on a pooled connection
**What people do:** `NOTIFY channel, '<huge json>'` and listen through the app's connection pool.
**Why it's wrong:** 8000-byte cap truncates/fails; transaction-pooled connections **silently drop** the LISTEN registration.
**Do this instead:** NOTIFY only IDs/channels; app re-queries. Use a **dedicated unpooled** connection for the listener.

### Anti-Pattern 6: Storing real wall-clock as event time
**What people do:** Stamp events with `now()` in the worker.
**Why it's wrong:** Breaks the accelerated demo — shift boundaries, "yesterday," and DIFOT windows all go wrong.
**Do this instead:** **Sim time is stamped at the source** and stored as `event_time`; wall clock is kept only as `ingested_at` for lag debugging. Downstream treats sim time as ordinary timestamps.

### Anti-Pattern 7: Per-event NOTIFY / materializing aggregates up front
**What people do:** Notify on every count tick; build materialized views before there's a perf problem.
**Why it's wrong:** Notification floods under accelerated time; premature optimization contradicts the "keep moving parts minimal" constraint.
**Do this instead:** **Coalesce NOTIFY per line**; use on-read views until a real query is measurably slow.

---

## Integration Points

### External services

| Service | Integration pattern | Notes / gotchas |
|---------|---------------------|-----------------|
| Mosquitto (MQTT) | worker subscribes `spBv1.0/LineLens/#`; simulator publishes per machine | Topic `spBv1.0/LineLens/<type>/<line>/<machine>` (Sparkplug-B **style**, not full compliance — no protobuf/birth-death). UNS path (`Site/Area/Line/Cell`) lives in **metric names inside the payload**, not the topic. Use **QoS 1**; consider **retained** last-state per machine so andon recovers current state after a worker restart. |
| PostgreSQL | worker = pooled writes; web = pooled reads + **one dedicated unpooled LISTEN client** | 8000-byte NOTIFY cap; no pgBouncer transaction pooling on the listener. |
| Simulator control HTTP | web proxies `POST /control/inject-breakdown`, `/speed`, `/pause` | Keep the **control plane separate from the data plane** — control never writes derived state directly; it changes the plant, and the effect flows back through MQTT. |

### Internal boundaries

| Boundary | Communication | Considerations |
|----------|---------------|----------------|
| simulator ↔ worker | via Mosquitto only (never direct) | Decoupled through the broker; shared only through `contracts` (schema/topics). |
| worker ↔ web | via Postgres only (writes + NOTIFY ↔ reads + LISTEN) | No direct process link; DB is the contract. Single-writer discipline. |
| web ↔ simulator | control-plane HTTP only | Thin proxy; no shared state. |
| all ↔ `contracts`/`db` | compile-time import | The only code shared across services — event schema, topic builders, sim-clock math, loss-category map, migrations, views. |

---

## Sources

- `docs/00-domain-research.md` (LineLens, 2026-07-22) — verified OEE preferred calculation (A×P×Q), Six Big Losses 2-2-2 mapping, small-stops→Performance, changeover→Availability policy, PackTags-lite/Sparkplug-B topic conventions, UNS-style-hierarchy guard, DIFOT positioning, DDS spec. **HIGH — adversarially verified (3-0 votes).**
- `.planning/PROJECT.md` (2026-07-22) — fixed service topology, TS/Next.js/Postgres/Mosquitto/SSE stack constraints, calibrated OEE distribution, out-of-scope guards (no full Sparkplug, no DuckDB up front). **HIGH — project source of truth.**
- Next.js App Router SSE streaming patterns and gotchas (`force-dynamic`, no-await-in-`start()` buffering, `X-Accel-Buffering: no`, self-hosted vs serverless client registry) — [nextjs.org/docs/app/guides/streaming](https://nextjs.org/docs/app/guides/streaming), [vercel/next.js discussion #48427](https://github.com/vercel/next.js/discussions/48427), [Fixing Slow SSE in Next.js (Medium)](https://medium.com/@oyetoketoby80/fixing-slow-sse-server-sent-events-streaming-in-next-js-and-vercel-99f42fbdb996). **MEDIUM — web-verified, multiple sources agree (Context7 unreachable this session).**
- PostgreSQL LISTEN/NOTIFY 8000-byte payload cap + pgBouncer transaction-pooling incompatibility — [postgresql.org NOTIFY docs](https://www.postgresql.org/docs/current/sql-notify.html), [Stacksync: Beyond LISTEN/NOTIFY](https://www.stacksync.com/blog/beyond-listen-notify-postgres-request-reply-real-time-sync). **MEDIUM — web-verified, corroborated by official docs.**

---
*Architecture research for: real-time OEE analytics with built-in MQTT telemetry simulator (LineLens)*
*Researched: 2026-07-22*
