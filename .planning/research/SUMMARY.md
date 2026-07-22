# Project Research Summary

**Project:** LineLens
**Domain:** Real-time OEE / manufacturing analytics dashboard with a built-in MQTT factory-telemetry simulator (portfolio-first, simulated build)
**Researched:** 2026-07-22
**Confidence:** HIGH

## Executive Summary

LineLens is not a SaaS product to be sold to plant operators — it's a portfolio artifact judged by factory-literate viewers (recruiters, plant managers) in a 60-second demo. That reframe is load-bearing across all four research files: "table stakes" means "what a viewer must see done *correctly* before they trust the demo," not "everything a real OEE product needs." The single scene the entire build exists for is the demo's money shot: inject a breakdown → OEE drops → andon board turns red → a live drill-down traces the loss all the way to a specific customer order gone late (OEE → DIFOT causal linkage). No competitor in the researched landscape (Vorne, Evocon, Libre) does this order-linkage; it is LineLens's one clear differentiator, alongside a management-language Daily Direction Setting screen.

The recommended approach is a TypeScript end-to-end monorepo behind a single `docker compose up`: Next.js 16 (App Router) web + a separate ingestion worker + simulator, all against Postgres 18 and Eclipse Mosquitto 2.0.22, pushed live via SSE (never WebSockets). The worker is the **sole MQTT consumer and sole writer of derived state** — Next.js is read-only on Postgres plus a thin control-plane proxy to the simulator — which prevents split-brain derivation. OEE math lives in Postgres SQL views (A×P×Q, per-shift, Performance≤100% guard), not app code, built on one unifying `loss_event` attribution ledger that simultaneously feeds the OEE waterfall, the Six Big Losses Pareto, and the DIFOT drill-down — this ledger's schema is the single most important design decision in the whole project and must anticipate the DIFOT join from day one, not retrofit it later. Prisma 7 (Rust-free, TypedSQL for the window-function math) and Apache ECharts (the only library that natively covers waterfall + Pareto + Gantt-style timeline + live tiles in one mental model) round out the stack; a hand-rolled discriminated-union state machine (not XState) is enough for the small, flat, verified PackML subset the simulator needs.

Two risk classes dominate. First, **credibility killers**: a factory-literate viewer instantly spots a misclassified small stop (should be Performance, not Availability), a changeover wrongly excluded from Availability, a Performance figure above 100% (misconfigured Ideal Cycle Time), or a simulated fleet that's too perfect (uniform ~90% OEE, round numbers, no jitter). Mitigation is to encode the Six Big Losses → A/P/Q mapping directly in the engine and its tests, ship the Performance>100% guard as a *visible feature* rather than hide it, and calibrate the fleet to the verified real-world distribution (50–65% majority, one ~85% showcase, one <45% problem line) with jitter and imperfect reason-code annotation. Second, the **silent number corruption class**: the simulator runs an accelerated clock, and any code path that reads wall-clock `Date.now()` instead of the simulated event-time in the payload silently poisons every duration/OEE/DIFOT number while the UI still looks alive — the single non-negotiable rule is "no `Date.now()` in derivation code, ever." A third, purely process-level risk is explicitly gated into the roadmap: over-scoping breadth (7 build areas) before the demo's vertical slice is wired end-to-end, and deferring the distribution GIF — the maintainer's documented recurring failure mode from a prior project.

## Key Findings

### Recommended Stack

The high-level stack (TypeScript, Next.js App Router, Postgres, Mosquitto, SSE) was already decided in PROJECT.md; STACK.md pins the implementation layer inside those constraints, with every version verified live against npm/official docs on 2026-07-22. The standout decisions are: **Prisma 7 + TypedSQL** to resolve Prisma's historical weak spot (window-function-heavy interval derivation) while keeping AIDA-reuse velocity and Prisma Studio for eyeballing synthetic data; **Apache ECharts** as the one library that natively renders all four signature visuals including the Gantt-style production timeline (Recharts would require hand-rolled D3 for that); and **direct-MQTT-subscribe or Postgres LISTEN/NOTIFY** for SSE fan-out with **no Redis added** — deliberately minimal moving parts.

