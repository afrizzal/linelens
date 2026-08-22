---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 1
total_count: 3
last_updated: 2026-08-22T13:30:10.932Z
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
  }
]
````
