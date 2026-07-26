---
phase: 01-foundation-living-plant
verified: 2026-07-25T20:20:00Z
revised: 2026-07-25T21:20:00Z
status: passed
score: 5/5 must-haves verified (last open item closed by automated compose smoke test)
human_verification: []
---

> **Revision 2026-07-25T21:20Z** — the one remaining `human_needed` item (full
> 5-service `docker compose up`) is now **machine-verified**, not deferred. It was
> automated as a Playwright suite against the live stack (`pnpm smoke` →
> `tests/smoke/compose-stack.spec.ts`, 5/5 pass; negative control confirmed by
> stopping the simulator and watching the suite fail).
>
> Doing so exposed that the item was **not** purely environmental. Two genuine
> code defects were hiding behind it, both fixed in `f93a495`:
> **(a)** no `.dockerignore`, so `COPY . .` clobbered the image's `node_modules`
> with the host's Windows pnpm symlinks and crash-looped simulator/worker/web on
> `MODULE_NOT_FOUND`; **(b)** simulator port `expose`d but not published, leaving
> the control endpoint unreachable from the host. Only the TLS-interception build
> failure was environmental, and it is now handled by an opt-in
> `docker/certs/` → `NODE_EXTRA_CA_CERTS` step that no-ops on a clean machine.
>
> Truth 1 below therefore upgrades from ⚠️ PARTIAL / HUMAN to ✓ VERIFIED. See
> `01-HUMAN-UAT.md` for the full evidence trail and two non-defect observations
> (`worker` exits 0 by Phase 1 design; a duplicate simulator instance cannot share
> the broker because the stable MQTT clientId is deliberate).

# Phase 1: Foundation & Living Plant Verification Report

