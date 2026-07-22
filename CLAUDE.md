<!-- GSD:project-start source:PROJECT.md -->
## Project

**LineLens**

LineLens is a real-time OEE (Overall Equipment Effectiveness) / manufacturing analytics dashboard driven by a built-in factory telemetry simulator. One `docker compose up` brings up a living virtual plant: production lines stream machine events over MQTT, and the dashboard shows real-time OEE, loss analysis, an andon board, and — the signature move — a drill-down from a late customer order (DIFOT) to the machine-level loss event that caused it. It is a **portfolio-first, simulated build**: clean-room synthetic data, no real factory claims, built as market-segment evidence for manufacturing IT leadership roles in East Java's industrial belt.

**Core Value:** A recruiter or plant manager watching a 60-second demo immediately understands: **"machine downtime = broken customer promises"** — breakdown on Line 2 → 3 orders late this week — demonstrated live, credibly, with industry-correct OEE mechanics.

### Constraints

- **Timeline**: ~2–3 week sprint MVP — scope discipline is the point; cut features, not credibility
- **Tech stack**: TypeScript end-to-end; Next.js (App Router) + ingestion worker + PostgreSQL, one `docker compose up`; Mosquitto as MQTT broker; SSE (not WebSockets) for browser real-time — minimal moving parts, mirrors AIDA's proven shape
- **Data**: 100% synthetic/clean-room — no employer data, no real production figures (per standing confidentiality rule)
- **Language**: English UI + README (global portfolio audience; manufacturing vocabulary is English anyway)
- **Budget**: $0 infrastructure for v1 (local docker); live URL only on free/hobby tier as stretch
- **Credibility**: every OEE mechanic must match verified industry definitions in `docs/00-domain-research.md` — a factory person watching the demo must not spot a classification error
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Node.js** | **24.x LTS** ("Krypton", Active LTS, EOL 2028-04-30) | Runtime for web + worker | Current Active LTS as of Jul 2026 (Node 22 is Maintenance-only; Node 26 not LTS until Oct 2026). Long support window = safe for a repo that must still `docker compose up` cleanly a year from now. |
| **TypeScript** | **7.0.x** (native/Go compiler; 5.9 as conservative fallback) | End-to-end types | TS 7 (the Go-native `tsc`) is current and ~10x faster type-checks — nice in a fast iteration loop. If any dependency's `.d.ts` chokes on the new compiler, pin **5.9.x**; both compile the same LineLens code. |
| **Next.js (App Router)** | **16.2.x** | Dashboard web app + SSE route handlers | Decided. App Router Route Handlers stream a `ReadableStream` (Web Streams API) — the native SSE mechanism, no extra server. |
| **PostgreSQL** | **18.x** (18.3 latest stable) | Event store + derived state intervals + dimensional model | Decided. v18 declarative range partitioning + `LAG/LEAD` window functions cover all time-series-ish needs at demo scale. No time-series extension required (see What NOT to Use). |
| **Eclipse Mosquitto** | **2.0.22** (pin exact; do **not** use 2.1.0-rc) | MQTT broker | Decided. 2.0.x is the stable line; 2.1.0 was still RC (target 2026-01-26) — a portfolio appliance must be reproducible, so pin the released tag. |
| **mqtt (MQTT.js)** | **5.15.2** | MQTT client for both simulator (publish) and worker + SSE route (subscribe) | The de-facto Node MQTT client. **v5 is a full TypeScript rewrite with bundled types**, ~30% faster client, embedded WebSocket support, better QoS 1/2. Zero reason to reach for anything else. |
| **Prisma ORM** | **7.9.0** (`prisma` + `@prisma/client` + **`@prisma/adapter-pg` 7.9.0**) | Schema, migrations, CRUD, typed raw SQL | Reuses AIDA's proven Prisma+worker docker shape → velocity in a 2–3 wk solo sprint. Prisma 7 is **Rust-free** (TS/WASM query compiler, ~1.6 MB vs old ~14 MB, up to 9x faster cold start). Prisma Studio is a genuine accelerant for eyeballing synthetic data during dev. See ORM decision note below. |
| **Apache ECharts** | **6.1.0** (+ **echarts-for-react 3.0.6**) | All four signature charts | One library natively covers waterfall, Pareto, **and the color-coded production timeline/Gantt** — the visual Recharts can't do without hand-rolled D3. Canvas rendering handles live-updating tiles via `setOption` merge better than SVG. See charting decision note. |
| **pg (node-postgres)** | **8.22.0** (+ `@types/pg` 8.20.0) | Postgres driver under the Prisma adapter | Prisma 7 requires a JS driver adapter; `@prisma/adapter-pg` wraps `pg`. Also usable directly for `LISTEN/NOTIFY` if chosen for SSE fan-out. |
| **Vitest** | **4.1.10** | OEE-correctness unit tests + aggregation integration tests | ESM/TS-native, near-zero config for a greenfield TS repo, Jest-compatible API. The OEE engine is the credibility centerpiece → fast, table-driven tests matter. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **zod** | 4.4.x | Validate MQTT JSON payloads (PackTags-lite) + env/config | Always — untrusted-shape MQTT messages and the configurable simulator/OEE policy config both need a parse-don't-validate boundary. |
| **tsx** | 4.23.x | Run the worker/simulator in dev without a build step | Dev + `docker` dev target. Prod worker can run compiled JS or `tsx` directly (fine for an appliance). |
| **pino** | 10.3.x | Structured logging in worker + SSE route | Mirrors AIDA's worker logging; readable event/state-transition logs help demo debugging. |
| **date-fns** | 4.4.x | Shift-boundary math, planned-production-time windows, DDS "yesterday" ranges | Availability needs Planned Production Time per shift; date math is fiddly and error-prone by hand. |
| **Tailwind CSS** | 4.3.x | Andon board + dashboard layout | Andon tiles are **plain React components, not charts** — Tailwind gets the color-coded Running/Down/Changeover grid built fast; consistent with the portfolio family. |
| **@testcontainers/postgresql** | 12.0.x | Disposable Postgres for aggregation-SQL integration tests | Only for the handful of window-function/interval-derivation queries; pure OEE math stays DB-free. Optional if you'd rather test against the compose Postgres in CI. |
| **@playwright/test** | 1.61.x | Smoke test the inject-breakdown → tile-turns-red demo flow | Optional / stretch — great for the case-study GIF's honesty, not required for the 2–3 wk core. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| Prisma Studio (`prisma studio`) | Inspect synthetic events/orders/intervals live | Ships with Prisma 7; big DX win while calibrating the 50–65% / ~85% / <45% OEE distribution. |
| `prisma migrate dev` / TypedSQL codegen | Migrations + typed raw SQL | Put OEE window-function queries in `prisma/sql/*.sql` → `prisma generate --sql` → import as typed functions. |
| Next.js `output: 'standalone'` | Shrink the web runtime image | Multi-stage build: install+`prisma generate`+`next build` → copy standalone into a `node:24-slim` runtime. |
| Docker healthchecks + `depends_on: service_healthy` | Ordered startup | Worker waits for Postgres + Mosquitto healthy before subscribing. |
## Installation
# Core runtime deps
# UI
# Dev / test
# No XState, no Recharts, no ORM #2 — see decision notes below.
## Key Implementation Decision Notes
### MQTT client — `mqtt@5` config for a broker-restart-surviving worker
- **Publisher (simulator):** state-change + count events at **QoS 1** (delivery matters for OEE accuracy); optional heartbeat at QoS 0. Stable `clientId`.
- **Subscriber (ingestion worker):** `clean: false` + a **stable `clientId`** + subscribe at **QoS 1** so the broker keeps the session and replays missed messages across a broker/worker restart. `resubscribe: true` (default) re-establishes subscriptions on reconnect.
- **Broker pairing gotcha:** `clean:false` only survives a *broker* restart if Mosquitto has **`persistence true`** (+ `persistence_location` on a volume). Config the broker and client together or persistence is silently lost.
- **Reconnect:** defaults are sane — `reconnectPeriod: 1000ms`, `connectTimeout: 30s`. Use `manualConnect: true` + explicit `client.connect()` if you need Postgres ready first. Set `reconnectOnConnackError: true` only if the broker may reject early during compose startup races.
- **`queueQoSZero`** (default true) buffers outbound QoS 0 while offline — fine for the simulator.
- Confidence: **HIGH** (mqtt.js README + EMQX docs).
### ORM — Prisma 7 primary, Drizzle the credible alternative
- Choose **Drizzle 0.45.2** instead only if you want every query as inline SQL and don't value Studio/AIDA reuse — it's lighter and codegen-free, but you re-solve migrations + lose the data browser during a sprint where eyeballing synthetic data is valuable.
- Confidence: **MEDIUM-HIGH** (versions HIGH; the pick is a defensible tradeoff, not a slam dunk).
### SSE in Next.js App Router
- Route Handler at e.g. `app/api/stream/route.ts` returning a `ReadableStream`; headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`.
- **Must** set `export const runtime = 'nodejs'` (need Node APIs for `mqtt`/`pg`, not Edge) **and** `export const dynamic = 'force-dynamic'` (prevent static optimization of the stream).
- Do **not** `await` inside `start()` — kick off async work and return so Next flushes the response immediately.
- Send a keep-alive comment (`: ping\n\n`) every **~15 s** to defeat idle/proxy timeouts (the well-known ~35 s cutoff).
- Clean up on disconnect via `request.signal`'s `abort` to unsubscribe MQTT / clear the interval (avoids the `ResponseAborted`/`unhandledRejection` gotcha). Browser `EventSource` auto-reconnects; emit `id:` lines + honor `Last-Event-ID` if you want replay.
- **Data source for the live feed:** worker and web are separate processes, so the SSE route should **subscribe directly to Mosquitto** for live andon tiles (decoupled from the persistence worker, **no Redis added**). Postgres serves historical/aggregated queries. Alternative fan-out: Postgres `LISTEN/NOTIFY` emitted by the worker — use only if you want a single MQTT consumer.
- Confidence: **HIGH**.
### Charting — ECharts primary, Recharts the alternative
- Use tree-shaken imports (`echarts/core` + only needed charts/components) to keep the bundle lean.
- Render **client-side only** (`'use client'`, or `dynamic(..., { ssr:false })`) — canvas doesn't belong on the server.
- **Andon tiles are not charts** — build them as Tailwind React components fed by SSE state; don't reach for a chart lib.
- Choose **Recharts 3.10.0** instead only if you drop the Gantt timeline or strongly prefer declarative React components — then you'd hand-roll the timeline in SVG/D3 anyway, which costs more than learning ECharts' one imperative API.
- Confidence: **HIGH** (versions) / **MEDIUM-HIGH** (the pick — DX preference could flip it, but the Gantt requirement is the tiebreaker).
### Simulator state machine — hand-rolled discriminated union, not XState
- Choose **XState 5.32.5** (+ `@xstate/react` 6.1.0) instead only if the graph grows hierarchical/parallel, or you specifically want the Stately visualizer as a case-study asset. Not worth the abstraction for a 4–8 state machine.
- Confidence: **HIGH** (matches the "start simple, graduate to XState only for nesting/parallelism" ecosystem consensus).
### Time simulation — real-time with an accelerated-clock multiplier
- Do **not** build a full next-event discrete-event-simulation engine (e.g. SimScript) — over-engineered for a scripted, watch-it-live demo. The value is real-time cascade visibility, not statistical throughput of millions of events.
- Confidence: **HIGH**.
### Docker / compose — AIDA's single-image app+worker shape
- **One Node image built once**, run as two services with different commands: `web` (`next start` / standalone server) and `worker` (`node`/`tsx` entry running ingestion + simulator, or split into two services if you prefer clean separation of simulate vs ingest). Plus `postgres:18` and `eclipse-mosquitto:2.0.22`.
- Matches PROJECT's explicit "reuse AIDA's app+worker single-image docker compose shape" and keeps Dockerfile maintenance to one multi-stage build.
- **Mosquitto** needs a mounted `mosquitto.conf`: `listener 1883`, `allow_anonymous true` (demo appliance, no auth per scope), and `persistence true` + `persistence_location /mosquitto/data/` (pairs with the worker's `clean:false`). Named volumes for pg data and mosquitto data.
- Healthchecks + `depends_on: { condition: service_healthy }` so the worker doesn't race Postgres/Mosquitto on cold `up`.
- Confidence: **HIGH**.
### Testing — Vitest, math-first
- **Unit (fast, no DB):** OEE engine — `A×P×Q`, the **Performance ≤ 100% guard** (misconfigured ICT), and loss classification (small stop → Performance, changeover → Availability Setup&Adjustments, planned→unplanned on overage, configurable "changeover as planned" policy). Table-driven cases straight from `docs/00-domain-research.md`.
- **Integration (thin):** the TypedSQL/window-function aggregation queries against a disposable Postgres via `@testcontainers/postgresql` (or the compose pg in CI).
- **Optional smoke:** Playwright for inject-breakdown → andon tile turns red.
- Confidence: **HIGH**.
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Prisma 7 (+ TypedSQL) | Drizzle 0.45.2 | You want SQL-first everywhere and don't value Prisma Studio / AIDA reuse; codegen-free schema is a priority. |
| Apache ECharts 6 | Recharts 3.10.0 | You drop the Gantt/timeline view or strongly prefer declarative React chart components. |
| Hand-rolled DU state machine | XState 5.32.5 | State graph becomes hierarchical/parallel, or you want the Stately visualizer as a portfolio asset. |
| Real-time accelerated clock | Full next-event DES (SimScript) | Only if the sim must model statistically rigorous throughput of huge event volumes (not a demo goal). |
| SSE via direct MQTT subscribe | Postgres `LISTEN/NOTIFY` fan-out | You want a single MQTT consumer (the worker) and the web tier reading only Postgres. |
| Vitest 4 | Jest | You already have Jest muscle memory — but slower TS/ESM setup on a greenfield repo. |
| Node 24 LTS | Node 22 (Maintenance) | Only if a dependency lacks Node 24 support (none identified here). |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **WebSockets** (Socket.IO, ws) | Decided against — dashboard flow is server→browser one-way; SSE auto-reconnects and needs no extra server. Adds moving parts against the "minimal" constraint. | SSE via App Router Route Handler + `EventSource`. |
| **TimescaleDB / hypertables** | Explicitly out of scope; adds a non-official Postgres image + ops surface for zero demo-scale benefit. Native partitioning + window functions suffice. | Plain Postgres 18 tables; range-partition only *if* volume ever proves it (it won't at demo scale). |
| **DuckDB analytical layer** | PROJECT out-of-scope — don't add up front. | Postgres aggregates (TypedSQL). |
| **Full Sparkplug B** (protobuf, birth/death lifecycle) | Out of scope — topic convention + JSON is enough for credibility; protobuf adds tooling with no demo value. | `spBv1.0/LineLens/<type>/<line>/<machine>` topic + PackTags-lite JSON (Status+Admin). |
| **Raw `pg` as the whole data layer** | No migrations/types → slow and error-prone in a sprint; the DIFOT relational drill-down wants real relations. | Prisma 7 (keep `pg` only as the adapter driver). |
| **visx / D3-from-scratch charts** | Maximum control, wrong budget — burns sprint days on plumbing. | ECharts (covers the hard Gantt natively). |
| **Chart.js** | Weaker custom-Gantt/timeline support and TS ergonomics vs ECharts. | ECharts. |
| **TypeORM / Sequelize** | Dated DX, weaker TS inference than Prisma/Drizzle in 2026. | Prisma 7 or Drizzle. |
| **`eclipse-mosquitto:2.1.0-rc` / `:latest`** | RC/floating tags break reproducibility of a portfolio appliance. | Pinned `eclipse-mosquitto:2.0.22`. |
| **Prisma without a driver adapter** | Prisma 7 is Rust-free and **won't connect** without one. | `@prisma/adapter-pg` + `pg`. |
## Stack Patterns by Variant
- Back the SSE route with Postgres `LISTEN/NOTIFY` (worker `NOTIFY` on each derived interval) + emit `id:` + honor `Last-Event-ID`.
- Because a direct-MQTT SSE subscriber can miss messages during a browser reconnect gap; DB-backed fan-out is durable.
- Pin `typescript@5.9.x`.
- Because TS 7 is new; the LineLens source compiles identically under 5.9 — no code changes, just the toolchain.
- Split compose into managed services: Neon/Railway Postgres + a hosted MQTT (HiveMQ Cloud free) + Next on Fly.io/Railway; worker as a Fly machine.
- Because Vercel can't host a long-lived MQTT-subscribing worker or a persistent SSE process cleanly; the GIF + `docker compose up` remains the mandatory path.
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| prisma / @prisma/client 7.9.0 | @prisma/adapter-pg 7.9.0 | **Keep all three on the same 7.x version** — adapter version tracks Prisma version. |
| @prisma/adapter-pg 7.9.0 | pg 8.22.0 | Adapter wraps node-postgres; TypedSQL works with adapter-pg. |
| echarts 6.1.0 | echarts-for-react 3.0.6 | Wrapper 3.x targets ECharts 5/6; import ECharts core yourself for tree-shaking. |
| next 16.2.x | Node 24 LTS, React 19 | App Router SSE needs `runtime='nodejs'` + `dynamic='force-dynamic'`. |
| mqtt 5.15.2 | Node 24 | v5 is TS-native (bundled types); requires `new MqttClient()` (breaking vs v4 factory style). |
| vitest 4.1.10 | TypeScript 7/5, Node 24 | ESM-first; no ts-jest shims needed. |
## Sources
- npm registry (live query 2026-07-22) — exact current versions: `mqtt@5.15.2`, `prisma`/`@prisma/client`/`@prisma/adapter-pg@7.9.0`, `pg@8.22.0`, `drizzle-orm@0.45.2`, `echarts@6.1.0`, `echarts-for-react@3.0.6`, `xstate@5.32.5`, `@xstate/react@6.1.0`, `vitest@4.1.10`, `next@16.2.11`, `typescript@7.0.2`, `tsx@4.23.1`, `zod@4.4.3`, `tailwindcss@4.3.3`, `pino@10.3.1`, `date-fns@4.4.0`, `@testcontainers/postgresql@12.0.4`, `@playwright/test@1.61.1` — **HIGH**
- mqtt.js README (github.com/mqttjs/MQTT.js) + EMQX MQTT.js tutorial — reconnect/QoS/offline-buffer behavior, v5 TS rewrite — **HIGH**
- Prisma docs (prisma.io/docs — Database drivers, Upgrade to v7) + @prisma/adapter-pg npm — driver-adapter requirement + TypedSQL compatibility — **HIGH**
- Next.js docs (nextjs.org/docs/app/guides/streaming) + Vercel discussion #61972 (ResponseAborted) + practitioner posts — App Router SSE pattern, keep-alive, abort handling — **HIGH**
- endoflife.date/nodejs + InfoQ (Node release-schedule change) — Node 24 Active LTS as of Jul 2026 — **HIGH**
- postgresql.org / release notes — Postgres 18.3 latest stable; native partitioning as time-series baseline — **HIGH**
- Docker Hub `eclipse-mosquitto` (2.0.22 stable, 2.1.0 RC target 2026-01-26) — **HIGH**
- Recharts vs ECharts vs visx comparisons (LogRocket, FusionCharts, 2026) — DX/perf tradeoffs, canvas vs SVG for real-time — **MEDIUM-HIGH**
- XState-vs-discriminated-union analyses (oneuptime, dev.to 60-line engine, statelyai discussion) — "start simple, graduate to XState for nesting/parallelism" — **MEDIUM-HIGH**
- Drizzle-vs-Prisma-2026 comparisons (Encore, Bytebase, MakerKit) + Prisma 7 Rust-free perf claims — ORM tradeoff framing — **MEDIUM-HIGH**
- Discrete-event-simulation references (Wikipedia DES, SimScript, Arena book) — accelerated vs real-time clock tradeoff — **MEDIUM**
- `docs/00-domain-research.md` (verified) — telemetry standards, PackML subset caveat, Six Big Losses classification driving state-machine + OEE-test design — **HIGH**
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
