---
phase: 01-foundation-living-plant
plan: 1
subsystem: infra
tags: [pnpm, typescript, docker-compose, postgres, mosquitto, mqtt, next.js, vitest, monorepo]

# Dependency graph
requires: []
provides:
  - pnpm workspace monorepo (packages/contracts, packages/db, apps/simulator, apps/worker, apps/web)
  - TypeScript 5.9.3 strict base config shared across all packages/apps
  - docker-compose.yml with postgres:18 + eclipse-mosquitto:2.0.22 (healthchecked) + simulator/worker/web app services (gated on service_healthy)
  - Mosquitto configured with persistence true (required for QoS1 + clean:false session survival, per STACK.md)
  - .env.example documenting all runtime config (DATABASE_URL, MQTT_URL, SIM_SPEED, SIM_SEED, SIMULATOR_URL)
affects: [01-02 (simulator/state-machine plan will fill apps/simulator), 01-03, all later phases building on packages/contracts and packages/db]

# Tech tracking
tech-stack:
  added: [pnpm@10.34.4 workspaces, typescript@5.9.3, vitest@4.1.10, tsx@4.23.1, next@16.2.11, tailwindcss@4.3.3, postgres:18, eclipse-mosquitto:2.0.22]
  patterns:
    - "One tsconfig.base.json (strict, NodeNext, noUncheckedIndexedAccess) extended by every package/app tsconfig"
    - "Vitest 4 test.projects in root vitest.config.ts (workspace-file format deprecated in v4)"
    - "One docker/app.Dockerfile image, per-service `command` override (AIDA's proven shape)"

key-files:
  created:
    - package.json
    - pnpm-workspace.yaml
    - tsconfig.base.json
    - vitest.config.ts
    - docker-compose.yml
    - docker/app.Dockerfile
    - docker/mosquitto/mosquitto.conf
    - .env.example
    - packages/contracts/src/index.ts
    - packages/db/src/index.ts
    - apps/simulator/src/main.ts
    - apps/worker/src/main.ts
    - apps/web/ (create-next-app scaffold)
  modified: []

key-decisions:
  - "TypeScript pinned to 5.9.3 (not TS 7 native compiler) per STACK.md's documented fallback — TS 7 stable does not exist yet (only 7.1.0-dev nightlies on npm as of 2026-07-25), so 5.9.x is not a fallback-of-convenience but the only viable choice today."
  - "vitest.workspace.ts kept only as a re-export pointer to vitest.config.ts — Vitest 4 deprecated the standalone workspace-file format in favor of `test.projects` in the root config; the plan named the file explicitly so it was kept, but the working config lives in vitest.config.ts."
  - "Postgres volume mounted at /var/lib/postgresql (not .../data) — Postgres 18+ images require the parent directory per docker-library/postgres#1259 (pg_ctlcluster-compatible major-version-specific subdirectories); mounting directly at .../data crash-loops the container on 18+."
  - "apps/web scaffolded via `pnpm dlx create-next-app@16.2.11` rather than hand-written package.json, then trimmed (removed nested pnpm-workspace.yaml/CLAUDE.md/AGENTS.md that create-next-app generates) and repinned tailwindcss/typescript to the exact STACK.md versions."

patterns-established:
  - "Pattern: every package src/index.ts starts as `export {};` — no domain logic in this plan, deliberately."
  - "Pattern: one placeholder vitest test per package/app so `pnpm test` is meaningfully green from commit one, not just empty."

requirements-completed: []

# Metrics
duration: 55min
completed: 2026-07-25
---

# Phase 01 Plan 1: Monorepo + Docker Backbone Summary

**pnpm workspace monorepo (contracts/db packages + simulator/worker/web apps) on TypeScript 5.9.3, backed by a docker-compose stack running healthchecked postgres:18 and eclipse-mosquitto:2.0.22 with persistence enabled.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-07-25T12:03:00Z (approx, per STATE.md session start)
- **Completed:** 2026-07-25T12:25:21Z
- **Tasks:** 2/2
- **Files modified:** 43 (39 in Task 1, 4 in Task 2)

