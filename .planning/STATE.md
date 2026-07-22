# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-22)

**Core value:** A 60-second demo makes "machine downtime = broken customer promises" viscerally clear — breakdown on Line 2 → 3 orders late this week — with industry-correct OEE mechanics.
**Current focus:** Phase 1 — Foundation & Living Plant

## Current Position

Phase: 1 of 5 (Foundation & Living Plant)
Plan: 0 of 3 in current phase (14 plans total: 3/3/3/3/2)
Status: Ready to execute — ALL 14 plans for phases 1–5 authored upfront (2026-07-23, by the planning session's main model at the user's request; adversarially reviewed). Do NOT run /gsd:plan-phase — go straight to /gsd:execute-phase N.
Last activity: 2026-07-23 — All-phase plans written to .planning/phases/*/; model profile switched quality→balanced so executors run on Sonnet

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
- All-phase upfront planning (2026-07-23): 14 detailed plans authored in one pass with formulas, schemas, and hand-computed golden values embedded; later-phase plans assume earlier-phase contracts — if execution deviates from a contract (schema/file/interface), UPDATE the downstream plans before executing them, do not improvise.
- SSE fan-out = Postgres LISTEN/NOTIFY (worker stays the sole MQTT consumer per ENG-01); STACK.md's direct-MQTT-subscribe suggestion is the rejected variant.
- Model profile switched to balanced (executor=Sonnet) at the user's request — plans carry the full logic so execution needs no re-derivation.

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
