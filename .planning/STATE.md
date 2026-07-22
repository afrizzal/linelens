# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-22)

**Core value:** A 60-second demo makes "machine downtime = broken customer promises" viscerally clear — breakdown on Line 2 → 3 orders late this week — with industry-correct OEE mechanics.
**Current focus:** Phase 1 — Foundation & Living Plant

## Current Position

Phase: 1 of 5 (Foundation & Living Plant)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-07-22 — Roadmap created (5 phases, coarse granularity, 24/24 requirements mapped)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: — min
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: Foundation + Simulator folded into one phase (coarse granularity, 2–3 week sprint); contracts still built first within Phase 1.
- Roadmap: Six Big Losses Pareto (DASH-02) grouped with DIFOT + DDS in Phase 4 to keep Phase 3 a clean vertical slice.
- Roadmap: SIM-05 (inject-breakdown cascade) mapped to Phase 3, where the live cascade first becomes observable, not to the simulator phase that builds the control endpoint.

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- Phase 1 research gap: PackML minimal state subset must be verified against ISA-TR88.00.02-2015 (not the OPC community summary) before coding the simulator state machine.
- Phase 3 research gap: Next.js App Router SSE + Postgres LISTEN/NOTIFY mechanics were web-verified only (Context7 unreachable during research) — confirm via Context7 at Phase 3 start.
- Non-negotiable across all phases: no `Date.now()` in derivation code — event-time from the payload is the only "now" downstream (silent number-corruption class).

## Session Continuity

Last session: 2026-07-22
Stopped at: ROADMAP.md and STATE.md written; REQUIREMENTS.md traceability filled
Resume file: None
