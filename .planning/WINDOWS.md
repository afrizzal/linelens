---
schema_version: 1
open_count: 12
waived_count: 0
fixed_count: 2
total_count: 14
last_updated: 2026-08-23T11:25:36.510Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 03 | unrun-verify | apps/web/src/app/api/andon/route.ts |  | Task 2 in-docker <verify> (spot-check andon vs mosquitto_sub) could not run: /api/andon, /api/oee, /api/timeline, /api/sim-clock all return HTTP 500 in docker's next dev — Turbopack cannot resolve packages/db/generated/prisma/client.ts through the @linelens/db workspace package chain. See 03-01-SUMMARY.md Known Issues. | fixed |  | 2026-08-22T09:31:10.865Z | 2026-08-22T10:25:07.831Z |
| 2 | 03 | lint-warning | apps/worker/src/derive/prisma-store.ts |  | Pre-existing tsc implicit-any errors (15 across prisma-store.ts/runner.ts/golden.test.ts) unrelated to 03-02; confirmed via git stash. Runtime/tests unaffected (93/93 pass). | open |  | 2026-08-22T11:02:09.075Z |  |
| 3 | 03 | unmet-truth | apps/web/src/app/(dashboard)/oee/page.tsx | 83 | OEE page default lands on an empty shift ~1/3 of the time. Sim runs 60x; shifts are S1 07:00-15:00 and S2 15:00-23:00, so sim 23:00-07:00 (8 of every 24 real minutes) has no active shift. /api/andon then reports no active shift and the page falls back to 'sim today + S1', which has zero production, so the whole page renders N/A. The N/A itself is CORRECT (project rule: N/A not 0 when no shift) - this is demo credibility, not a correctness defect. Two fixes needed: (1) default to the most recent shift WITH data rather than sim-today+S1; (2) shiftDate is seeded once via setShiftDate(prev => prev \|\| ...) and never follows a sim-day rollover, so a long-open dashboard silently shows a stale date. Check timeline/page.tsx for the same default pattern. Deferred at the 03-03 human checkpoint by explicit user decision. | open |  | 2026-08-22T13:30:10.932Z |  |
| 4 | 03 | unmet-truth | apps/web/src/app/(dashboard)/timeline/page.tsx |  | Second, un-deferred instance of the shift-date rollover seeding bug (WINDOWS entry 3 covers only oee/page.tsx:83). Same pattern: shiftDate seeded once on mount and never follows a sim-day rollover. Code review 03-REVIEW.md WR-01. Deferred with entry 3 - fix both together. | open |  | 2026-08-22T14:15:59.905Z |  |
| 5 | 03 | unmet-truth | apps/web/src/app/api/control/inject/route.ts |  | POST /api/control/inject rate limiting is client-side only, no server-side enforcement. Code review 03-REVIEW.md WR-03. Demo appliance with allow_anonymous MQTT so low risk, but the endpoint is reachable by anyone who can load the page. Deferred by user decision at the phase-03 code-review gate. | open |  | 2026-08-22T14:16:02.301Z |  |
| 6 | 03 | todo | apps/web/src/app/api/stream/route.ts |  | console.* logging used in the SSE route and lib/listener.ts instead of the project-mandated pino structured logger (STACK.md); pino is not installed in apps/web. Code review 03-REVIEW.md WR-04. Deferred by user decision at the phase-03 code-review gate. | open |  | 2026-08-22T14:16:04.239Z |  |
| 7 | 03 | todo | apps/web/src/app/(dashboard)/oee/page.tsx |  | Duplicated line/shift selector boilerplate and a duplicated formatPct helper across oee/page.tsx and timeline/page.tsx. Code review 03-REVIEW.md WR-05/WR-06 plus Info findings IN-01 (unused lineId option on useLive) and IN-02 (no zod validation at the client fetch boundary). Deferred by user decision at the phase-03 code-review gate. | open |  | 2026-08-22T14:16:05.797Z |  |
| 8 | 04 | unrun-verify | apps/web/src/app/(dashboard)/orders/page.tsx |  | Plan 04-01 Task 3 <verify> 'inject-breakdown on a line, wait ~1 sim-day -> that line's product shows lower DIFOT contribution' was not observed live within the executor's time budget. Indirect confidence: a live ~90min sim run already produced natural AT_RISK orders on CYC-C, and the fixture-level FIFO/status unit tests cover all four v_order_status branches. | open |  | 2026-08-23T02:29:47.920Z |  |
| 9 | 04 | unrun-verify | apps/web/src/app/(dashboard)/orders/[id]/page.tsx |  | Plan 04-02 overall <verification> 'Live demo check: inject on L2 -> within ~1 sim-day an L2-product order shows LATE with the injected breakdown top-ranked in its drill-down' was not observed against the running docker compose stack within the executor's time budget (Task 3's causality.test.ts proves the mechanism against the real pipeline instead -- 4/4 tests green). Live spot-check DID confirm /api/orders/[id] returns real order_loss_drilldown data (12 ranked loss rows, correct shape) for an existing ON_TIME order against a live docker stack. | open |  | 2026-08-23T05:48:13.149Z |  |
| 10 | 04 | todo | apps/worker/src/orders/allocate.ts |  | allocateGoodProduction re-fetches every open order's full allocation list (findMany with include:allocations) on EVERY COUNTS event with goodDelta>0 -- cost grows with open-order backlog depth. Confirmed as a real, reproducible scaling characteristic while building 04-02 Task 3's causality test: a full 8-machine/48-sim-hour scenario did not finish within a 30-minute budget; a scoped-down 4-machine/16-sim-hour scenario took ~5-8 min per run. Already partially mitigated by 04-01's 5s->30s transaction timeout bump. Not blocking at demo scale (a handful of lines/machines, bounded sim history per PROJECT.md), but would need a scoped/paginated open-orders query before a much larger order book or longer-running deployment. | open |  | 2026-08-23T05:48:14.058Z |  |
| 11 | 04 | unrun-verify | apps/web/src/app/api/dds/route.ts |  | Live docker check of /api/dds's non-null Delivery path (DIFOT%/lateCount populated, and a line DIFOT<80% escalation firing) was not observed within the executor's time budget -- the pinned warm-start sim-day (2026-01-05) has zero orders due yet (due dates start 2026-01-07+), so the live spot-check only exercised the N/A path (which caught and fixed a real 0-vs-null bug, see 9d516fe). Indirect confidence: /api/orders?day=2026-01-08 confirmed real DIFOT 72.7% (11 due, 8 on-time) data exists in the running stack for when sim time reaches that day, and deriveEscalations/generateDdsActions have 18 unit tests covering the non-null paths including the exact DIFOT<80% threshold. | fixed |  | 2026-08-23T06:20:34.691Z | 2026-08-23T08:33:14.015Z |
| 12 | quick-260823-jre | todo | tests/smoke/compose-stack.spec.ts |  | The Phase-1 compose smoke suite is not re-runnable against a long-lived stack: 'inject-breakdown is accepted and takes a real machine down' POSTs to /control/inject-breakdown on L1, but apps/simulator/src/control.ts:77 returns 404 'no injectable machine found' when that line's machine is already down from an earlier run. Reproduced 2026-08-23: two prior injects left L1-M1 down until sim 2026-01-09 while the sim clock was ~2026-01-06, so a re-run failed 2/11 (this test plus the Sparkplug telemetry test). Fresh-stack runs pass. Fix options: target a line with an available machine, release the injected breakdown in an afterEach, or assert 404-with-that-message as an acceptable already-down outcome. | open |  | 2026-08-23T08:48:43.956Z |  |
| 13 | 04 | unrun-verify | tests/smoke/phase4-screens.spec.ts |  | CR-01's regression guard has never executed. The code-review fix 4650a12 (timeline shift-picker sentinel) added a shift-convergence assertion to the 'drill-down money shot' smoke test, but that test test.skip()s whenever no LATE/AT_RISK order exists, and it skipped on every verification run after the fix (2026-08-23). The fix itself is verified by typecheck, next build (/timeline still prerenders static), apps/web vitest 7 files/34 tests green, and code reading -- but the assertion that would catch a reintroduction of CR-01 is unproven. It HAS run before (the quick-task executor's earlier run hit a genuine LATE order), so this resolves itself once sim time produces one; forcing it via breakdown injection is explicitly forbidden (v_order_status's COALESCE(NULLIF(recent.goodPerSec,0), fallback.goodPerSec, 0) makes a fully-downed product fall back to the ideal rate and read healthy). Re-run pnpm test:smoke on a stack whose sim clock has produced a LATE order and confirm test 9 passes rather than skips. | open |  | 2026-08-23T09:41:22.149Z |  |
| 14 | 04 | todo | docker-compose.yml |  | Restarting the compose stack desynchronizes the sim clock from accumulated event history. The simulator warm-starts from WARM_START_DAY (2026-01-05) on every container start, but the Postgres volume keeps events from prior runs that reached later sim times. Observed 2026-08-23 after several docker compose stop/start cycles: machine_event max simTime = 2026-01-11 12:17 while sim_now() = 2026-01-10 16:34 -- roughly 20 sim-hours of data sitting in the future relative to the clock. Symptoms: /api/andon reports every machine BREAK with a future 'since' timestamp, and POST /control/inject-breakdown returns 404 'no injectable machine found' because no machine is in EXECUTE, which blocks the inject-breakdown demo entirely. Does NOT affect a stranger running docker compose up once on a clean volume (the Phase-05 target scenario), but WILL affect Phase 05's GIF recording if the stack is restarted between takes. Workaround: docker compose down -v for a clean volume before a recording run. Proper fix would be for the worker/simulator to either resume the clock from max(machine_event.simTime) or refuse to warm-start over existing later history. | open |  | 2026-08-23T11:25:36.510Z |  |

````json
[
  {
    "id": 1,
    "kind": "unrun-verify",
    "phase": "03",
    "file": "apps/web/src/app/api/andon/route.ts",
    "line": null,
    "description": "Task 2 in-docker <verify> (spot-check andon vs mosquitto_sub) could not run: /api/andon, /api/oee, /api/timeline, /api/sim-clock all return HTTP 500 in docker's next dev — Turbopack cannot resolve packages/db/generated/prisma/client.ts through the @linelens/db workspace package chain. See 03-01-SUMMARY.md Known Issues.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-22T09:31:10.865Z",
    "resolved_at": "2026-08-22T10:25:07.831Z"
  },
  {
    "id": 2,
    "kind": "lint-warning",
    "phase": "03",
    "file": "apps/worker/src/derive/prisma-store.ts",
    "line": null,
    "description": "Pre-existing tsc implicit-any errors (15 across prisma-store.ts/runner.ts/golden.test.ts) unrelated to 03-02; confirmed via git stash. Runtime/tests unaffected (93/93 pass).",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-22T11:02:09.075Z",
    "resolved_at": null
  },
  {
    "id": 3,
    "kind": "unmet-truth",
    "phase": "03",
    "file": "apps/web/src/app/(dashboard)/oee/page.tsx",
    "line": 83,
    "description": "OEE page default lands on an empty shift ~1/3 of the time. Sim runs 60x; shifts are S1 07:00-15:00 and S2 15:00-23:00, so sim 23:00-07:00 (8 of every 24 real minutes) has no active shift. /api/andon then reports no active shift and the page falls back to 'sim today + S1', which has zero production, so the whole page renders N/A. The N/A itself is CORRECT (project rule: N/A not 0 when no shift) - this is demo credibility, not a correctness defect. Two fixes needed: (1) default to the most recent shift WITH data rather than sim-today+S1; (2) shiftDate is seeded once via setShiftDate(prev => prev || ...) and never follows a sim-day rollover, so a long-open dashboard silently shows a stale date. Check timeline/page.tsx for the same default pattern. Deferred at the 03-03 human checkpoint by explicit user decision.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-22T13:30:10.932Z",
    "resolved_at": null
  },
  {
    "id": 4,
    "kind": "unmet-truth",
    "phase": "03",
    "file": "apps/web/src/app/(dashboard)/timeline/page.tsx",
    "line": null,
    "description": "Second, un-deferred instance of the shift-date rollover seeding bug (WINDOWS entry 3 covers only oee/page.tsx:83). Same pattern: shiftDate seeded once on mount and never follows a sim-day rollover. Code review 03-REVIEW.md WR-01. Deferred with entry 3 - fix both together.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-22T14:15:59.905Z",
    "resolved_at": null
  },
  {
    "id": 5,
    "kind": "unmet-truth",
    "phase": "03",
    "file": "apps/web/src/app/api/control/inject/route.ts",
    "line": null,
    "description": "POST /api/control/inject rate limiting is client-side only, no server-side enforcement. Code review 03-REVIEW.md WR-03. Demo appliance with allow_anonymous MQTT so low risk, but the endpoint is reachable by anyone who can load the page. Deferred by user decision at the phase-03 code-review gate.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-22T14:16:02.301Z",
    "resolved_at": null
  },
  {
    "id": 6,
    "kind": "todo",
    "phase": "03",
    "file": "apps/web/src/app/api/stream/route.ts",
    "line": null,
    "description": "console.* logging used in the SSE route and lib/listener.ts instead of the project-mandated pino structured logger (STACK.md); pino is not installed in apps/web. Code review 03-REVIEW.md WR-04. Deferred by user decision at the phase-03 code-review gate.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-22T14:16:04.239Z",
    "resolved_at": null
  },
  {
    "id": 7,
    "kind": "todo",
    "phase": "03",
    "file": "apps/web/src/app/(dashboard)/oee/page.tsx",
    "line": null,
    "description": "Duplicated line/shift selector boilerplate and a duplicated formatPct helper across oee/page.tsx and timeline/page.tsx. Code review 03-REVIEW.md WR-05/WR-06 plus Info findings IN-01 (unused lineId option on useLive) and IN-02 (no zod validation at the client fetch boundary). Deferred by user decision at the phase-03 code-review gate.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-22T14:16:05.797Z",
    "resolved_at": null
  },
  {
    "id": 8,
    "kind": "unrun-verify",
    "phase": "04",
    "file": "apps/web/src/app/(dashboard)/orders/page.tsx",
    "line": null,
    "description": "Plan 04-01 Task 3 <verify> 'inject-breakdown on a line, wait ~1 sim-day -> that line's product shows lower DIFOT contribution' was not observed live within the executor's time budget. Indirect confidence: a live ~90min sim run already produced natural AT_RISK orders on CYC-C, and the fixture-level FIFO/status unit tests cover all four v_order_status branches.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-23T02:29:47.920Z",
    "resolved_at": null
  },
  {
    "id": 9,
    "kind": "unrun-verify",
    "phase": "04",
    "file": "apps/web/src/app/(dashboard)/orders/[id]/page.tsx",
    "line": null,
    "description": "Plan 04-02 overall <verification> 'Live demo check: inject on L2 -> within ~1 sim-day an L2-product order shows LATE with the injected breakdown top-ranked in its drill-down' was not observed against the running docker compose stack within the executor's time budget (Task 3's causality.test.ts proves the mechanism against the real pipeline instead -- 4/4 tests green). Live spot-check DID confirm /api/orders/[id] returns real order_loss_drilldown data (12 ranked loss rows, correct shape) for an existing ON_TIME order against a live docker stack.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-23T05:48:13.149Z",
    "resolved_at": null
  },
  {
    "id": 10,
    "kind": "todo",
    "phase": "04",
    "file": "apps/worker/src/orders/allocate.ts",
    "line": null,
    "description": "allocateGoodProduction re-fetches every open order's full allocation list (findMany with include:allocations) on EVERY COUNTS event with goodDelta>0 -- cost grows with open-order backlog depth. Confirmed as a real, reproducible scaling characteristic while building 04-02 Task 3's causality test: a full 8-machine/48-sim-hour scenario did not finish within a 30-minute budget; a scoped-down 4-machine/16-sim-hour scenario took ~5-8 min per run. Already partially mitigated by 04-01's 5s->30s transaction timeout bump. Not blocking at demo scale (a handful of lines/machines, bounded sim history per PROJECT.md), but would need a scoped/paginated open-orders query before a much larger order book or longer-running deployment.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-23T05:48:14.058Z",
    "resolved_at": null
  },
  {
    "id": 11,
    "kind": "unrun-verify",
    "phase": "04",
    "file": "apps/web/src/app/api/dds/route.ts",
    "line": null,
    "description": "Live docker check of /api/dds's non-null Delivery path (DIFOT%/lateCount populated, and a line DIFOT<80% escalation firing) was not observed within the executor's time budget -- the pinned warm-start sim-day (2026-01-05) has zero orders due yet (due dates start 2026-01-07+), so the live spot-check only exercised the N/A path (which caught and fixed a real 0-vs-null bug, see 9d516fe). Indirect confidence: /api/orders?day=2026-01-08 confirmed real DIFOT 72.7% (11 due, 8 on-time) data exists in the running stack for when sim time reaches that day, and deriveEscalations/generateDdsActions have 18 unit tests covering the non-null paths including the exact DIFOT<80% threshold.",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-23T06:20:34.691Z",
    "resolved_at": "2026-08-23T08:33:14.015Z"
  },
  {
    "id": 12,
    "kind": "todo",
    "phase": "quick-260823-jre",
    "file": "tests/smoke/compose-stack.spec.ts",
    "line": null,
    "description": "The Phase-1 compose smoke suite is not re-runnable against a long-lived stack: 'inject-breakdown is accepted and takes a real machine down' POSTs to /control/inject-breakdown on L1, but apps/simulator/src/control.ts:77 returns 404 'no injectable machine found' when that line's machine is already down from an earlier run. Reproduced 2026-08-23: two prior injects left L1-M1 down until sim 2026-01-09 while the sim clock was ~2026-01-06, so a re-run failed 2/11 (this test plus the Sparkplug telemetry test). Fresh-stack runs pass. Fix options: target a line with an available machine, release the injected breakdown in an afterEach, or assert 404-with-that-message as an acceptable already-down outcome.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-23T08:48:43.956Z",
    "resolved_at": null
  },
  {
    "id": 13,
    "kind": "unrun-verify",
    "phase": "04",
    "file": "tests/smoke/phase4-screens.spec.ts",
    "line": null,
    "description": "CR-01's regression guard has never executed. The code-review fix 4650a12 (timeline shift-picker sentinel) added a shift-convergence assertion to the 'drill-down money shot' smoke test, but that test test.skip()s whenever no LATE/AT_RISK order exists, and it skipped on every verification run after the fix (2026-08-23). The fix itself is verified by typecheck, next build (/timeline still prerenders static), apps/web vitest 7 files/34 tests green, and code reading -- but the assertion that would catch a reintroduction of CR-01 is unproven. It HAS run before (the quick-task executor's earlier run hit a genuine LATE order), so this resolves itself once sim time produces one; forcing it via breakdown injection is explicitly forbidden (v_order_status's COALESCE(NULLIF(recent.goodPerSec,0), fallback.goodPerSec, 0) makes a fully-downed product fall back to the ideal rate and read healthy). Re-run pnpm test:smoke on a stack whose sim clock has produced a LATE order and confirm test 9 passes rather than skips.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-23T09:41:22.149Z",
    "resolved_at": null
  },
  {
    "id": 14,
    "kind": "todo",
    "phase": "04",
    "file": "docker-compose.yml",
    "line": null,
    "description": "Restarting the compose stack desynchronizes the sim clock from accumulated event history. The simulator warm-starts from WARM_START_DAY (2026-01-05) on every container start, but the Postgres volume keeps events from prior runs that reached later sim times. Observed 2026-08-23 after several docker compose stop/start cycles: machine_event max simTime = 2026-01-11 12:17 while sim_now() = 2026-01-10 16:34 -- roughly 20 sim-hours of data sitting in the future relative to the clock. Symptoms: /api/andon reports every machine BREAK with a future 'since' timestamp, and POST /control/inject-breakdown returns 404 'no injectable machine found' because no machine is in EXECUTE, which blocks the inject-breakdown demo entirely. Does NOT affect a stranger running docker compose up once on a clean volume (the Phase-05 target scenario), but WILL affect Phase 05's GIF recording if the stack is restarted between takes. Workaround: docker compose down -v for a clean volume before a recording run. Proper fix would be for the worker/simulator to either resume the clock from max(machine_event.simTime) or refuse to warm-start over existing later history.",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-23T11:25:36.510Z",
    "resolved_at": null
  }
]
````

