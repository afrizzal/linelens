# Roadmap: LineLens

## Overview

LineLens delivers one signature scene: inject a breakdown on a line, watch OEE drop, the andon board turn red, and a live drill-down trace that loss all the way to a late customer order. The build is dependency-ordered around that money shot. First a living virtual plant streams calibrated, event-time-stamped telemetry over MQTT (contracts and the simulator together, because a too-perfect or wall-clock-poisoned fleet fails on sight). Then the OEE engine — the correctness spine a factory-literate viewer will scrutinize — turns raw telemetry into an auditable loss ledger with industry-correct A×P×Q math, built and unit-tested before any number reaches a screen. Only then does the vertical slice go live (andon + waterfall + timeline + the inject-breakdown cascade), proving the real-time hot path end-to-end before breadth is added. The differentiator phase composes the loss ledger and the live pipeline onto an order book (DIFOT drill-down), the Six Big Losses Pareto, and the management-language Daily Direction Setting screen. Distribution is its own first-class phase — a clean-clone `docker compose up`, the 60-second GIF, an honest case study, and a real job application — because "built but never shown" is the documented failure mode this project exists to break.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Living Plant** - One-command virtual factory streaming calibrated, event-time telemetry over MQTT
- [ ] **Phase 2: OEE Engine (Credibility Gate)** - Ingestion worker derives an auditable loss ledger and correct A×P×Q OEE
- [ ] **Phase 3: Live Dashboard — Vertical Slice** - Andon, waterfall, timeline, and the inject-breakdown cascade working live end-to-end
- [ ] **Phase 4: DIFOT, Losses Pareto & Daily Direction Setting** - Machine losses linked to late orders, loss Pareto, and the management shift screen
- [ ] **Phase 5: Distribution** - Public repo, money-shot GIF, honest case study, and a real job application

## Phase Details

### Phase 1: Foundation & Living Plant
**Goal**: A configurable virtual factory runs under one `docker compose up`, streaming calibrated, event-time-stamped telemetry over MQTT that any viewer can verify on the raw wire.
**Depends on**: Nothing (first phase)
**Requirements**: SIM-01, SIM-02, SIM-03, SIM-04, SIM-06, SIM-07
**Success Criteria** (what must be TRUE):
  1. `docker compose up` from a clean clone brings up Mosquitto + Postgres + worker + web skeleton with healthcheck-gated ordering (no service races), plus a shared contracts package (zod event schema, topic builders, sim-clock math, Six Big Losses enum).
  2. A developer subscribing to the broker sees live Sparkplug-B-style telemetry (`spBv1.0/LineLens/<type>/<line>/<machine>`) with PackTags-lite JSON payloads (state, counts, cycle time, alarms) from every machine.
  3. Every event carries accelerated sim-time stamped at the source; no component derives time from wall-clock (verified: hand-computed durations are identical at 2× vs 10× acceleration).
  4. OEE computed by hand from the wire matches the calibrated spread — most lines 50–65%, one showcase ~85%, one problem line <45% — with natural jitter, and loss events carry operator-style reason codes grouped by the Six Big Losses.
  5. The shift calendar defines Planned Production Time: breaks and no-production windows are excluded (Schedule Loss); changeovers are not excluded.
**Plans**: 3 — 01-01 monorepo+compose backbone · 01-02 contracts package (events/topics/clock/calendar/losses) · 01-03 simulator (state machine, calibration, MQTT, control endpoint)

### Phase 2: OEE Engine (Credibility Gate)
**Goal**: The ingestion worker turns raw telemetry into a correct, auditable OEE and loss ledger that a factory-literate viewer cannot fault — built and unit-tested before any number reaches a screen.
**Depends on**: Phase 1
**Requirements**: ENG-01, ENG-02, ENG-03, ENG-04, ENG-05, ENG-06
**Success Criteria** (what must be TRUE):
  1. A single worker is the only MQTT consumer and the only Postgres writer; every raw machine event is persisted losslessly and idempotently.
  2. The worker derives state intervals (close-on-next-event) and records every loss in one `loss_event` ledger — lost-time units, tagged to exactly one of the Six Big Losses, retaining line/machine/time identity (schema anticipates the DIFOT join).
  3. OEE computes with the preferred calculation (A = Run/PPT; P = ICT × Total/Run; Q = Good/Total) per line and shift, and the Vitest suite confirms correct classification: small stops → Performance, changeover → Availability under a configurable "changeover as planned" policy with planned→unplanned transition on overage.
  4. Validation guards fire: Performance > 100% is flagged as misconfigured Ideal Cycle Time, no-runtime windows show "N/A" (never 0% or NaN), and the Total = Good + Reject invariant holds.
  5. Live OEE clamps open/in-progress intervals to sim-now and produces identical results at 2× vs 10× clock acceleration.
