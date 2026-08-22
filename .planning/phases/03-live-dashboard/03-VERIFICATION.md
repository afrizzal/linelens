---
phase: 03-live-dashboard
verified: 2026-08-22T21:45:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 3: Live Dashboard — Vertical Slice Verification Report

**Phase Goal:** The signature money shot works live end-to-end — inject a breakdown and watch OEE, the andon board, and the production timeline react in real time — proving the real-time hot path before breadth is added.
**Verified:** 2026-08-22T21:45:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Andon board with all lines on one screen — state + good count + target count — updating live via SSE | ✓ VERIFIED | `apps/web/src/app/(dashboard)/andon/page.tsx` + `components/andon/tile.tsx` render state color, `{good}/{target}` progress bar, per-machine dots; live-updated via `useLive` (SSE `/api/stream` → debounced refetch, 5s poll fallback). `GET /api/andon` computes worst-state-per-line, SUM-of-per-machine-ICT target (documented rationale for parallel machines). Human walkthrough step 1 confirmed live (03-03-SUMMARY.md). |
| 2 | Real-time OEE waterfall (A×P×Q) per line/shift | ✓ VERIFIED | `components/oee/waterfall.tsx` (ECharts custom stacked-bar waterfall, PPT/A-loss/P-loss/Q-loss/productive) + `lib/oee-waterfall.ts` (pure formula module, unit-tested: identity `PPT − aLoss − pLoss − qLoss = productive` holds, N/A-safe, ENG-05 floor-at-0 for negative performance loss). `GET /api/oee` sources `v_line_shift_oee`/`v_machine_shift_oee`. `KpiTiles` renders N/A (never 0%) and an `ict_misconfigured` warning badge. Human walkthrough step 2 confirmed L1 ~85%/L4 <45% and identity holds live. |
| 3 | Color-coded production timeline per line (state bands over sim-time) | ✓ VERIFIED | `components/timeline/gantt.tsx` (ECharts custom-series Gantt, `renderItem` per official pattern) + `lib/timeline-data.ts` (pure interval→row transform, unit-tested: category indexing, open-interval extension to sim-time — never `Date.now()` — duration math). `GET /api/timeline` clamps to shift window via `v_shift_windows`, exposes break metadata for hatched shading. Human walkthrough step 3 confirmed alternating green/red/amber bands with break shading live. |
| 4 | Inject Breakdown triggers a visible cascade (OEE drop, andon tile red) within seconds | ✓ VERIFIED | `POST /api/control/inject` is a thin proxy to the simulator's control server (`SIMULATOR_URL`); `InjectButton` mounted on andon tiles and the timeline header. Live proxy call verified in docker (200 in 231ms; andon showed DOWN 3s later; timeline showed `injected:true`). **Human walkthrough step 4 (recorded sign-off in 03-03-SUMMARY.md) confirmed the full cascade**: click Inject on L2 → timeline red INJECTED band → andon L2 tile red with reason → OEE L2 availability visibly dropped, all within ~5 real seconds. This is a genuine human-exercised behavioral proof of the state-transition/cascade invariant, not presence-only evidence. |

