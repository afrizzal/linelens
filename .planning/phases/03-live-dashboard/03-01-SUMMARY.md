---
phase: 03-live-dashboard
plan: 1
subsystem: api
tags: [nextjs, sse, postgres-listen-notify, prisma, pg, event-emitter, vitest, jsdom, turbopack]

# Dependency graph
requires:
  - phase: 02-oee-engine
    provides: "worker's coalesced pg_notify('linelens', ...) NOTIFY (apps/worker/src/notify.ts), v_line_shift_oee / v_machine_shift_oee / v_shift_windows SQL views, sim_now() function, state_interval/machine_event schema"
provides:
  - "GET /api/stream — SSE route (nodejs runtime, force-dynamic, 15s ping, request.signal abort cleanup), verified working end-to-end inside docker compose"
  - "apps/web/src/lib/listener.ts — globalThis-cached dedicated pg.Client LISTEN singleton fanning out via an in-process EventEmitter"
  - "apps/web/src/hooks/use-live.ts — useLive(refetch, opts?) client hook: debounced SSE refetch, reconnect backoff, 5s polling fallback"
  - "GET /api/andon, /api/oee, /api/timeline, /api/sim-clock — read-model routes (code complete, typecheck clean; live-in-docker verification BLOCKED, see Known Issues)"
affects: [03-02-live-dashboard, 03-03-live-dashboard]

# Actuals (#2632)
actuals:
  tokens: 7100
  tasks: 3
  commits: 4

# Tech tracking
tech-stack:
  added: ["@testing-library/react (devDep, apps/web)", "jsdom (devDep, apps/web)"]
  patterns:
    - "globalThis-cached singleton for both the Prisma client (apps/web/src/lib/db.ts) and the dedicated pg LISTEN client (apps/web/src/lib/listener.ts) — survives Next.js dev-mode module reloads"
    - "web-side LISTEN/NOTIFY fan-out: worker NOTIFY -> dedicated unpooled pg.Client LISTEN -> in-process EventEmitter -> per-connection SSE subscriber (ARCHITECTURE.md Pattern 3)"
    - "sim-time SQL comparisons reuse v_shift_windows's already-UTC-cast shiftStart/effectiveEnd columns instead of re-deriving `sim_now() AT TIME ZONE 'UTC'` per route"
    - "workspace TS packages consumed by Next.js need `transpilePackages` in next.config.ts + a package.json export subpath bypassing `export *` barrels when Turbopack's dev bundler cannot statically resolve a deep re-export chain"

key-files:
  created:
    - apps/web/src/lib/listener.ts
    - apps/web/src/lib/db.ts
    - apps/web/src/app/api/stream/route.ts
    - apps/web/src/app/api/andon/route.ts
    - apps/web/src/app/api/oee/route.ts
    - apps/web/src/app/api/timeline/route.ts
    - apps/web/src/app/api/sim-clock/route.ts
    - apps/web/src/hooks/use-live.ts
    - apps/web/test/use-live.test.ts
  modified:
    - apps/web/package.json
    - apps/web/next.config.ts
    - packages/db/package.json

key-decisions:
  - "Andon 'line state' = worst-open-state-wins across a line's machines (DOWN > CHANGEOVER > BREAK > EXECUTE) since plant.config.json gives every line 2 machines producing in parallel, and the plan's per-line state/reasonCode/since triple assumes one representative value"
  - "Andon target count sums floor(PPT_elapsed_sec / machine_ICT) per machine per line, using the current shift's already-elapsed pptSec from v_shift_windows (single sim_now() comparison for the whole route)"
  - "goodCount/targetCount are null (N/A), not 0, when no shift is currently active (between shifts) — Pitfall 2 discipline extended to the andon route"
  - "Added apps/web/src/lib/db.ts (globalThis-cached Prisma singleton) though not in the plan's files_modified — needed to avoid a new PrismaClient/connection-pool per route call"

patterns-established:
  - "Pattern: 03-02/03-03 UI routes consuming @linelens/db from apps/web MUST keep next.config.ts's transpilePackages list in sync with any new workspace TS package dependency, and be aware of the still-open Turbopack/generated-Prisma-client resolution issue (see Known Issues)."

requirements-completed: []