**Core technologies:**
- **Node.js 24.x LTS** — current Active LTS (Jul 2026), long support window for a repo that must still `docker compose up` cleanly a year from now
- **Next.js 16.2.x (App Router)** — Route Handlers stream a native `ReadableStream`/SSE with no extra server
- **PostgreSQL 18.x** — native partitioning + window functions cover all time-series needs at demo scale; no TimescaleDB/DuckDB needed
- **Eclipse Mosquitto 2.0.22 (pinned)** — stable MQTT broker; avoid the 2.1.0-rc/`latest` tags for reproducibility
- **mqtt (MQTT.js) 5.15.2** — TS-native client for both simulator (publish, QoS 1) and worker (subscribe, `clean:false` + stable clientId for session persistence)
- **Prisma 7.9.0 + @prisma/adapter-pg + pg 8.22.0** — Rust-free ORM with TypedSQL for the OEE window-function queries; requires a driver adapter to connect at all
- **Apache ECharts 6.1.0 + echarts-for-react** — one library, one mental model for waterfall, Pareto, Gantt timeline, and live tiles
- **zod 4.4.x** — validate untrusted MQTT JSON payloads and config at the parse-don't-validate boundary
- **Vitest 4.1.10** — fast, ESM-native, table-driven OEE-correctness unit tests; the credibility centerpiece needs fast tests
- **Tailwind CSS 4.3.x** — andon tiles are plain React components, not charts; fast, consistent styling

### Expected Features

The MVP is already scoped tightly in PROJECT.md; FEATURES.md prioritizes build order within it and is explicit that several *real-product* table stakes (operator reason-entry UI, custom dashboard builder, report scheduling, auth) are deliberately demoted to anti-features because a 60-second viewer never touches them.

**Must have (table stakes — credibility floor):**
- OEE waterfall (A×P×Q) per line/shift, with the Performance ≤100% validation guard shown as a visible feature
- Correct loss classification (small stops → Performance; changeover → Availability/Setup&Adjustments)
- Six Big Losses Pareto, stackable per shift; color-coded production timeline per line
- Andon board across all lines: state (Running/Down/Changeover/Break) + good count + target count, live via SSE
- Shift + Planned Production Time handling (breaks/no-demand excluded); calibrated, realistic OEE distribution (not a too-perfect fleet)

**Should have (differentiators — why the demo wins):**
- OEE → DIFOT drill-down: late/at-risk customer order → the specific loss event(s) that starved its line (the money shot; frame as a "bridge," never as absolute uniqueness — Celonis does adjacent ERP-based order-delay classification)
- "Inject breakdown" demo control — one button/HTTP call that visibly cascades the whole pipeline live
- One-command living virtual plant (the built-in simulator) — removes the "empty dashboard, needs real data" problem
- Daily Direction Setting (DDS) screen — proves management-language fluency, doubles as the shift report

**Defer (v2+ / anti-features):**
- Interactive operator reason-code entry UI, configurable dashboard builder, PDF/CSV export + scheduling/emailing, waste/scrap-in-currency module, predictive maintenance, real PLC/sensor ingestion, full Sparkplug B / full PackML compliance, auth/multi-tenant/RBAC, a live hosted demo URL (GIF + `docker compose up` is the mandatory path instead)

### Architecture Approach

The system topology is fixed by PROJECT.md: simulator → Mosquitto → worker → Postgres → Next.js/SSE → browser. Two golden rules govern everything: (1) the worker is the **single consumer and single writer** — Next.js never subscribes to MQTT and is read-only on Postgres plus a control-plane proxy, preventing split-brain derivation; (2) time is accelerated only at the source — the simulator stamps every event with simulated event-time, and everything downstream treats it as an ordinary `timestamptz`, never touching wall-clock `Date.now()`. One `loss_event` attribution ledger unifies the OEE waterfall, the Pareto, and the DIFOT drill-down, sitting on top of an append-only `machine_event` stream and a derived `state_interval` timeline (close-on-next-event pattern). OEE/DIFOT aggregation is computed on-read via SQL views, not materialized up front and not computed in application code.

**Major components:**
1. **Simulator** — owns the sim clock, runs per-machine state machines mapped to the Six Big Losses, publishes MQTT telemetry, exposes HTTP control endpoints (inject-breakdown/speed/pause)
2. **Mosquitto** — pure MQTT broker infra; optional retained last-state per machine for andon recovery
3. **Worker** — the OEE engine: subscribes MQTT, persists idempotent raw events, derives state intervals and the loss-attribution ledger, issues coalesced Postgres `NOTIFY`
4. **PostgreSQL** — durable store and derivation-of-record via SQL views (raw events, intervals, loss ledger, orders/allocations, OEE/DIFOT views, `sim_clock` singleton)
5. **Web (Next.js App Router)** — dashboard rendering, SSE endpoint (LISTEN→in-process fan-out→SSE, poll+diff as fallback), control-plane proxy to the simulator
6. **Browser** — consumes SSE, renders andon/waterfall/timeline/Pareto/DIFOT drill-down/DDS

