---
schema_version: 1
open_count: 1
waived_count: 0
fixed_count: 1
total_count: 2
last_updated: 2026-08-22T11:02:09.075Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 03 | unrun-verify | apps/web/src/app/api/andon/route.ts |  | Task 2 in-docker <verify> (spot-check andon vs mosquitto_sub) could not run: /api/andon, /api/oee, /api/timeline, /api/sim-clock all return HTTP 500 in docker's next dev — Turbopack cannot resolve packages/db/generated/prisma/client.ts through the @linelens/db workspace package chain. See 03-01-SUMMARY.md Known Issues. | fixed |  | 2026-08-22T09:31:10.865Z | 2026-08-22T10:25:07.831Z |
| 2 | 03 | lint-warning | apps/worker/src/derive/prisma-store.ts |  | Pre-existing tsc implicit-any errors (15 across prisma-store.ts/runner.ts/golden.test.ts) unrelated to 03-02; confirmed via git stash. Runtime/tests unaffected (93/93 pass). | open |  | 2026-08-22T11:02:09.075Z |  |

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
  }
]
````
