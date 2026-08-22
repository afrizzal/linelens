---
phase: 03-live-dashboard
reviewed: 2026-08-22T13:54:40Z
depth: standard
files_reviewed: 45
files_reviewed_list:
  - apps/web/next.config.ts
  - apps/web/src/app/(dashboard)/andon/page.tsx
  - apps/web/src/app/(dashboard)/layout.tsx
  - apps/web/src/app/(dashboard)/oee/page.tsx
  - apps/web/src/app/(dashboard)/timeline/page.tsx
  - apps/web/src/app/api/andon/route.ts
  - apps/web/src/app/api/control/inject/route.ts
  - apps/web/src/app/api/oee/route.ts
  - apps/web/src/app/api/sim-clock/route.ts
  - apps/web/src/app/api/stream/route.ts
  - apps/web/src/app/api/timeline/route.ts
  - apps/web/src/app/globals.css
  - apps/web/src/app/layout.tsx
  - apps/web/src/app/page.tsx
  - apps/web/src/components/andon/tile.tsx
  - apps/web/src/components/inject-button.tsx
  - apps/web/src/components/oee/kpi-tiles.tsx
  - apps/web/src/components/oee/waterfall.tsx
  - apps/web/src/components/timeline/gantt.tsx
  - apps/web/src/components/ui/badge.tsx
  - apps/web/src/components/ui/card.tsx
  - apps/web/src/components/ui/icons.tsx
  - apps/web/src/components/ui/nav.tsx
  - apps/web/src/components/ui/select.tsx
  - apps/web/src/components/ui/state-color.ts
  - apps/web/src/components/ui/top-bar.tsx
  - apps/web/src/hooks/use-live.ts
  - apps/web/src/hooks/use-sim-clock.ts
  - apps/web/src/lib/db.ts
  - apps/web/src/lib/listener.ts
  - apps/web/src/lib/oee-waterfall.ts
  - apps/web/src/lib/timeline-data.ts
  - apps/web/test/oee-waterfall.test.ts
  - apps/web/test/timeline-data.test.ts
  - apps/web/test/use-live.test.ts
  - packages/contracts/src/events.ts
  - packages/contracts/src/index.ts
  - packages/contracts/src/plant-config.ts
  - packages/contracts/src/reasons.ts
  - packages/db/prisma/schema.prisma
  - packages/db/src/client.ts
  - apps/web/package.json
  - packages/contracts/package.json
  - packages/db/package.json
  - .gitignore
findings:
  critical: 1
  warning: 6
  info: 2
  total: 9
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-08-22T13:54:40Z
**Depth:** standard
**Files Reviewed:** 45
**Status:** issues_found

## Summary

Reviewed all Phase 3 dashboard/API source (andon, OEE waterfall, timeline Gantt, SSE fan-out, inject-breakdown control proxy, sim-clock, contracts, db client). Overall the implementation is disciplined about the project's hard rules: `Date.now()` is correctly kept out of derivation code (sim-time flows from `/api/sim-clock` everywhere it matters), `apps/web` is read-only against Postgres (only `$queryRaw` SELECTs and Prisma `findMany`/`findUnique`), the web tier never subscribes to MQTT directly (LISTEN/NOTIFY only), the SSE route follows the documented App Router contract (runtime, dynamic, ping, abort cleanup), the waterfall's cascading-offset arithmetic reconciles correctly (verified by hand-tracing the assist-bar math against the PPT identity), and the Turbopack workspace-exports convention is followed consistently.

`tsc --noEmit` was run against `apps/web` and passed cleanly — no compiler-level defects to report.