## Accomplishments
- Full pnpm workspace skeleton: `@linelens/contracts`, `@linelens/db`, `@linelens/simulator`, `@linelens/worker`, `@linelens/web` — all compile clean under one strict shared `tsconfig.base.json` and all have a passing placeholder test
- `docker-compose.yml` backbone: `postgres:18` and `eclipse-mosquitto:2.0.22` both reach `healthy` status within ~20s of `docker compose up -d db mqtt` (verified live, not just `docker compose config`)
- Mosquitto configured with `persistence true` + `persistence_location` — the STACK.md-flagged prerequisite for QoS1/`clean:false` session survival across broker restarts
- `simulator`/`worker`/`web` services share one `docker/app.Dockerfile` (node:24-slim + pnpm via corepack), each `depends_on: { condition: service_healthy }` on both db and mqtt, matching AIDA's proven one-image app+worker shape

## Task Commits

1. **Task 1: pnpm monorepo skeleton** - `7c8b52e` (feat)
2. **Task 2: docker compose backbone (postgres + mosquitto + app services)** - `24abaea` (feat)

**Plan metadata:** (this commit, pending)

## Files Created/Modified
- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `vitest.workspace.ts` - root workspace config
- `packages/contracts/{package.json,tsconfig.json,src/index.ts,test/placeholder.test.ts}` - contracts package skeleton
- `packages/db/{package.json,tsconfig.json,src/index.ts,test/placeholder.test.ts}` - db package skeleton
- `apps/simulator/{package.json,tsconfig.json,src/main.ts,test/placeholder.test.ts}` - simulator app skeleton (tsx-runnable)
- `apps/worker/{package.json,tsconfig.json,src/main.ts,test/placeholder.test.ts}` - worker app skeleton (tsx-runnable)
- `apps/web/` - Next.js 16.2.11 App Router + Tailwind 4.3.3 scaffold (create-next-app, trimmed + repinned)
- `docker-compose.yml` - db, mqtt, simulator, worker, web services
- `docker/app.Dockerfile` - shared node:24-slim + pnpm image
- `docker/mosquitto/mosquitto.conf` - listener 1883, allow_anonymous true, persistence true
- `.env.example` - all runtime env vars with in-compose + host-dev variants
- `.gitignore` - node_modules, .next, dist, .env, postgres-data, mosquitto-data

