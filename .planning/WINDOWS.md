---
schema_version: 1
open_count: 7
waived_count: 0
fixed_count: 1
total_count: 8
last_updated: 2026-08-23T02:29:47.920Z
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
  }
]
````