### Critical Pitfalls

1. **OEE classification errors a factory person catches on sight** — small stops miscategorized as Availability instead of Performance, changeover excluded from Availability, or ICT set as a budget number causing Performance>100%. Avoid by encoding the Six Big Losses→factor mapping directly in the engine and its tests, and shipping the Performance>100% guard as a hard assertion plus a visible dashboard warning.
2. **OEE calculation edge cases** — divide-by-zero on no-runtime shifts, open/in-progress intervals skewing live OEE, Planned Production Time confused with calendar time, reject double-counting. Avoid with explicit `N/A` (never `0%`/`NaN%`) guards, clamping open intervals to "now" for live values, and modeling the shift calendar explicitly.
3. **Event-time vs wall-clock corruption under the accelerated sim clock** — the silent, invisible-until-checked bug where any `Date.now()` leaking into derivation collapses interval durations to near-zero. Avoid by making event-time from the payload the only source of "now" everywhere downstream; treat "no `Date.now()` in derivation code" as a lint/review rule.
4. **Simulated-data tells that read as fake** — a too-perfect fleet (all lines ~90%, round numbers, zero variance, synchronized failures) is spotted by a plant manager in three seconds. Avoid by calibrating to the verified 50–65%/85%/<45% distribution, adding jitter and MTBF/MTTR-driven variance, and letting reason-code annotation lag/stay partially uncategorized.
5. **Over-scoping the 2–3 week sprint before the money shot is wired** — building all seven areas to equal fidelity risks running out of time before the signature inject-breakdown→OEE→andon→drill-down cascade exists end-to-end. Avoid by building a thin vertical slice first, then widening breadth.

## Implications for Roadmap

Based on combined research, suggested phase structure (mirrors ARCHITECTURE.md's dependency-ordered Build Order, restructured around PITFALLS.md's "vertical slice before breadth" warning):

### Phase 1: Foundation & Contracts
**Rationale:** Event schema, topic layout, sim-clock math, and DB migrations are shared by every downstream producer/consumer; fixing this contract first de-risks the entire build and leaves nothing to retrofit later.
**Delivers:** `docker compose up` running an empty Mosquitto + Postgres + skeleton worker + skeleton web; shared `contracts` package (zod event schema, topic builders, sim-clock math, Six Big Losses enum); base migrations + `sim_now()` SQL function; healthcheck-gated startup ordering.
**Addresses:** Infrastructure table stakes (MQTT, Postgres, SSE transport) that must be real, not theatre.
**Avoids:** Docker startup-ordering pitfall (short-form `depends_on` racing before services are ready); lays the event-time contract groundwork before Pitfall 3 can occur.

### Phase 2: Simulator (the Living Plant)
**Rationale:** The producer must exist and be independently verifiable (visible on the raw MQTT wire) before anything consumes it. Simulator quality is the single highest-leverage work item — every downstream visual inherits its credibility.
**Delivers:** Per-machine hand-rolled discriminated-union state machines mapped to the Six Big Losses; calibrated OEE distribution (50–65% / ~85% / <45%); MTBF/MTTR-driven jitter; reason-code annotation with realistic lag; sim-clock ownership; HTTP control endpoints (inject-breakdown/speed/pause).
**Addresses:** Calibrated distribution and reason-code-tree table stakes; the "one-command living virtual plant" and "inject-breakdown demo control" differentiators.
**Avoids:** Pitfall 4 (simulated-data tells) and Pitfall 5 (re-introducing refuted anti-patterns — the PackML state list must be verified directly against ISA-TR88.00.02-2015, not the OPC summary page; the minor-stop threshold must be config, not hardcoded).

### Phase 3: Ingestion & OEE Engine (the Credibility Gate)
**Rationale:** The engine is the correctness spine a factory-literate viewer will scrutinize; it must be built and unit-tested before any dashboard renders a number a viewer could catch as wrong.
**Delivers:** Worker MQTT subscriber → idempotent `machine_event` persistence → `state_interval` derivation (close-on-next-event) → `loss_event` attribution ledger → OEE SQL views (A×P×Q, per-shift, Performance≤100% guard, configurable changeover policy) — entirely event-time based.
**Uses:** mqtt.js v5 (QoS 1, `clean:false`, stable clientId), Prisma 7 + TypedSQL for window-function queries, Vitest table-driven tests against fixed scenarios from the domain research.
**Avoids:** Pitfall 1 (classification errors), Pitfall 2 (divide-by-zero/open-interval/PPT/reject edge cases), Pitfall 3 (event-time vs wall-clock — enforced as a lint/review rule).