## Decisions Made
See `key-decisions` in frontmatter — TS version pin rationale, vitest workspace-file deprecation handling, Postgres 18 volume mount fix, and the create-next-app scaffold-then-trim approach.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Postgres 18 container crash-looped on the planned volume mount path**
- **Found during:** Task 2 verification (`docker compose up -d db mqtt`)
- **Issue:** Mounting the named volume at `/var/lib/postgresql/data` (the pre-18 convention) causes postgres:18 to exit(1) immediately with "these Docker images are configured to store database data in a format which is compatible with pg_ctlcluster... place a single mount at /var/lib/postgresql" (docker-library/postgres#1259).
- **Fix:** Changed the `db` service volume mount to `postgres-data:/var/lib/postgresql` (parent directory, letting the image manage the version-specific subdirectory).
- **Files modified:** `docker-compose.yml`
- **Verification:** `docker compose up -d db mqtt` → both `db` and `mqtt` reached `(healthy)` within ~20s; confirmed via `docker compose ps`.
- **Committed in:** `24abaea` (Task 2 commit)

**2. [Rule 3 - Blocking] vitest.workspace.ts alone does not work on Vitest 4**
- **Found during:** Task 1, writing the vitest config named in the plan
- **Issue:** Vitest 4 deprecated the standalone `defineWorkspace`/workspace-file format in favor of `test.projects` inside the root `vitest.config.ts`. A workspace-file-only setup would silently not pick up all packages.
- **Fix:** Added `vitest.config.ts` with `test.projects: ["packages/*", "apps/*"]` as the real config; kept `vitest.workspace.ts` (the filename the plan specified) as a thin re-export pointer to avoid breaking the plan's file-list contract while keeping the working config in one place.
- **Files modified:** `vitest.config.ts` (new), `vitest.workspace.ts`
- **Verification:** `pnpm test` → 5 test files / 5 tests passed across all packages+apps.
- **Committed in:** `7c8b52e` (Task 1 commit)

**3. [Rule 3 - Blocking] TypeScript strict base config missing Node types broke apps/simulator and apps/worker**
- **Found during:** Task 1, `pnpm typecheck`
- **Issue:** `tsconfig.base.json` had no `"types": ["node"]`, so `console` (and other Node globals) were unresolved in the tsx-run apps, and `rootDir: "src"` in per-package tsconfigs rejected the sibling `test/` directories.
- **Fix:** Added `"types": ["node"]` to `tsconfig.base.json`, added `@types/node@24.10.0` to every package/app's devDependencies, and removed the `rootDir`/`outDir` restriction from per-package tsconfigs (not needed since `noEmit: true` — no build output to place).
- **Files modified:** `tsconfig.base.json`, `package.json`, `packages/contracts/{package.json,tsconfig.json}`, `packages/db/{package.json,tsconfig.json}`, `apps/simulator/{package.json,tsconfig.json}`, `apps/worker/{package.json,tsconfig.json}`
- **Verification:** `pnpm typecheck` clean across all 5 workspace projects.
- **Committed in:** `7c8b52e` (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All three were necessary to satisfy the plan's own verification criteria (`docker compose up` healthy; `pnpm typecheck`/`pnpm test` green). No scope creep — no domain logic was added.

## Issues Encountered

- **`npx` was non-functional in this shell** (RTK token-proxy hook intercepts/mangles npx invocations here) — worked around using `pnpm dlx create-next-app@16.2.11 web ...` instead, which is the more correct tool for a pnpm monorepo anyway.
- **Full `docker compose up` (all 5 services) is unverified in this session.** `db` and `mqtt` were brought up live and both reached `(healthy)` — the plan's explicit must-have. Building the shared `docker/app.Dockerfile` image (`docker compose build simulator`) failed with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` when `corepack`/`npm` tried to fetch pnpm from `registry.npmjs.org` **from inside the container** — confirmed as a TLS-interception artifact of this sandboxed machine's network (host-side `npm view`/`pnpm install` all succeeded fine throughout this session; only the container's isolated network path hits an untrusted-CA wall). This is an environment-specific limitation of the execution sandbox, not a defect in `docker-compose.yml` or `docker/app.Dockerfile`; `docker compose config` validates cleanly and the Dockerfile follows the plan's exact recipe (node:24-slim, corepack, pnpm). Re-verify the full 5-service `docker compose up` on the actual dev machine (outside this sandboxed shell) before relying on it for the demo GIF.

## User Setup Required

None - no external service configuration required. (Copy `.env.example` to `.env` before running `docker compose up`, as documented in the file itself.)

## Next Phase Readiness
- `packages/contracts` and `packages/db` are ready to receive the event schema, topic builders, sim-clock math, loss-category map (contracts) and migrations/views/seed (db) in the next plans — currently intentionally empty (`export {}`).
- `apps/simulator` and `apps/worker` are ready to receive their `tsx`-run domain logic; the `start`/`dev` scripts and Docker command wiring are already correct.
- **Blocker/follow-up:** verify the full 5-service `docker compose up` (build step) on a machine without TLS-interception middleware before Phase 1's later plans assume it works end-to-end.

---
*Phase: 01-foundation-living-plant*
*Completed: 2026-07-25*

## Self-Check: PASSED

All 13 key files verified present on disk; both task commits (`7c8b52e`, `24abaea`) verified present in git log.
