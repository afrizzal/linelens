---
phase: 03-live-dashboard
plan: 3
subsystem: web-ui
tags: [echarts, custom-series, gantt, mqtt-proxy, sse, andon, timeline, inject-breakdown]

# Dependency graph
requires:
  - phase: 03-live-dashboard
    plan: 1
    provides: "GET /api/timeline read-model route; useLive SSE hook"
  - phase: 03-live-dashboard
    plan: 2
    provides: "(dashboard) route shell, stateColor()/stateLabel() single source of truth, hand-rolled ECharts wrapper pattern, andon tile component"
provides:
  - "/timeline — live production Gantt (DASH-03): ECharts custom-series renderItem, per-machine state bands, break shading, dataZoom, INJECTED tooltip tag"
  - "POST /api/control/inject — thin proxy to the simulator's inject-breakdown control endpoint (SIM-05)"
  - "InjectButton component mounted on both the andon tile header and the timeline page header"
  - "Human-verified end-to-end cascade: inject breakdown -> timeline red band -> andon tile red -> OEE availability drop, all within seconds"
affects: [04-orders-losses-dds]

# Actuals (#2632)
actuals:
  tokens: 5238
  tasks: 3
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ECharts custom series (renderItem) for a Gantt/timeline: y=machine categoryIndex, x=sim time clamped to shift window, rect geometry built from api.coord()/api.size() per the official ECharts custom-series Gantt pattern (verified via Context7 before writing, per the plan's flagged-risk spike-first instruction). Chart-data transform isolated in lib/timeline-data.ts (interval rows -> renderItem-ready shapes, open-interval extension to sim-time, duration math) so the canvas-touching component stays a thin renderer over a pure, unit-tested core — same split as 03-02's lib/oee-waterfall.ts."
    - "Web-tier control actions are always a thin proxy: POST /api/control/inject does nothing but forward {lineId} to SIMULATOR_URL/control/inject-breakdown server-side. The browser never talks to the simulator container directly — same boundary the ARCHITECTURE doc draws around MQTT/DB writes."
    - "Client-rate-limited demo controls (InjectButton disables itself 10s after use) are enough guardrail for a single-operator portfolio demo — no server-side rate limiting needed at this scale."

key-files:
  created:
    - apps/web/src/components/timeline/gantt.tsx
    - apps/web/src/lib/timeline-data.ts
    - "apps/web/src/app/(dashboard)/timeline/page.tsx"
    - apps/web/src/app/api/control/inject/route.ts
    - apps/web/src/components/inject-button.tsx
    - apps/web/test/timeline-data.test.ts
  modified:
    - apps/web/src/app/api/timeline/route.ts
    - apps/web/src/components/andon/tile.tsx

key-decisions:
  - "GET /api/timeline response widened from a bare interval array to include shift-window/break-calendar metadata (Rule 2 deviation) — the Gantt's hatched break-shading and x-axis clamping both need it and it wasn't exposed by 03-01's route."
  - "InjectButton mounted in two places (andon tile hover strip + timeline page header) per the plan's dual-mount note, coordinating with 03-02's already-merged tile component rather than adding a shared render-slot abstraction."

patterns-established:
  - "ECharts custom-series renderItem is now proven end-to-end for LineLens's one Gantt-shaped need — no future plan should reach for a second charting library or a hand-rolled SVG timeline."

requirements-completed: [DASH-03, SIM-05]

coverage:
  - id: D1
    description: "Production timeline Gantt (DASH-03): color-coded state bands per machine over the shift window, live via useLive, tooltip with state/reason/duration/INJECTED tag, hatched break shading, dataZoom slider"
    requirement: "DASH-03"
    verification:
      - kind: unit
        ref: "apps/web/test/timeline-data.test.ts — 6-interval fixture (2 machines, open-interval extension to sim-time, injected flag, duration math) renders correct token-colored rows"
        status: pass
      - kind: manual_procedural
        ref: "Human walkthrough step 3 (docker, fresh stack): L2 showed alternating green/red/amber bands with break shading, live"
        status: pass
    human_judgment: true
    rationale: "Visual correctness of a canvas-rendered Gantt (band colors, break shading, tooltip content) cannot be fully confirmed by a component fixture test alone — needed a human looking at the live chart."
  - id: D2
    description: "Inject Breakdown control (SIM-05): POST /api/control/inject proxies to the simulator; button rate-limited client-side; visible cascade within seconds"
    requirement: "SIM-05"
    verification:
      - kind: manual_procedural
        ref: "Direct proxy call verified live in docker during Task 2: POST /api/control/inject {lineId:\"L3\"} -> 200 in 231ms; GET /api/andon 3s later showed L3 DOWN/BRK-MECH; GET /api/timeline showed the new interval with injected:true"
        status: pass
      - kind: manual_procedural
        ref: "Human walkthrough step 4 (the cascade): click Inject on Line 2 -> timeline grew a red INJECTED band, andon L2 tile turned red with reason, OEE L2 availability visibly dropped on refetch"
        status: pass
    human_judgment: true
    rationale: "The 'dramatic beat' of the demo is precisely the visible, timed cascade across three separate screens — that is a human-perception claim, not something a curl/API check can certify on its own."
  - id: D3
    description: "Human walkthrough sign-off: all 5 steps of the vertical-slice cascade confirmed live against a running docker stack by the user"
    verification:
      - kind: manual_procedural
        ref: "User ran all five steps against the live docker stack and reported all passed (see Human Verification section below)"
        status: pass
    human_judgment: true
    rationale: "This is the plan's own checkpoint gate — by definition only a human can grant sign-off on the full-slice demo experience."

# Metrics
duration: 25min
completed: 2026-08-22
status: complete
---

# Phase 3 Plan 3: Production Timeline + Inject Breakdown + Human Walkthrough Summary

**The flagged-risk ECharts custom-series Gantt renders live per-machine state bands with break shading, the Inject Breakdown control wires the demo's dramatic beat end-to-end, and a human has watched and confirmed the full cascade across all three screens on a live docker stack.**

## Performance

- **Duration:** ~25 min (Tasks 1-2 automated execution + human verification turnaround)
- **Tasks:** 3/3 complete (2 auto, 1 checkpoint)
- **Files modified:** 8 (6 created, 2 modified)

## Accomplishments

- **Production timeline** (`/timeline`, DASH-03): ECharts custom-series (`renderItem`) Gantt — y-axis machines of the selected line, x-axis sim time clamped to the shift window, rect bands filled via the shared `stateColor()` token so the timeline can never disagree with the andon board on what a color means. Open (still-running) intervals extend live to sim-now. Tooltip shows state, reason label, sim-minute duration, and an `INJECTED` tag when applicable. Breaks render as hatched `markArea` bands from shift-calendar metadata so Planned Production Time semantics are visible, not just implied. `dataZoom` x-axis slider. The chart-data transform (interval rows -> renderItem-ready shapes, open-interval extension, duration math) is isolated in `lib/timeline-data.ts`, kept canvas-free and unit-tested — the same split 03-02 used for the OEE waterfall.
- **Inject Breakdown control** (SIM-05): `POST /api/control/inject {lineId}` is a thin server-side proxy to the simulator's `/control/inject-breakdown` endpoint (`SIMULATOR_URL` env, already provisioned in docker-compose) — the browser never talks to the simulator container directly, preserving the ARCHITECTURE boundary. `InjectButton` is a prominent red, client-rate-limited (disabled 10s after use) button with an inline toast, mounted on both the andon tile hover strip and the timeline page header.
- **Human-verified cascade** (Task 3, the plan's closing checkpoint): the user ran the full 5-step walkthrough against a live `docker compose up` stack and confirmed all steps passed — see Human Verification below. This closes out Phase 3's core deliverable: the demo's signature 30 seconds ("machine downtime = broken customer promises") now exists and works, live, end-to-end.

## Task Commits

1. **Task 1: ECharts Gantt spike -> timeline component (DASH-03)** - `cf5393f` (feat)
2. **Task 2: Inject Breakdown control (SIM-05)** - `95ce88a` (feat)
3. **Task 3: Human walkthrough — the vertical slice cascade** - checkpoint, no code commit (see Human Verification below); prior checkpoint-finding bookkeeping landed in `23eb5d0` (docs, not part of this plan's task list but recorded during this checkpoint)

**Plan metadata:** (this commit)

## Files Created/Modified

- `apps/web/src/components/timeline/gantt.tsx` - ECharts custom-series Gantt component (renderItem-based rect geometry, dataZoom, tooltip, break markArea)
- `apps/web/src/lib/timeline-data.ts` - pure interval-rows -> renderItem-shape transform, unit-tested in isolation from the chart
- `apps/web/src/app/(dashboard)/timeline/page.tsx` - line + shift picker consistent with the OEE page, live via `useLive`; also hosts the timeline-header `InjectButton` mount
- `apps/web/src/app/api/timeline/route.ts` - widened response to include shift-window/break-calendar metadata (deviation, see 03-01-PLAN patch note below)
- `apps/web/src/app/api/control/inject/route.ts` - thin proxy `POST` handler to the simulator control server
- `apps/web/src/components/inject-button.tsx` - rate-limited demo control with toast
- `apps/web/src/components/andon/tile.tsx` - added the andon-tile-header `InjectButton` mount
- `apps/web/test/timeline-data.test.ts` - 6-interval fixture test covering 2 machines, open-interval extension, injected flag, duration math

## Decisions Made

- `GET /api/timeline` widened from a bare interval array to include shift-window/break-calendar metadata (Rule 2 — missing critical functionality) because the Gantt's break shading and x-axis clamping both require shift-boundary data that 03-01's route never exposed.
- `InjectButton` mounted in two places per the plan's own dual-mount instruction, coordinating directly with 03-02's already-merged `tile.tsx` rather than introducing a new shared render-slot prop abstraction — kept the integration surface small since both plans landed in the same wave.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - missing critical functionality] `GET /api/timeline` didn't expose shift-window/break-calendar metadata**
- **Found during:** Task 1, building the break-shading (`markArea`) and x-axis-clamp requirements from the plan's own `<action>`.
- **Issue:** 03-01's route returned only the raw interval rows — no shift start/end or break-calendar data for the chart to clamp against or shade.
- **Fix:** Widened the route's JSON response to include shift-window and break-calendar metadata alongside the interval array; no schema change, response-shape addition only.
- **Files modified:** `apps/web/src/app/api/timeline/route.ts`
- **Committed in:** `cf5393f`

---

**Total deviations:** 1 auto-fixed (missing-functionality). No architectural changes, no user decisions required beyond the plan's own checkpoint.

## Human Verification

**Task 3 checkpoint: APPROVED.** The user ran all five walkthrough steps against the live docker stack and reported: *"saya sudah test Step 1-5 sudah sesuai semua"* — steps 1 through 5 all behaved as specified. This is a genuine human-verified sign-off (visual/click-through confirmation), distinct from the automated API-level checks the prior agent ran during Tasks 1-2.

Steps confirmed:
1. Andon board — 4 lines, mixed plausible states, counts climbing, sim clock ticking at 60x.
2. OEE page — L1 high (near/above the showcase target), L4 below 45%, waterfall identity (PPT − losses = productive) holds.
3. Timeline — L2 Gantt bands with break shading, tooltip, dataZoom — the flagged-risk ECharts custom-series task, confirmed working live.
4. **The cascade** (the demo's core beat) — Inject breakdown on Line 2 -> timeline grows a red `INJECTED` band -> andon tile turns red with reason -> L2 availability visibly drops on `/oee`. All observed within seconds, as specified.
5. Recovery — `docker compose restart worker` -> live updates resumed within ~15s (SSE reconnect behaved as designed).

Phase 3's success criteria — andon/waterfall/timeline live, inject-breakdown cascades visibly within seconds, human-verified — is now met in full.

## Known Deferred Item (found at this checkpoint, not a defect in this plan)

During walkthrough step 2 the user hit a blank OEE page. This was diagnosed as a **correct** N/A render, not a bug: the sim runs at 60x, and shifts (S1 07:00-15:00, S2 15:00-23:00) leave sim 23:00-07:00 — 8 of every 24 real minutes — with no active shift at all. In that window `/api/oee` correctly returns `line: null` and the page correctly shows N/A per the project's "N/A never 0" rule (verified live: the same query returned OEE 91.3% once a shift was active again).

It is a **demo-credibility** concern (a viewer has roughly a 1-in-3 chance of landing on a blank screen during a 60-second demo), not a correctness defect, and does not block Phase 3. Already recorded — not duplicated here:
- `.planning/phases/03-live-dashboard/deferred-items.md` (commit `23eb5d0`)
- WINDOWS.md ledger entry 3 (`unmet-truth`, open), pointing at `apps/web/src/app/(dashboard)/oee/page.tsx:83`

## Issues Encountered

None beyond the deferred item above, which was explicitly triaged by the user as a non-blocker at the checkpoint.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The ECharts custom-series `renderItem` pattern is now proven end-to-end (spike -> real component -> live human verification) — Phase 4's Six Big Losses Pareto can reuse the same hand-rolled ECharts wrapper conventions from `components/oee/waterfall.tsx` / `components/timeline/gantt.tsx` without re-derisking the library choice.
- The `POST /api/control/*` thin-proxy pattern (web forwards to `SIMULATOR_URL`, never talks to the simulator container directly) is established and reusable for any future demo controls.
- Phase 3's vertical slice (andon + waterfall + timeline + inject-breakdown cascade) is complete and human-verified. The deferred OEE-empty-shift default (see above) is flagged for pickup in a future phase or backlog item — not blocking.

## Self-Check: PASSED

All 8 created/modified files verified present on disk; both task commits (`cf5393f`, `95ce88a`) verified present in `git log`; the intervening checkpoint-finding commit `23eb5d0` also verified present.

---
*Phase: 03-live-dashboard*
*Completed: 2026-08-22*
</content>
