# LineLens

## What This Is

LineLens is a real-time OEE (Overall Equipment Effectiveness) / manufacturing analytics dashboard driven by a built-in factory telemetry simulator. One `docker compose up` brings up a living virtual plant: production lines stream machine events over MQTT, and the dashboard shows real-time OEE, loss analysis, an andon board, and — the signature move — a drill-down from a late customer order (DIFOT) to the machine-level loss event that caused it. It is a **portfolio-first, simulated build**: clean-room synthetic data, no real factory claims, built as market-segment evidence for manufacturing IT leadership roles in East Java's industrial belt.

## Core Value

A recruiter or plant manager watching a 60-second demo immediately understands: **"machine downtime = broken customer promises"** — breakdown on Line 2 → 3 orders late this week — demonstrated live, credibly, with industry-correct OEE mechanics.

## Requirements

### Validated

(None yet — ship to validate)

### Active

**Simulator**
- [ ] Configurable factory simulator (lines, machines, shifts, ideal cycle time per product) generating realistic loss events via a per-machine state machine mapped to the Six Big Losses
- [ ] Simulator publishes telemetry over MQTT (Mosquitto) using Sparkplug-B-style topics (`spBv1.0/LineLens/<type>/<line>/<machine>`) with PackTags-lite JSON payloads (Status + Admin subset: state, counts, cycle time, alarms)
- [ ] Operator-style reason-code annotation modeled on loss events (mirrors how real OEE tools get reason data — operator input, not sensors)
- [ ] Demo "Inject breakdown" control (HTTP endpoint + dashboard button) that visibly cascades through OEE → andon → DIFOT live
- [ ] Calibrated realism: most lines 50–65% OEE, one showcase line ~85%, one problem line <45%

**OEE Engine**
- [ ] Ingestion worker subscribes MQTT → persists raw events → derives state intervals with loss categories in Postgres
- [ ] Preferred OEE calculation (A×P×Q per oee.com/Vorne definitions) aggregated per line/shift, with built-in validation guard: Performance > 100% flags misconfigured Ideal Cycle Time
- [ ] Correct loss classification: small stops → Performance loss; changeover → Availability loss (Setup & Adjustments), configurable "changeover as planned" policy + planned→unplanned transition on overage

**Dashboard (English UI)**
- [ ] Real-time OEE waterfall (A×P×Q) per line/shift
- [ ] Six Big Losses Pareto / Top Losses report, stackable per shift
- [ ] Color-coded production timeline per line
- [ ] Andon board: all lines on one screen — production state (Running/Down/Changeover/Break) + good count + target count, updating live (SSE)

**DIFOT Module (differentiator)**
- [ ] Simulated order book (demand per SKU/day) linked to production output → DIFOT % (in-full, on-time)
- [ ] Drill-down: late/at-risk order → contributing line/machine loss events (the money shot)

**DDS Screen**
- [ ] Daily Direction Setting screen: yesterday's performance summary (safety/quality/delivery + OEE + top loss), top-3 actions today with owners, escalation status

**Distribution (part of Definition of Done)**
- [ ] Public GitHub repo (github.com/afrizzal), MIT license, README with hero GIF + one-command quick start
- [ ] 60-second demo GIF capturing the inject-breakdown → OEE → DIFOT drill-down flow
- [ ] Portfolio case study page (cross-linking StockLens/MarkovLens/OmniSync patterns, honest framing)
- [ ] At least 1 LinkedIn process post + attached to at least 1 real job application

### Out of Scope

- **Waste module (scrap/yield in currency)** — first-cut candidate per original scope decision; Pareto of losses already tells the money story for v1
- **Predictive maintenance (Markov machine-state model)** — v2; will cross-link MarkovLens engine when built
- **Real machine ingestion (PLC/sensor connectivity)** — v2+ only if market signal justifies it; MVP is honest simulated build
- **Full Sparkplug B compliance (protobuf payloads, birth/death lifecycle)** — topic convention + JSON is enough for credibility; full compliance adds no demo value
- **Full PackML state machine (17 states)** — simplified subset only; state list must be verified against ISA-TR88.00.02-2015 before implementation
- **Multi-tenant / auth / user management** — this is a demo appliance, not a SaaS
- **DuckDB analytical layer** — only if Postgres aggregates prove insufficient; do not add up front
- **Live demo URL** — stretch goal in distribution phase (Railway/Fly.io hobby tier), not a v1 requirement; GIF + docker compose is the mandatory demo path
- **TPM/IWS as features** — narrative + DDS screen only; do not claim IWS/P&G-specific tiering structures (not documented in verified sources)