coverage:
  - id: D1
    description: "GET /api/stream is a working SSE endpoint verified inside docker: nodejs runtime, force-dynamic, 15s keep-alive ping, clean close on client abort, live change events from the worker's NOTIFY"
    verification:
      - kind: manual_procedural
        ref: "docker compose up -d --build; curl -N --max-time 20 -D - http://localhost:3000/api/stream — observed correct headers (Content-Type: text/event-stream, Cache-Control: no-cache no-transform, Connection: keep-alive, X-Accel-Buffering: no), live `event: change` frames with real lineIds, and a `: ping` comment within the 20s window; web logs show `[stream] client disconnected, subscribers: 0` after curl exited (no listener leak)"
        status: pass
    human_judgment: false
  - id: D2
    description: "web-side LISTEN/NOTIFY -> EventEmitter fan-out; web never writes to Postgres"
    verification:
      - kind: manual_procedural
        ref: "docker web logs: '[listener] connected and LISTENing on '\"'\"'linelens'\"'\"''; grep -rn \"\\.create(|\\.update(|\\.delete(|\\.upsert(|\\.createMany(|\\.updateMany(|\\.deleteMany(\" apps/web/src apps/web/test -> no matches"
        status: pass
    human_judgment: false
  - id: D3
    description: "useLive hook: EventSource with automatic reconnect and a 5s polling fallback"
    verification:
      - kind: unit
        ref: "apps/web/test/use-live.test.ts#debounces refetch on a change event (one call, after 300ms)"
        status: pass
      - kind: unit
        ref: "apps/web/test/use-live.test.ts#flips to polling when the source errors, and a successful reconnect stops polling"
        status: pass
    human_judgment: false
  - id: D4
    description: "/api/andon, /api/oee, /api/timeline, /api/sim-clock read-model routes — code complete, typecheck clean, sim-time and read-only-Prisma gates clean, correct against the schema/views — but NOT verified live in docker (blocked by an unresolved Turbopack module-resolution issue)"
    verification:
      - kind: unit
        ref: "pnpm --filter @linelens/web run typecheck (clean); sim-time gate grep (clean); read-only-discipline grep (clean)"
        status: pass
      - kind: manual_procedural
        ref: "docker compose: curl http://localhost:3000/api/sim-clock and /api/andon"
        status: fail
    human_judgment: true
    rationale: "Static verification (typecheck, gate greps) passed, but the mandatory in-docker live check (Task 2 <verify>: spot-check andon against mosquitto_sub) could not complete — all four Prisma-backed routes return HTTP 500 inside docker's `next dev` due to a Turbopack module-resolution gap (see Known Issues). A human/next executor must either resolve the Turbopack issue or confirm an alternate verification path before treating these routes as demo-ready."

duration: 73min
completed: 2026-08-22
status: complete
---

# Phase 3 Plan 1: Live Dashboard Plumbing Summary

**Worker-NOTIFY-to-browser SSE pipeline (verified working end-to-end inside docker) plus four Prisma read-model routes that are code-complete but blocked from live verification by an unresolved Turbopack workspace-package resolution bug.**

## Performance

- **Duration:** 73 min (15:15–16:28 local, includes an interrupted/resumed session)
- **Started:** 2026-08-22T08:15:01Z
- **Completed:** 2026-08-22T09:26:53Z
- **Tasks:** 3 (all executed)
- **Files modified:** 12 (9 created, 3 modified)

## Accomplishments
- `GET /api/stream`: SSE route backed by a globalThis-cached, dedicated (unpooled) `pg.Client` LISTEN singleton fanning out via an in-process `EventEmitter` — verified end-to-end **inside docker compose** (not just `next dev`), matching PITFALLS.md's explicit warning that this exact gap is where SSE demos usually break.
- `useLive` client hook: debounced (300ms) SSE-driven refetch, exponential reconnect backoff (1s→5s), and a 5s polling fallback while disconnected — covered by two passing vitest+jsdom component tests.
- Four read-model routes (`/api/andon`, `/api/oee`, `/api/timeline`, `/api/sim-clock`) implemented against the Phase-02 views and sim-time contract: N/A semantics preserved (row absence / no-current-shift → `null`, never a false 0), the mandatory `sim_now() AT TIME ZONE 'UTC'` cast rule enforced and grep-verified, and no write calls anywhere under `apps/web`.
- Context7 was reachable this session (unlike the Phase-3 research pass) and confirmed the plan's SSE/LISTEN patterns before implementation: Next.js's own docs snippet for streaming a Route Handler (raw `Response` + `ReadableStream`, no `NextResponse`) and its `request.signal`/`AbortController` cancellation mechanism, plus node-postgres's `client.on('notification', ...)` / `LISTEN` API — both matched the plan's design exactly, no adjustments needed.

## Task Commits

Each task was committed atomically:

1. **Task 1: LISTEN singleton + SSE route** - `8fa6f9f` (feat)
2. **Task 2: Read-model API routes** - `ecd9612` (feat)
3. **Task 3: use-live client hook** - `1ef4a21` (feat)

**Deviation fix:** `dcbcf5f` (fix — transpilePackages + export-subpath bypass, see Deviations below)

_No plan-metadata commit yet — this SUMMARY is committed separately per the executor's REQUIRED ORDER._

## Files Created/Modified
- `apps/web/src/lib/listener.ts` - globalThis-cached dedicated pg LISTEN client, backoff reconnect, `getEmitter()`
- `apps/web/src/app/api/stream/route.ts` - SSE route: nodejs runtime, force-dynamic, 15s ping, abort cleanup, optional `?lineId=` filter
- `apps/web/src/lib/db.ts` - globalThis-cached Prisma client singleton (added, not in original plan scope)
- `apps/web/src/app/api/sim-clock/route.ts` - `{simNow, speed}`; the one legitimate uncast `sim_now()` scalar read
- `apps/web/src/app/api/andon/route.ts` - per-line worst-state + good/target count, single sim_now() comparison for current-shift resolution
- `apps/web/src/app/api/oee/route.ts` - v_line_shift_oee + v_machine_shift_oee passthrough, row-absence = N/A
- `apps/web/src/app/api/timeline/route.ts` - state_interval rows clamped via v_shift_windows
- `apps/web/src/hooks/use-live.ts` - `useLive(refetch, opts?)` SSE + debounce + poll-fallback hook
- `apps/web/test/use-live.test.ts` - vitest+jsdom component tests (EventSource mocked)
- `apps/web/package.json` - added `@linelens/db`, `pg`, `@types/pg` deps + `jsdom`, `@testing-library/react` devDeps
- `apps/web/next.config.ts` - `transpilePackages: ["@linelens/db", "@linelens/contracts"]` (deviation fix)
- `packages/db/package.json` - added `"./client"` export subpath (deviation fix)