**Plans**: 3 — 02-01 db schema+seed+idempotent ingestion · 02-02 interval derivation + loss ledger + NOTIFY · 02-03 OEE views + golden/invariance tests

### Phase 3: Live Dashboard — Vertical Slice
**Goal**: The signature money shot works live end-to-end — inject a breakdown and watch OEE, the andon board, and the production timeline react in real time — proving the real-time hot path before breadth is added.
**Depends on**: Phase 2
**Requirements**: DASH-01, DASH-03, DASH-04, SIM-05
**Success Criteria** (what must be TRUE):
  1. A viewer sees an andon board with all lines on one screen — production state (Running/Down/Changeover/Break) + good count + target count — updating live via SSE.
  2. A viewer sees a real-time OEE waterfall (A×P×Q) per line/shift.
  3. A viewer sees a color-coded production timeline per line (state bands over sim-time).
  4. A viewer triggers "Inject breakdown" (dashboard button or HTTP endpoint) on a chosen line and watches the cascade — OEE drops, the andon tile turns red — propagate live within seconds.
**Plans**: 3 — 03-01 SSE infra + read-model APIs · 03-02 shell+andon+waterfall · 03-03 timeline (ECharts Gantt spike) + inject control + human cascade sign-off
**UI hint**: yes

### Phase 4: DIFOT, Losses Pareto & Daily Direction Setting
**Goal**: Connect machine-level losses to broken customer promises and management-language decisions — the differentiator plus the analytical and synthesis screens that compose the loss ledger and live pipeline.
**Depends on**: Phase 2, Phase 3
**Requirements**: DASH-02, DIFOT-01, DIFOT-02, DDS-01
**Success Criteria** (what must be TRUE):
  1. A viewer sees a Six Big Losses Pareto / Top Losses report, stackable per shift.
  2. A viewer sees DIFOT % (in-full, on-time) computed from a simulated order book (demand per SKU/day) fulfilled from simulated production output.
  3. A viewer drills down from a late/at-risk order to the specific contributing machine-level loss events ("breakdown Line 2 → 3 orders late"), and injecting a *different* breakdown changes *which* order goes late — a genuinely causal link, not a hardcoded demo path.
  4. A viewer sees a Daily Direction Setting screen: yesterday's safety/quality/delivery + OEE + top loss, top-3 actions today with owners, and escalation status.
**Plans**: 3 — 04-01 order book + FIFO allocation + DIFOT view · 04-02 drill-down fn + order detail + causality proof test · 04-03 Pareto + DDS screen
**UI hint**: yes

### Phase 5: Distribution
**Goal**: LineLens is publicly shippable and actually shown — a clean-clone `docker compose up`, a money-shot GIF, an honest case study, and LineLens attached to a real job application.
**Depends on**: Phase 4
**Requirements**: DIST-01, DIST-02, DIST-03, DIST-04
**Success Criteria** (what must be TRUE):
  1. A stranger clones the public MIT repo (github.com/afrizzal) and `docker compose up` works on a clean machine (smoke-tested), guided by an English README with hero GIF and one-command quick start.
  2. A 60-second seeded/deterministic GIF captures the inject-breakdown → OEE → andon → DIFOT drill-down flow.
  3. A portfolio case study page is published with honest framing (simulated build informed by Integra + PLC experience; DIFOT positioned as a "bridge," no absolute-uniqueness claim).
  4. At least 1 LinkedIn process post is published and LineLens is attached to at least 1 real job application.
**Plans**: 2 — 05-01 demo scenario + smoke + README + GIF + publish · 05-02 case study + LinkedIn + application (human-gated)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Living Plant | 0/3 | Planned | - |
| 2. OEE Engine (Credibility Gate) | 0/3 | Planned | - |
| 3. Live Dashboard — Vertical Slice | 0/3 | Planned | - |
| 4. DIFOT, Losses Pareto & DDS | 0/3 | Planned | - |
| 5. Distribution | 0/2 | Planned | - |