## Context

- **Domain research is done and verified** — `docs/00-domain-research.md` (2026-07-22): 21 adversarially verified claims (formulas, Six Big Losses taxonomy, benchmarks, competitor UX baseline, telemetry standards), 4 refuted anti-patterns, DDS spec, DIFOT positioning guidance. GSD phase researchers must read it before searching the web.
- **Positioning (verified-safe framing):** "OEE tools stop at the machine; supply-chain analytics starts at the order; LineLens demonstrates the bridge in one drill-down." Never claim absolute uniqueness (Celonis does order-delay classification from ERP process data; MES/ERP suites link indirectly via schedule attainment).
- **Honesty guardrail:** framed as *simulated build informed by manufacturing experience at Integra (Dynamics AX, multi-site furniture manufacturing) + PLC background (Omron, Production Engineer internship)* — never claimed as a real factory deployment.
- **Portfolio family:** sibling of StockLens (batch inventory analytics, Python/DuckDB) and MarkovLens (churn prediction); deliberately standalone — different data rhythm (real-time floor events vs batch snapshots), different buyer (Plant Manager vs Purchasing). Reuse patterns, not code.
- **Proven patterns to reuse:** AIDA's app+worker single-image docker compose shape; StockLens's clean-room synthetic data credibility; OmniSync's event ingestion thinking.
- **Why this project:** consistent market signal — recruiter contact suggested manufacturing innovation twice; LinkedIn scan (2026-07-22) showed ~half of East Java IT openings have manufacturing/industrial context; user's job target is IT/engineering leadership in the Surabaya–Sidoarjo–Gresik industrial belt.
- **Distribution is a first-class deliverable** — user's existing portfolio projects suffered from a distribution gap (built but not shown); LineLens explicitly bakes GIF/case-study/LinkedIn/application into scope.
- **Open research items** (resolve during phase research, not blockers): PackML minimal state subset from ISA-TR88.00.02-2015; typical MTBF/MTTR per machine class (make configurable with sane defaults); Indonesian shift patterns (2 vs 3 shift) for the simulator calendar.

## Constraints

- **Timeline**: ~2–3 week sprint MVP — scope discipline is the point; cut features, not credibility
- **Tech stack**: TypeScript end-to-end; Next.js (App Router) + ingestion worker + PostgreSQL, one `docker compose up`; Mosquitto as MQTT broker; SSE (not WebSockets) for browser real-time — minimal moving parts, mirrors AIDA's proven shape
- **Data**: 100% synthetic/clean-room — no employer data, no real production figures (per standing confidentiality rule)
- **Language**: English UI + README (global portfolio audience; manufacturing vocabulary is English anyway)
- **Budget**: $0 infrastructure for v1 (local docker); live URL only on free/hobby tier as stretch
- **Credibility**: every OEE mechanic must match verified industry definitions in `docs/00-domain-research.md` — a factory person watching the demo must not spot a classification error

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Standalone project, not merged into StockLens/MarkovLens | One project = one business story; different data model, rhythm, and buyer | — Pending |
| Name: LineLens | Consistent with -Lens portfolio family; "line" = production line | — Pending |
| Portfolio-first, not product-first | Helping many people is AIDA's job; LineLens wins a job-market segment; forcing both goals stalls both | — Pending |
| Preferred OEE calculation (A×P×Q) with P≤100% validation | Verified industry standard (oee.com/Vorne, 3-0 adversarial votes) | — Pending |
| Changeover = Availability loss, configurable policy + overage transition | Verified best practice; real plants vary, so policy is a setting not a hardcode | — Pending |
| Telemetry = discrete count/reject/cycle + operator-style reason codes | Matches market leader Vorne XL's actual data model (1–2 sensors); simpler AND more credible than fake sensor complexity | — Pending |
| "UNS-style hierarchy", never "ISA-95-aligned" | ISA-95 normative levels are Work Center/Work Unit; Line/Cell is UNS convention (refuted-claim guard) | — Pending |
| DIFOT positioning = "bridge" framing, no absolute-uniqueness claim | Verification found no OEE-segment precedent but Celonis is adjacent via ERP data | — Pending |
| English UI/README | Global recruiter audience; active applications (HFMI) require English | — Pending |
| GIF-first demo, live URL as stretch | Fixes the recurring StockLens demo-URL gap with a realistic mandatory floor | — Pending |
| Simulator distribution: most lines 50–65%, one ~85%, one <45% | Matches verified real-world OEE distribution (Evocon 3,500+ machines); a too-perfect factory reads as fake | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-22 after initialization*