## Decisions Made
- Andon "line state" resolved as worst-open-state-wins across a line's machines (each line has 2 machines per `plant.config.json`), not a single machine — standard andon convention, and consistent with the plan's own target-count formula already assuming multiple machines per line.
- Andon target count = `Σ over machines of floor(PPT_elapsed_sec / machine_ICT)`, reusing the current shift's already-elapsed `pptSec` from `v_shift_windows` rather than recomputing PPT math in TypeScript.
- `/api/andon`'s good/target counts are `null` (N/A) when no shift is currently active, extending PITFALLS.md's "never a false 0%" discipline to the andon route.
- Added `apps/web/src/lib/db.ts` — a small globalThis-cached Prisma client singleton — even though it wasn't in the plan's `files_modified` list, because every read-model route needs a shared client instance to avoid a new connection pool per Next.js dev-mode reload (Rule 2: missing critical functionality).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] apps/web needed `transpilePackages` + an export-subpath bypass to consume `@linelens/db`**
- **Found during:** Task 2 in-docker `<verify>` (curl against `/api/sim-clock`)
- **Issue:** `apps/web` is the first Next.js consumer of `@linelens/db` (and transitively `@linelens/contracts`). Both packages ship TypeScript source directly via `package.json` `"exports"` — `apps/worker`/`apps/simulator` only ever ran them through `tsx`, which resolves the `.js`-extension-imports-`.ts`-file convention transparently. Next.js's Turbopack dev bundler does not do this for an un-transpiled workspace package: `next dev` failed at request time with `Module not found: Can't resolve './client.js'`.
- **Fix:** Added `transpilePackages: ["@linelens/db", "@linelens/contracts"]` to `apps/web/next.config.ts` (gets Turbopack past `packages/db/src/index.ts`'s resolution), and added a `"./client"` export subpath to `packages/db/package.json` + switched `apps/web/src/lib/db.ts` to `import ... from "@linelens/db/client"` (bypasses `index.ts`'s `export *` barrel, which Turbopack's dev-mode static export analysis was intermittently failing to enumerate through the pnpm-symlinked `node_modules/@linelens/db` path).
- **Files modified:** `apps/web/next.config.ts`, `apps/web/src/lib/db.ts`, `packages/db/package.json`
- **Verification:** `pnpm --filter @linelens/web run typecheck` clean before and after; in docker, resolution progress moved from failing on `packages/db/src/index.ts` to failing one hop deeper (see Known Issues below — NOT fully resolved).
- **Committed in:** `dcbcf5f`

---

**Total deviations:** 1 auto-fixed (1 blocking), plus 1 unresolved known issue (see below — NOT auto-fixed, flagged for follow-up).
**Impact on plan:** The SSE pipeline (Tasks 1 and 3) is fully verified and unaffected. Task 2's four read-model routes are code-complete and pass every static check (typecheck, sim-time gate, read-only-Prisma gate) but are NOT verified live in docker — see Known Issues.

## Known Issues

**`/api/andon`, `/api/oee`, `/api/timeline`, `/api/sim-clock` return HTTP 500 inside docker's `next dev` — Turbopack cannot resolve the Prisma-7 generated TS client through the workspace package chain.**

After the `transpilePackages` + `./client` subpath fix above, Turbopack's module resolution reaches `packages/db/src/client.ts` successfully, but fails one hop deeper:
```
./packages/db/src/client.ts:19:1
Module not found: Can't resolve '../generated/prisma/client.js'
```
`packages/db/generated/prisma/client.ts` is real TypeScript source generated by Prisma 7's Rust-free/WASM generator (confirmed present on disk inside the container via `docker compose exec web ls`), and `PrismaClient` is an explicit named export there (not a wildcard) — so this is not a missing-file or missing-export problem, it is specifically Turbopack's dev-mode resolver failing to follow a relative `.js`→`.ts` import that crosses from `packages/db/src/` into `packages/db/generated/prisma/`, reached through the pnpm-symlinked `apps/web/node_modules/@linelens/db`.

**Tried and ruled out this session:**
1. Adding `generated` to `packages/db/tsconfig.json`'s `include` array (no effect, reverted).
2. An explicit `turbopack.root` pointing at the monorepo root in `next.config.ts` (no effect, reverted — Context7-confirmed docs on Turbopack root auto-detection via `pnpm-lock.yaml` suggested this was the right lever, but it didn't resolve this specific failure).
3. Clearing `.next` cache and restarting/rebuilding the container multiple times (ruled out stale-cache as the cause — the error is deterministic once the container is actually running the current source).

**What IS verified:**
- `GET /api/stream` (Task 1) works correctly end-to-end inside docker — confirmed with real SSE headers, live `change` events, `: ping` keep-alives, and clean listener teardown. This route only imports `pg` directly (via `listener.ts`), never `@linelens/db`, so it is unaffected by this issue.
- All four read-model route files pass `pnpm --filter @linelens/web run typecheck`, the sim-time gate grep, and the read-only-Prisma-discipline grep — the TypeScript/SQL logic itself was reviewed and is correct against the Phase-02 schema and views.
- `mosquitto_sub -t 'spBv1.0/LineLens/DDATA/+/+'` was run against the live stack and confirmed real telemetry flowing (e.g. `L4-M2` COUNTS events with `goodDelta`, `idealCycleTimeSec`) — the plant itself is healthy; only the web routes' Turbopack bundling is broken.

**Recommended next step (wave 2, or a follow-up quick task before 03-02 starts):** either (a) find the actual Turbopack fix (candidates not yet tried: `next build` + `next start` instead of `next dev` to rule out a dev-only Turbopack code path; an explicit `turbopack.resolveAlias` pointing `@linelens/db/client` straight at the generated file; filing/searching a Next.js GitHub issue for "Turbopack pnpm workspace generated Prisma client not found"), or (b) restructure `packages/db/src/client.ts` to re-export the generated client's *named* symbols explicitly instead of `export *`, which may sidestep whatever Turbopack step is failing. 03-02/03-03 (the UI plans) will hit this same wall the moment they render live data, so this should be resolved before or very early in wave 2.

## Issues Encountered
- A transient `ENOTFOUND` network error killed the executor process mid-debug (mid-way through the Turbopack investigation above); the session resumed cleanly from git history + a coordinator status recap. No work was lost — the three task commits and the deviation-fix commit were already on disk; only the SUMMARY/STATE/ROADMAP updates were still pending, which this document completes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The SSE plumbing (Task 1) and the client hook (Task 3) are solid, verified foundations for 03-02/03-03's UI work.
- **Blocker for 03-02/03-03:** the read-model routes must actually serve data before the andon board / OEE waterfall / timeline pages can render anything real. The Turbopack issue documented above needs to be resolved (or worked around) before those plans can be meaningfully demoed inside docker — `pnpm smoke` / any docker-based UAT will currently show blank/error states on every data-driven screen.
- Sim-time and read-only-Prisma discipline gates are in place and grep-verified — future routes/plans should reuse the same patterns (view-column clamping over direct `sim_now()` calls; Prisma-only, no raw pg writes).

---
*Phase: 03-live-dashboard*
*Completed: 2026-08-22*