One genuine violation of the project's explicit sim-time SQL contract was found in `GET /api/andon`: a `Date` object read back from one raw query is bound directly as a parameter into a second raw query against a `TIMESTAMP WITHOUT TIME ZONE` column, instead of the mandated ISO `'Z'`-suffixed string. Given Prisma's documented UTC-based decoding of naive timestamp columns versus node-postgres's local-timezone-based encoding of `Date` parameters, this is a real (not theoretical) silent-corruption risk whenever the web process's host TZ isn't UTC — which is exactly the scenario `next.config.ts`'s own comments describe having been exercised this phase (`next dev` on host, outside the UTC-pinned docker network). The remaining findings are robustness/consistency gaps (unguarded SSE enqueue calls, client-only rate limiting on the demo's control endpoint, a second un-deferred instance of the shift-rollover seeding bug, and some duplicated logic/logging-convention drift) rather than confirmed active defects.

## Critical Issues

### CR-01: `GET /api/andon` binds raw `Date` objects into a sim-time SQL comparison instead of ISO `'Z'`-suffixed strings

**File:** `apps/web/src/app/api/andon/route.ts:87-96`
**Issue:**
```ts
if (currentShift) {
    goodCounts = await db.$queryRaw<GoodCountRow[]>`
      SELECT "lineId" AS "lineId", SUM(COALESCE("goodDelta", 0))::double precision AS "goodCnt"
      FROM machine_event
      WHERE kind = 'COUNTS'
        AND "simTime" >= ${currentShift.shiftStart}
        AND "simTime" < ${currentShift.effectiveEnd}
      GROUP BY "lineId"
    `;
}
```
`currentShift.shiftStart` / `currentShift.effectiveEnd` are `Date` objects decoded by Prisma from the earlier `v_shift_windows` raw query (a `TIMESTAMP(3) WITHOUT TIME ZONE` column). They are then re-bound directly as parameters of a second raw query against `machine_event."simTime"` (also naive `TIMESTAMP(3) WITHOUT TIME ZONE`).

This is a direct violation of the project's documented sim-time SQL contract ("Through raw pg, bind ISO `'Z'`-suffixed strings, never `Date` objects — raw-pg Date binding is local-OS-TZ dependent"), and every other raw query in this phase (`oee/route.ts`, `timeline/route.ts`, `sim-clock/route.ts`) correctly avoids this pattern by binding plain strings or reusing pre-cast view columns.

Concretely: Prisma's client decodes naive `timestamp` columns as UTC-anchored `Date` instances (so `simTime`/`effectiveEnd` correctly represent the sim-UTC instant regardless of host TZ), but `@prisma/adapter-pg`'s underlying `pg` parameter serialization encodes a bound `Date` parameter using the **process's local timezone getters** (`getFullYear`/`getHours`/etc.), not UTC. Read (UTC-based) and write (local-based) are therefore *not* inverse operations whenever the web process's OS timezone is not UTC — the naive timestamp sent back to Postgres will be shifted by the local UTC offset, silently corrupting the `goodCount` window comparison (either under- or over-counting production for the shift, or excluding it entirely). This is exactly the "silent number-corruption class" defect the project's CLAUDE.md calls out.

This isn't merely theoretical for this project: `next.config.ts`'s own header comment documents that `next dev` was run directly on the host (not inside the UTC-pinned docker compose network) during this exact phase to diagnose a Turbopack bug — i.e., the non-UTC-host code path this bug depends on has already been exercised during development.

**Fix:** Convert both bounds to ISO strings before binding, matching the convention used everywhere else in this phase:
```ts
goodCounts = await db.$queryRaw<GoodCountRow[]>`
  SELECT "lineId" AS "lineId", SUM(COALESCE("goodDelta", 0))::double precision AS "goodCnt"
  FROM machine_event
  WHERE kind = 'COUNTS'
    AND "simTime" >= ${currentShift.shiftStart.toISOString()}
    AND "simTime" < ${currentShift.effectiveEnd.toISOString()}
  GROUP BY "lineId"
`;
```

## Warnings

### WR-01: `timeline/page.tsx` has the same un-deferred shift-date-rollover seeding bug as `oee/page.tsx`

**File:** `apps/web/src/app/(dashboard)/timeline/page.tsx:56-68`
**Issue:** The already-deferred defect on `oee/page.tsx:83` (`setShiftDate((prev) => prev || activeShift.shiftDate!)` seeds the shift date once from the first `/api/andon` response and never re-seeds after a sim-day rollover) is duplicated verbatim in `timeline/page.tsx`:
```ts
setShiftDate((prev) => prev || activeShift.shiftDate!);
setShiftId((prev) => (prev === SHIFT_OPTIONS[0].id ? activeShift.shiftId! : prev));
```
and the fallback effect:
```ts
useEffect(() => {
  if (shiftDate || !simClock.simNow) return;
  setShiftDate(simClock.simNow.toISOString().slice(0, 10));
}, [shiftDate, simClock.simNow]);
```
Only the OEE page's instance was logged/deferred by explicit user decision; this second occurrence on the Timeline page was not, so a fix targeting only `oee/page.tsx` would leave the Timeline page silently stuck on a stale shift date after a sim-day rollover during a long-running demo.
**Fix:** Extract the shared "seed line/shift from `/api/andon`'s active shift, re-seed on sim-day rollover" logic into one hook (e.g. `useLineShiftSelection()`) consumed by both pages, and fix the rollover behavior once in that shared location.

### WR-02: `stream/route.ts` enqueues to the SSE controller without guarding against an already-closed stream

**File:** `apps/web/src/app/api/stream/route.ts:32-46`
**Issue:** `send()` (used for `onChange`) and the `pingTimer` callback both call `controller.enqueue(...)` with no `try/catch`:
```ts
const send = (event: string, data: unknown): void => {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
};
...
const pingTimer = setInterval(() => {
  controller.enqueue(encoder.encode(`: ping\n\n`));
}, PING_INTERVAL_MS);
```
`cleanup()` explicitly wraps its own `controller.close()` in a `try/catch` with a comment acknowledging "request.signal 'abort' can fire after the stream naturally ended; closing twice would throw" — the same underlying "controller already closed" hazard applies to `enqueue()` calls that race the abort/close (e.g. a NOTIFY-triggered change event or a ping tick landing in the same event-loop turn as (but just before) the abort listener runs). An uncaught synchronous throw inside a `setInterval` callback or an EventEmitter listener is an unhandled exception in Node and can take down the whole long-lived web process — a much larger blast radius than one dropped SSE frame.
**Fix:** Wrap both enqueue call sites the same way `cleanup()`'s `controller.close()` already is:
```ts
const send = (event: string, data: unknown): void => {
  try {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  } catch {
    // Controller already closed — abort cleanup will run momentarily.
  }
};
```
(same for the ping timer body).

### WR-03: `POST /api/control/inject` has no server-side rate limiting — the 10s cooldown is entirely client-side

**File:** `apps/web/src/components/inject-button.tsx:26,45-46`, `apps/web/src/app/api/control/inject/route.ts:13-37`
**Issue:** `InjectButton`'s cooldown (`setDisabled(true)` + a `setTimeout`) only prevents the React component from firing a second `fetch`. Nothing on the server enforces it — any client can call `POST /api/control/inject` directly (or via a scripted loop) with no throttling, hammering the simulator's control server through the web tier's proxy for as long as the caller likes.
**Fix:** Add a minimal server-side guard in the route handler (e.g. an in-memory per-`lineId` last-injected timestamp with the same 10s window, rejecting with 429 if called again too soon) so the rate limit is enforced regardless of client behavior.

### WR-04: SSE/listener logging uses raw `console.*` instead of the project's mandated `pino` structured logger

**File:** `apps/web/src/app/api/stream/route.ts:54`, `apps/web/src/lib/listener.ts:51,63,70,85,87`
**Issue:** The project's own tech-stack decision (STACK.md) specifies `pino` for "structured logging in worker **+ SSE route**", explicitly calling out this file's use case. Instead, both the SSE route and the LISTEN-side listener use bare `console.info`/`console.error`, and `pino` is not even listed as a dependency in `apps/web/package.json`. This loses structured/leveled logging for exactly the subsystem (long-lived LISTEN/NOTIFY + SSE fan-out) most likely to need it for production debugging.
**Fix:** Add `pino` to `apps/web`'s dependencies and route these log calls through it, consistent with the worker side.

### WR-05: Duplicated line/shift-selection boilerplate between `oee/page.tsx` and `timeline/page.tsx`

**File:** `apps/web/src/app/(dashboard)/oee/page.tsx:12-17,49-95`, `apps/web/src/app/(dashboard)/timeline/page.tsx:12-17,29-68`
**Issue:** Both pages independently redeclare an identical `AndonLineSummary` interface, an identical `SHIFT_OPTIONS` constant, and near-identical (~35 line) effects for seeding `lines`/`lineId`/`shiftDate`/`shiftId` from `/api/andon`'s currently-active shift plus a sim-clock-based fallback. Any future fix to this logic (including WR-01 above) has to be applied twice and can easily drift.
**Fix:** Extract a shared `useLineShiftSelection()` hook (and a shared `AndonLineSummary`/`SHIFT_OPTIONS` module) under `apps/web/src/hooks` or `apps/web/src/lib`, consumed by both pages.

### WR-06: `formatPct` is defined twice with identical logic

**File:** `apps/web/src/app/(dashboard)/oee/page.tsx:57`, `apps/web/src/components/oee/kpi-tiles.tsx:13`
**Issue:** `const formatPct = (v: number | null): string => (v == null ? "N/A" : \`${(v * 100).toFixed(1)}%\`);` is copy-pasted verbatim in both files. This is exactly the kind of N/A-vs-0% formatting logic the project treats as a credibility-sensitive invariant (PITFALLS.md Pitfall 2) — having two copies makes it easy for one to drift out of sync with the other during a future edit.
**Fix:** Move `formatPct` into a shared module (e.g. `apps/web/src/lib/format.ts`) and import it from both call sites.

## Info

### IN-01: `useLive`'s `lineId` filtering option is unused dead code

**File:** `apps/web/src/hooks/use-live.ts:13-15,34,63`
**Issue:** `UseLiveOptions.lineId` builds `/api/stream?lineId=...` and is fully implemented (including server-side filtering in `stream/route.ts`'s `onChange`), but no page (`andon`, `oee`, `timeline`) ever passes it — every call site is `useLive(fetchX)` with no second argument. It's speculative generality with no current consumer.
**Fix:** Either wire it into the pages that would benefit (e.g. the Timeline/OEE pages could filter to their selected `lineId` to reduce irrelevant refetch churn) or remove the unused option until a real consumer exists.

### IN-02: `apps/web/src/app/(dashboard)/timeline/page.tsx` — `TimelinePage`'s `AndonLineSummary` and `TimelineResponse` local interfaces have no runtime validation of the `/api/andon`/`/api/timeline` JSON shape

**File:** `apps/web/src/app/(dashboard)/timeline/page.tsx:12-25`, and mirrored in `oee/page.tsx:12-47`
**Issue:** `fetch(...).then((res) => res.json()).then((data: AndonLineSummary[]) => ...)` blindly casts the parsed JSON to the expected TS shape with no `zod` parse, even though `zod` is already a project dependency and is explicitly the mandated "parse-don't-validate boundary" tool per STACK.md ("Always — untrusted-shape MQTT payloads **and** ... config"). A future API response-shape change (e.g. a renamed field) would fail silently at the type level and only surface as a runtime `undefined` rendering as blank UI rather than a caught validation error.
**Fix:** Not required for a same-origin, same-repo API contract at demo scale, but consider a light zod schema at the fetch boundary if these routes are ever consumed by anything outside this Next.js app.

---

_Reviewed: 2026-08-22T13:54:40Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