**Phase Goal:** A configurable virtual factory runs under one `docker compose up`, streaming calibrated, event-time-stamped telemetry over MQTT that any viewer can verify on the raw wire.
**Verified:** 2026-07-25T20:20:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria from ROADMAP.md)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `docker compose up` from a clean clone brings up Mosquitto + Postgres + worker + web skeleton with healthcheck-gated ordering, plus a shared contracts package | ⚠️ PARTIAL / ? HUMAN | `docker compose up -d db mqtt` verified live in this session: both `db` (postgres:18) and `mqtt` (eclipse-mosquitto:2.0.22) reach `(healthy)` within ~7s. `docker-compose.yml` statically reviewed: simulator/worker/web all `depends_on: {db,mqtt: condition: service_healthy}`, correct image/pin versions. `docker compose build simulator` **fails in this sandbox** with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` at the corepack/pnpm fetch step — a documented TLS-interception artifact of this machine, reproduced live, matching 01-01/01-03 SUMMARY claims exactly. Contracts package exists and is complete (see truth 5). Routed to human_verification per task instructions — not counted as a gap. |
| 2 | A developer subscribing to the broker sees live Sparkplug-B-style telemetry (`spBv1.0/LineLens/<type>/<line>/<machine>`) with PackTags-lite JSON payloads from every machine | ✓ VERIFIED | Live `mosquitto_sub -t 'spBv1.0/LineLens/DDATA/+/+'` against the running `mqtt` container returned real retained/persisted JSON events (e.g. `{"v":1,"machineId":"L1-M1","lineId":"L1","simTime":"2026-01-06T22:30:22.452Z","seq":19101,"kind":"COUNTS","goodDelta":2,...}`) — persisted from a prior live simulator run (proves Mosquitto `persistence true` + QoS1 session survival genuinely works, not just configured). Topic shape matches `topics.ts` exactly (`spBv1.0/LineLens/DDATA/<line>/<machine>`, one segment off the roadmap's illustrative `<type>` wording but this is the plan's own explicitly-locked contract, consistent with 01-02/01-03). |
| 3 | Every event carries accelerated sim-time stamped at the source; no component derives time from wall-clock (verified via 2× vs 10× acceleration identical durations) | ✓ VERIFIED | `apps/simulator/test/invariance.test.ts` runs the pure plant with identical seed at step sizes 15,000ms (speed-60-shaped) and 150,000ms (speed-600-shaped) and asserts `JSON.stringify` of the two event lists is byte-identical, plus a one-shot-advance cross-check. This genuinely tests the criterion (not a weaker proxy) — same seed, different tick granularity, byte-identical output. Grep confirms no stray `Date.now()`/`new Date()` outside the documented clock-edge files (`main.ts`, `control.ts` via injected `nowRealMs`, and decode-only `new Date(simMs)` calls in `machine.ts`/`calendar.ts`/`plant.ts`). |
| 4 | OEE computed by hand from the wire matches the calibrated spread (50–65% / ~85% / <45%) with jitter; loss events carry Six-Big-Losses reason codes | ✓ VERIFIED | `apps/simulator/test/calibration.test.ts` runs 3 full sim-days per profile through the real state machine (no mocking) and computes OEE via an inline A×P×Q reference calc from the actual emitted events: showcase asserted ∈[78,92]%, typical ∈[48,67]%, problem ∈[28,44]% (hard `<45`), plus a per-shift stddev>1.5pt jitter assertion — all four assertions are genuine, not weakened. Live `docker compose exec`-free run in 01-03 SUMMARY additionally reports real observed bands (78-92/48-67/28-44) matching. Reason codes verified in `packages/contracts/src/reasons.ts` + `losses.test.ts`: LOSS_FACTOR maps all 6 categories correctly (SMALL_STOPS→PERFORMANCE, not Availability — the credibility-critical mapping) and a guard test proves no hardcoded duration-threshold constant exists (refutes docs/00-domain-research.md §8.2 anti-pattern). |
| 5 | The shift calendar defines Planned Production Time excluding breaks; changeovers are not excluded | ✓ VERIFIED | `packages/contracts/test/calendar.test.ts`: full default shift PPT = 435 min (480 − 45 break minutes) — hand-matches the plan's own worked example; a mid-break clamp test excludes only elapsed break overlap (150 min at 09:37, i.e. 157 elapsed − 7 min break so far); `shiftInstanceAt` returns null at 23:30 (schedule loss / no shift). `plannedProductionTimeMs`'s exclusion list is breaks-only — changeover is never referenced as an exclusion anywhere in `calendar.ts`, matching "changeovers are NOT excluded" (changeover interval durations remain inside PPT as an Availability loss, consistent with `docs/00-domain-research.md` §2/§9 and `losses.ts`'s `PLANNED_STOPS→AVAILABILITY` mapping). |

**Score:** 5/5 truths pass on evidence; truth 1's live-build sub-check is routed to human verification (sandbox networking limitation, not a code defect — already logged in STATE.md/SUMMARYs as a carried-forward blocker).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `docker-compose.yml` | postgres:18 + eclipse-mosquitto:2.0.22 healthchecked; app services gated on service_healthy | ✓ VERIFIED | Confirmed live: db+mqtt healthy in ~7s. All 3 app services depend_on both with `condition: service_healthy`. Exact pinned versions used (no `:latest`, no 2.1.0-rc). |
| `packages/contracts/src/events.ts` | zod schemas for STATE_CHANGE/COUNTS/ALARM | ✓ VERIFIED | Discriminated union present, matches plan spec field-for-field; round-trip + rejection tests pass. |
| `plant.config.json` | default plant: 4 lines, calibration profiles, shifts, products | ✓ VERIFIED | Present at repo root; validated against `PlantConfigSchema`; 4 lines × 2 machines (showcase/typical/typical/problem), 3 products, 2-shift calendar, seed 42, speed 60. |
| `packages/contracts/src/sim-clock.ts` | pure simNow/rebase math | ✓ VERIFIED | Present, pure, tested (continuity across rebase/pause/resume). |
| `packages/contracts/src/calendar.ts` | PPT excluding breaks | ✓ VERIFIED | See truth 5. |
| `apps/simulator/src/machine.ts` | per-machine state machine with seeded RNG and calibration-driven distributions | ✓ VERIFIED | Discrete-event, execute-time-domain countdown budgets; mulberry32+FNV-1a seeding; imports `PROFILES` from contracts, never redefines. |
| `apps/simulator/src/control.ts` | inject-breakdown/speed/clock/healthz HTTP endpoints | ✓ VERIFIED | All 4 routes present; live-tested in 01-03 (per SUMMARY) producing a `STATE_CHANGE DOWN` with `meta.injected=true` within seconds. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `packages/contracts` | `apps/simulator`, `apps/worker`, `apps/web` | workspace import `@linelens/contracts` | ✓ WIRED | `apps/simulator/src/*` imports `PROFILES`, `MachineState`, event schemas, `topicFor`, `shiftInstanceAt` etc. directly from `@linelens/contracts`; `profiles.ts` is a thin re-export, not a redefinition. `pnpm -r run typecheck` passes clean across all 5 workspace projects, confirming the import graph resolves. |
| `apps/simulator` | Mosquitto (`mqtt`) | mqtt@5 publisher, QoS1, `clean:false`, stable clientId | ✓ WIRED | Live-verified this session: retained/persisted events on the wire from a prior live run, proving publish+persistence actually functioned end-to-end (not just configured). |
| `apps/simulator` control server | plant clock | `POST /control/speed` → `contracts.rebase` | ✓ WIRED (per SUMMARY; not re-run live this session — low risk, unit-tested rebase math + reviewed control.ts wiring) | |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| SIM-01 | 01-03 | Per-machine state machine, PackML-inspired subset, states map to Six Big Losses; configurable plant layout | ✓ SATISFIED | `states.ts` (EXECUTE/DOWN/CHANGEOVER/BREAK), `machine.ts` state machine, `plant.config.json` configurable layout. |
| SIM-02 | 01-02 | Sparkplug-B-style topics + PackTags-lite JSON payloads | ✓ SATISFIED | `topics.ts` + `events.ts`; live wire evidence above. |
| SIM-03 | 01-02 | Accelerated sim-time stamped at source; no wall-clock derivation | ✓ SATISFIED | `sim-clock.ts` + invariance test (byte-identical at different speeds). |
| SIM-04 | 01-03 | Loss events carry operator-style reason codes, grouped by Six Big Losses | ✓ SATISFIED | `reasons.ts` taxonomy + ALARM/STATE_CHANGE events carry `reasonCode`; `LOSS_FACTOR` mapping tested. |
| SIM-06 | 01-03 | Calibrated fleet realism: 50–65% / ~85% / <45% with jitter | ✓ SATISFIED | `calibration.test.ts` genuinely asserts all three bands + jitter stddev>1.5. |
| SIM-07 | 01-02 | Shift calendar defines PPT; breaks excluded, changeovers not excluded | ✓ SATISFIED | `calendar.ts` + `calendar.test.ts`; see truth 5. |

No orphaned requirements — all 6 phase-1 IDs in REQUIREMENTS.md (SIM-01/02/03/04/06/07) are claimed by plans 01-02/01-03 and verified above. SIM-05 (inject-breakdown viewer-facing button) correctly belongs to Phase 3 per REQUIREMENTS.md traceability table, not Phase 1 — not a gap here.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No blocker anti-patterns found. Grep for TODO/FIXME/placeholder/hardcoded-empty in `packages/contracts/src`, `apps/simulator/src` returned nothing load-bearing. No hardcoded minute-threshold constant (docs §8.2 anti-pattern) exists anywhere in the loss/reason taxonomy — confirmed by the package's own guard test and a direct grep. | ℹ️ Info | None |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| db+mqtt reach healthy | `docker compose up -d db mqtt` + `docker compose ps` | Both `(healthy)` within ~7s | ✓ PASS |
| Monorepo typechecks | `pnpm -r run typecheck` | Clean across web/contracts/db/simulator/worker | ✓ PASS |
| Full test suite | `pnpm test` (Vitest) | 14 files / 56 tests passed | ✓ PASS (matches SUMMARY claim exactly) |
| Live telemetry on wire | `mosquitto_sub -t 'spBv1.0/LineLens/DDATA/+/+' -C 3` | 3 valid PackTags-lite JSON COUNTS events returned, correct topic/schema shape | ✓ PASS |
| Full app-image build | `docker compose build simulator` | Fails: `UNABLE_TO_VERIFY_LEAF_SIGNATURE` at `corepack prepare pnpm@10.34.4` | ✗ FAIL in this sandbox, routed to human_verification (see frontmatter) — reproduces the exact environment limitation documented in 01-01/01-03 SUMMARY, not a new gap |

### Human Verification Required

### 1. Full 5-service `docker compose up` (build step)

**Test:** From a clean clone, on a machine without TLS-interception middleware, run `cp .env.example .env && docker compose up` and confirm all 5 services (db, mqtt, simulator, worker, web) start/become healthy.
**Expected:** `docker compose ps` shows db+mqtt healthy, simulator healthy (via its `/healthz` check), worker running, web serving on :3000 — matching Success Criterion 1 in full.
**Why human:** This sandbox's container build network fails `corepack prepare pnpm@...` with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` — a local TLS-interception artifact, not reproducible from the Dockerfile/compose config itself (both reviewed statically and match the plan). Confirmed reproduced live in this verification session, consistent with two prior SUMMARY reports flagging the identical blocker. Needs a clean-network machine to close out.

### Gaps Summary

No gaps found. All 5 ROADMAP success criteria for Phase 1 have direct, verified evidence in the actual codebase (not just SUMMARY narrative) — contracts package is complete and tested, the simulator produces genuine speed-invariant and calibration-band-correct telemetry proven by tests that assert the real criteria (not weaker proxies), and live wire evidence confirms Mosquitto persistence and topic/payload shape work end-to-end. The sole open item is the full 5-service image build, which is an environment-specific sandbox limitation (already tracked) rather than a defect in the phase's deliverables — routed to human verification per this task's explicit instructions, not counted as a gap.

---

*Verified: 2026-07-25T20:20:00Z*
*Verifier: Claude (gsd-verifier)*