### Phase 4: Live Dashboard — the Vertical Slice
**Rationale:** Per the over-scoping pitfall, build the thin end-to-end path (simulator → MQTT → ingestion → OEE → andon → inject-breakdown cascade) before widening to every widget. This is also the first "wow" moment that validates the real-time hot path.
**Delivers:** Next.js App Router SSE route (dedicated unpooled Postgres LISTEN client → in-process fan-out → EventSource, poll+diff as the documented fallback), andon board, OEE waterfall, production timeline; inject-breakdown wired end-to-end and visibly cascading through the whole stack.
**Uses:** ECharts for waterfall/timeline, `X-Accel-Buffering: no` + `dynamic = 'force-dynamic'` + raw `Response` (never `NextResponse`) headers.
**Avoids:** SSE-buffering pitfalls (works in `next dev`, breaks in docker); Anti-Patterns 4/5 (Next.js subscribing to MQTT directly; oversized/pooled NOTIFY payloads).

### Phase 5: DIFOT Differentiator
**Rationale:** Composes the loss ledger (Phase 3) and the live pipeline (Phase 4) onto an order book. Deliberately sequenced after the simpler andon path is proven live, so real-time plumbing and order-linkage logic aren't debugged simultaneously.
**Delivers:** `customer_order` + FIFO `allocation`, DIFOT view (on-time/in-full %), late-order → loss-event drill-down (on-read SQL function), UI path from a late order to the causing machine loss.
**Addresses:** The signature differentiator — OEE → DIFOT drill-down (the money shot).
**Avoids:** Pitfall 7's "cosmetic DIFOT link" trap — verify injecting a *different* breakdown changes *which* order goes late (a genuinely causal link, not a hardcoded demo path).

### Phase 6: Six Big Losses Pareto & DDS Screen
**Rationale:** Mostly read-views over aggregates that already exist by this point; the DDS screen is a synthesis screen depending on nearly everything (OEE + Pareto + DIFOT), so it correctly builds last among the analytical widgets.
**Delivers:** Six Big Losses Pareto (stackable per shift), Daily Direction Setting screen (yesterday summary + top-3 actions + escalation) driven by `sim_yesterday()`.
**Addresses:** Pareto table stake; DDS differentiator, which also doubles as the "shift report" table stake — no separate export engine needed.
**Avoids:** Anti-feature creep — no PDF/CSV export engine, no scheduling/emailing built here.

### Phase 7: Distribution
**Rationale:** Explicitly first-class in the Definition of Done, not a coda — the maintainer's documented recurring failure mode (from a prior project) is deferring exactly this.
**Delivers:** Seeded, deterministic demo scenario; 60-second inject-breakdown→OEE→DIFOT GIF; README with one-command quick start + `.env.example`; pinned image tags; clean-machine smoke test; case study; ≥1 LinkedIn post attached to ≥1 real job application.
**Avoids:** Pitfall 7 (works-on-my-machine + GIF-left-for-later) — gate the milestone on a clean-checkout smoke test.

### Phase Ordering Rationale

- **Dependency-driven:** contracts → producer → raw store → derivation → aggregation → live UI → differentiator → synthesis screen → distribution, mirroring ARCHITECTURE.md's Build Order table exactly.
- **Vertical-slice-first within that order:** Phase 4 deliberately stops at andon + waterfall + timeline (not full breadth) so inject-breakdown is proven live end-to-end before DIFOT/DDS composition, directly countering the over-scoping pitfall.
- **Schema anticipates the differentiator:** the loss-ledger design in Phase 3 is built anticipating DIFOT's needs (Phase 5) from the start, per Architecture's explicit warning against retrofitting the order→loss-event join later.
- **Distribution is its own phase**, not folded into "polish," because it's Definition-of-Done and the maintainer's known failure mode.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Simulator):** The PackML minimal state subset is currently sourced from an unverified community reference (OPC summary page); must be verified directly against ISA-TR88.00.02-2015 before the state machine is coded.
- **Phase 4 (Live Dashboard):** Next.js App Router SSE + Postgres LISTEN/NOTIFY integration mechanics were verified via web search only (Context7 was unreachable during this research session) — confirm against official/Context7 docs before implementation.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Well-documented Docker Compose + healthcheck patterns.
- **Phase 3 (OEE Engine):** Math and classification are fully verified in the adversarially-checked domain research; HIGH confidence.
- **Phase 6 (Pareto/DDS):** Spec verified against domain research (Vorne/Evocon/Augmentir precedent).
- **Phase 7 (Distribution):** Standard portfolio/GSD distribution practice.