**Score:** 4/4 truths verified (0 present-but-behavior-unverified — the one behavior-dependent truth, #4, already has recorded human behavioral evidence per 03-03-SUMMARY.md's blocking checkpoint, so it is not re-flagged for human verification).

### Supporting Plan-Level Must-Haves

| Plan | Truth | Status | Evidence |
|------|-------|--------|----------|
| 03-01 | `GET /api/stream` is a working SSE endpoint (nodejs runtime, force-dynamic, 15s ping, clean abort close) | ✓ VERIFIED | `apps/web/src/app/api/stream/route.ts`: `runtime="nodejs"`, `dynamic="force-dynamic"`, `PING_INTERVAL_MS=15_000`, `request.signal` `abort` → `cleanup()` unsubscribes + clears interval + closes (double-close guarded). WR-02 fix (try/catch around `enqueue`) confirmed present in code (commit `144f567`). |
| 03-01 | One shared pg LISTEN connection fans out via in-process EventEmitter; web never writes to Postgres | ✓ VERIFIED | `apps/web/src/lib/listener.ts`: globalThis-cached singleton, dedicated unpooled `pg.Client`, `LISTEN linelens`, reconnect-with-backoff. Grep for `.create(/.update(/.delete(/.upsert(` under `apps/web/src` returned zero matches — read-only discipline holds. |
| 03-01 | `use-live` hook: EventSource with reconnect + 5s polling fallback | ✓ VERIFIED | `apps/web/src/hooks/use-live.ts` + `apps/web/test/use-live.test.ts` (2 passing tests: debounced refetch on change event; error→poll→reconnect→stop-poll transition, mocked `EventSource`, fake timers). |
| 03-02 | Andon board live, no reload | ✓ VERIFIED | See truth 1 above. |
| 03-02 | OEE waterfall + N/A semantics | ✓ VERIFIED | See truth 2 above; `apps/web/test/oee-waterfall.test.ts` (3 passing tests incl. N/A-not-0% and ENG-05 floor). |
| 03-02 | `ict_misconfigured` visible warning badge | ✓ VERIFIED | `components/oee/kpi-tiles.tsx`: amber `Badge` "Check Ideal Cycle Time" with domain-literacy tooltip, rendered only when `ictMisconfigured` true; never clamps Performance. |
| 03-03 | Timeline state bands live | ✓ VERIFIED | See truth 3 above; `apps/web/test/timeline-data.test.ts` (2 passing tests, 6-interval/2-machine fixture). |
| 03-03 | Inject Breakdown → visible cascade within seconds | ✓ VERIFIED | See truth 4 above. |
| 03-03 | Human watched the full cascade and signed off | ✓ VERIFIED | 03-03-SUMMARY.md coverage item D3: user ran all 5 walkthrough steps against a live docker stack, all passed, explicit sign-off recorded. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/app/api/stream/route.ts` | SSE route: ReadableStream, ping, abort cleanup | ✓ VERIFIED | Present, substantive, wired to `listener.ts`'s emitter; consumed by `use-live.ts`. |
| `apps/web/src/lib/listener.ts` | LISTEN singleton → EventEmitter | ✓ VERIFIED | Present, substantive, globalThis-cached, reconnect backoff. |
| `apps/web/src/app/api/andon/route.ts` | Per-line state/counts/target read model | ✓ VERIFIED | Present, substantive; CR-01 fix (`toISOString()` binding) confirmed in current code. |
| `apps/web/src/app/api/oee/route.ts` | OEE view read model | ✓ VERIFIED | Present, substantive, thin pass-through of `v_line_shift_oee`/`v_machine_shift_oee`. |
| `apps/web/src/app/api/timeline/route.ts` | State-interval read model clamped to shift | ✓ VERIFIED | Present, substantive; widened response shape (shiftStart/End/breaks/intervals) documented as an intentional deviation. |
| `apps/web/src/app/api/sim-clock/route.ts` | `{simNow, speed}` | ✓ VERIFIED | Present; single documented `sim-tz-ok` waiver for the scalar clock read. |
| `apps/web/src/hooks/use-live.ts` | Live-refetch hook | ✓ VERIFIED | Present, substantive, unit-tested. |
| `apps/web/src/app/(dashboard)/andon/page.tsx` | Live andon board page | ✓ VERIFIED | Present, wired to `/api/andon` + `useLive`. |
| `apps/web/src/app/(dashboard)/oee/page.tsx` | OEE waterfall page with pickers | ✓ VERIFIED | Present, wired to `/api/oee` + `useLive`. |
| `apps/web/src/components/timeline/gantt.tsx` | ECharts custom-series Gantt | ✓ VERIFIED | Present, substantive, unit-tested transform layer. |
| `apps/web/src/app/api/control/inject/route.ts` | Thin proxy to simulator inject-breakdown | ✓ VERIFIED | Present; forwards `{lineId}` to `SIMULATOR_URL`, no direct MQTT/DB write from web. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| worker `NOTIFY 'linelens'` | browser `EventSource` | pg LISTEN → EventEmitter → SSE | ✓ WIRED | `listener.ts` LISTENs and emits `'change'`; `stream/route.ts` subscribes and `enqueue`s SSE frames; `use-live.ts` consumes via `EventSource`. |
| `inject-button` | simulator `/control/inject-breakdown` | `POST /api/control/inject` proxy | ✓ WIRED | `inject-button.tsx` → `fetch('/api/control/inject', {lineId})` → server-side `fetch(SIMULATOR_URL + '/control/inject-breakdown')`. Verified live in docker (200 response, cascade observed). |
| `/api/andon`, `/api/oee`, `/api/timeline` | Postgres | Prisma `$queryRaw`/`findMany` against `v_shift_windows`, `v_line_shift_oee`, `v_machine_shift_oee`, `state_interval` | ✓ WIRED / FLOWING | All three routes issue real queries against Phase-2 views/tables; no static/mock returns found. |

### Sim-Time SQL Contract Gate

`grep -rn "sim_now()" apps/web/src/app/api apps/web/src/lib | grep -v "AT TIME ZONE 'UTC'" | grep -v "sim-tz-ok:"` → **no output** (gate clean). The one legitimate uncast use (`/api/sim-clock`) carries the `-- sim-tz-ok: scalar clock read, no comparison` marker as required.

CR-01 (raw `Date` object bound into a sim-time SQL comparison in `andon/route.ts`) — **fixed** in commit `fd36da1`, confirmed present in current code (`.toISOString()` on both bounds).

### Hard-Rule Compliance

| Rule | Status | Evidence |
|------|--------|----------|
| No `Date.now()` in derivation code | ✓ PASS | All `Date.now()` occurrences are in `use-sim-clock.ts` (explicitly documented as wall-clock-for-local-interpolation-only, never derivation) or comments. |
| Sim-time SQL cast discipline | ✓ PASS | Gate above is clean; CR-01 fixed. |
| N/A never 0 | ✓ PASS | `oee-waterfall.ts`, `kpi-tiles.tsx`, `andon/tile.tsx` all render `null`/N/A distinctly from `0`; unit-tested (`oee-waterfall.test.ts`). |
| `apps/web` read-only against Postgres | ✓ PASS | Zero `.create(`/`.update(`/`.delete(`/`.upsert(` matches under `apps/web/src`. |
| ENG-01 (worker sole MQTT consumer; web fans out via LISTEN/NOTIFY) | ✓ PASS | `listener.ts` is LISTEN-only; no MQTT client anywhere in `apps/web`. |
| ENG-05 (Performance > 100% flagged, never clamped) | ✓ PASS | `ictMisconfigured` surfaced as a badge; `kpi-tiles.tsx` renders raw Performance value uncapped. |

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full monorepo test suite (run once, under Node 24 per `package.json` `engines`) | `volta run --node 24.10.0 -- pnpm vitest run` | 25 test files / 95 tests passed (0 failed) | ✓ PASS |
| `apps/web` typecheck | `pnpm -r run typecheck` (apps/web scope) | `apps/web typecheck: Done` | ✓ PASS |
| `apps/worker` typecheck | same command | 15 pre-existing `TS7006` implicit-any errors (unrelated to Phase 3, confirmed pre-existing via `git stash` in 03-02, logged as WINDOWS entry 2) | ℹ️ INFO (not a Phase-3 regression) |

Note: an initial local run under the default-pinned Node 20.20.2 failed 5 suites (jsdom/testcontainers `webidl` incompatibility) — this was an environment mismatch (this repo requires Node ≥24), not a code defect; re-run under Node 24 via `volta run` passed cleanly and reproduces the "25 files / 95 tests, all green" regression state already reported.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DASH-01 | 03-02 | Real-time OEE waterfall (A×P×Q) per line/shift | ✓ SATISFIED | Truth 2 above. |
| DASH-03 | 03-03 | Color-coded production timeline per line | ✓ SATISFIED | Truth 3 above. |
| DASH-04 | 03-02 | Andon board, all lines, live via SSE | ✓ SATISFIED | Truth 1 above. |
| SIM-05 | 03-03 | Inject Breakdown (HTTP + dashboard button), watch cascade live | ✓ SATISFIED | Truth 4 above. |

No orphaned requirements — REQUIREMENTS.md's traceability table maps exactly DASH-01, DASH-03, DASH-04, SIM-05 to Phase 3, matching the four requirement IDs declared across the three plans' frontmatter. DASH-02 (Pareto) is correctly scoped to Phase 4, not claimed here.

### Anti-Patterns Found

No `TBD`/`FIXME`/`XXX` markers found in any Phase 3 file. No stub returns, empty handlers, or hardcoded-empty rendering paths found in the reviewed artifacts. The code review (03-REVIEW.md) found one Critical (CR-01) and six Warnings; the Critical and one Warning (WR-02, unguarded SSE enqueue) were fixed post-review (commits `fd36da1`, `144f567`) and confirmed fixed in the current code during this verification. The remaining four Warnings + two Info items (WR-01/03/04/05/06, IN-01/02) are explicitly deferred by user decision and tracked as open items in `.planning/WINDOWS.md` (entries 2–7) — none of them contradicts or undermines the four Phase 3 success criteria; they are code-quality/robustness/observability gaps (duplicated boilerplate, client-only rate limiting on a low-risk demo endpoint, `console.*` instead of `pino`, a documented and deliberately-accepted empty-shift UX edge case).

### Human Verification Required

None. The one behavior-dependent truth in this phase (the Inject Breakdown cascade, a genuine state-transition/cascade invariant that presence/wiring checks alone cannot prove) already has recorded, in-scope human verification: the blocking checkpoint in 03-03-PLAN.md Task 3 was executed, and the user's sign-off ("all 5 steps passed") is documented in `03-03-SUMMARY.md`'s Human Verification section and coverage item D3. Re-running this check was explicitly out of scope for this verification per the task's stated context.

### Gaps Summary

None. All four roadmap Success Criteria for Phase 3 are verified by a combination of static code inspection, unit tests (25/25 files passing under the correct Node runtime), and previously-recorded human behavioral sign-off on the live cascade. The one Critical code-review finding (sim-time SQL contract violation, CR-01) was fixed and confirmed fixed in the current codebase. All remaining deferred items are logged, tracked, and do not undermine any success criterion.

---

_Verified: 2026-08-22T21:45:00Z_
_Verifier: Claude (gsd-verifier)_