Phase 5 (DIFOT) warrants light validation only (no direct OEE-segment precedent exists, but the data model and drill-down query are already fully specified in ARCHITECTURE.md) — not a full research-phase.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified live against npm registry / official docs on 2026-07-22, not training data |
| Features | HIGH for table-stakes/OEE mechanics (adversarially-verified domain research); MEDIUM for gap-fill UX items (shift-calendar UX, reason-code taxonomy detail, report-export framing) and the DIFOT differentiator's "bridge not unique" framing |
| Architecture | HIGH on structure (derived from verified domain research + fixed PROJECT.md topology); MEDIUM on two platform mechanics (Next.js SSE streaming, Postgres LISTEN/NOTIFY) which were web-verified because Context7 was unreachable this session |
| Pitfalls | HIGH — technical pitfalls verified against current docs (Next.js, MQTT.js, Docker Compose, Postgres NOTIFY); domain pitfalls carried from the adversarially-verified domain research |

**Overall confidence:** HIGH

### Gaps to Address

- **PackML minimal state subset:** not yet verified against the actual ISA-TR88.00.02-2015 standard (current sourcing is an unverified community reference) — resolve before coding the Phase 2 state machine.
- **MTBF/MTTR per-machine-class defaults:** not publicly sourced; must be implemented as configurable parameters with sane assumed defaults, never presented as a hardcoded industry authority.
- **Indonesian 2-vs-3-shift calendar patterns:** open question, deferred to v1.x unless a specific employer conversation needs it localized.
- **Next.js SSE + Postgres LISTEN/NOTIFY mechanics:** verified via web search only this session (Context7 unreachable) — confirm official mechanics via Context7 at the start of Phase 4.
- **ORM choice (Prisma 7 + TypedSQL vs Drizzle):** a defensible tradeoff, not a slam dunk — revisit if TypedSQL friction appears during Phase 3.

## Sources

### Primary (HIGH confidence)
- `docs/00-domain-research.md` (LineLens, 2026-07-22) — adversarially-verified domain research (21 confirmed claims, 4 refuted anti-patterns): OEE formula (A×P×Q), Six Big Losses 2-2-2 mapping, Vorne/Evocon/Libre UX baseline, andon minimums, DDS spec, DIFOT bridge framing, telemetry standards, calibrated OEE distribution (Evocon 3,500-machine dataset)
- `.planning/PROJECT.md` — fixed service topology, stack constraints, scope boundary (Active/Out-of-Scope), Definition of Done
- npm registry (live query 2026-07-22) — exact current versions for every core dependency
- mqtt.js README (github.com/mqttjs/MQTT.js) + EMQX MQTT.js tutorial — reconnect/QoS/offline-buffer behavior
- Prisma docs (prisma.io/docs) + @prisma/adapter-pg npm — driver-adapter requirement, TypedSQL compatibility
- endoflife.date/nodejs, postgresql.org, Docker Hub `eclipse-mosquitto` — LTS/version status
- Docker Compose startup-order docs (docs.docker.com/compose/how-tos/startup-order) — `service_healthy` condition pattern
- MDN Server-Sent Events + Chromium bug 275955 — 6-connection HTTP/1.1 per-domain limit

### Secondary (MEDIUM confidence)
- Next.js App Router SSE streaming patterns (nextjs.org/docs/app/guides/streaming, Vercel discussions, practitioner posts) — web-verified only, Context7 unreachable this session; confirm before Phase 4
- PostgreSQL LISTEN/NOTIFY 8000-byte cap + pgBouncer transaction-pooling incompatibility (postgresql.org, Stacksync blog) — web-verified, corroborated by official docs
- Recharts vs ECharts vs visx comparisons (LogRocket, FusionCharts) — DX/perf tradeoff framing for the charting decision
- XState-vs-discriminated-union analyses, Drizzle-vs-Prisma comparisons — ORM/state-machine tradeoff framing, not slam-dunk decisions

### Tertiary (LOW confidence)
- PackML state-list community references (17 states / 4 minimal-compliant) — unverified against the actual ISA-TR88.00.02-2015 standard; flagged as a research gap for Phase 2
- Per-machine-class MTBF/MTTR figures — no public authoritative source found; treated as configurable defaults, not fact

---
*Research completed: 2026-07-22*
*Ready for roadmap: yes*
