---
phase: 04-difot-pareto-dds
reviewed: 2026-08-23T09:23:17Z
depth: standard
files_reviewed: 36
files_reviewed_list:
  - apps/worker/src/orders/rng.ts
  - apps/worker/src/orders/generate.ts
  - apps/worker/src/orders/allocate.ts
  - apps/worker/test/orders/generate.test.ts
  - apps/worker/test/orders/allocate.test.ts
  - apps/web/src/app/api/orders/route.ts
  - apps/web/src/app/api/orders/[id]/route.ts
  - apps/web/src/app/(dashboard)/orders/page.tsx
  - apps/web/src/app/(dashboard)/orders/[id]/page.tsx
  - apps/web/src/components/orders/status-chip.tsx
  - packages/db/prisma/migrations/20260823011717_customer_order_allocation/migration.sql
  - packages/db/prisma/migrations/20260823020000_order_difot_views/migration.sql
  - packages/db/prisma/schema.prisma
  - packages/db/src/views.sql
  - apps/worker/src/derive/intervals.ts
  - apps/worker/src/derive/store.ts
  - apps/worker/src/derive/prisma-store.ts
  - apps/worker/src/derive/runner.ts
  - apps/worker/src/main.ts
  - apps/web/src/components/ui/nav.tsx
  - apps/web/src/app/(dashboard)/layout.tsx
  - apps/web/src/lib/order-headline.ts
  - apps/web/test/order-headline.test.ts
  - apps/worker/test/causality.test.ts
  - packages/db/prisma/migrations/20260823030000_order_loss_drilldown/migration.sql
  - apps/web/src/app/(dashboard)/timeline/page.tsx
  - apps/web/src/components/timeline/gantt.tsx
  - apps/web/src/lib/loss-pareto.ts
  - apps/web/test/loss-pareto.test.ts
  - apps/web/src/app/api/losses/route.ts
  - apps/web/src/components/losses/pareto.tsx
  - apps/web/src/app/(dashboard)/losses/page.tsx
  - apps/web/src/lib/dds-actions.ts
  - apps/web/test/dds-actions.test.ts
  - apps/web/src/app/api/dds/route.ts
  - apps/web/src/app/(dashboard)/dds/page.tsx
  - apps/web/src/components/ui/card.tsx
  - tests/smoke/phase4-screens.spec.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-08-23T09:23:17Z
**Depth:** standard
**Files Reviewed:** 36
**Status:** issues_found

## Summary

Reviewed the DIFOT/order-fulfillment pipeline (seeded order generation, FIFO
allocation, `v_order_status`/`v_difot`/`v_difot_line`), the DIFOT-02
loss-drilldown bridge (`order_drilldown_context`/`order_loss_drilldown`), the
Loss Pareto and DDS screens, and their supporting SQL views/migrations.

The domain math itself (OEE preferred-calculation, FIFO ship rule, Six Big
Losses → unit conversion, `estLostUnits`/`shortUnits` denormalization, and
the row-absence-is-N/A discipline the phase set out to enforce after the
`9d516fe` fix) is applied consistently across every API route and SQL view
touched in this phase — I could not find a repeat of the zero-vs-null class
of bug the domain context specifically asked me to hunt for; every place
that could emit a false 0 (DDS `lateCount`, `topLoss`, `qualityPct`, DIFOT
tiles, Pareto empty state) is correctly gated on row/aggregate presence.

The one BLOCKER is not a math/classification bug — it's a state-management
bug in the Timeline page's shift picker that silently defeats the phase's
flagship feature (order → loss → machine deep link) whenever the linked
loss happened in Shift 1. Also flagged: a raw-Date-bound `$queryRaw` in the
DIFOT-02 causality test (the exact footgun this codebase's own convention
warns against, just in a test file this time) and a minor DDS
presentation inconsistency between the single-event "top loss" tile and the
aggregated "top 3 actions" list.

## Critical Issues

### CR-01: Timeline shift picker silently overrides an explicit deep-link `shiftId=S1`, breaking the DIFOT drill-down for Shift-1 losses

**File:** `apps/web/src/app/(dashboard)/timeline/page.tsx:63-92`

**Issue:** The order-detail page's "money shot" deep link
(`apps/web/src/app/(dashboard)/orders/[id]/page.tsx`'s `deepLinkHref`)
explicitly sets `shiftId` from the loss row so the Timeline page opens on
the *correct* shift, per the documented "DEEP-LINK MECHANISM" comment.
The Timeline page seeds its `shiftId` state from that URL param:

```ts
const [shiftId, setShiftId] = useState<string>(() => searchParams.get("shiftId") ?? SHIFT_OPTIONS[0].id);
```

But its mount-time `/api/andon` effect then "corrects" that value using a
sentinel comparison that cannot distinguish "user/deep-link explicitly
chose Shift 1" from "no value was ever set, so it defaulted to Shift 1"
(`SHIFT_OPTIONS[0].id === "S1"`):

```ts
setShiftId((prev) => (prev === SHIFT_OPTIONS[0].id ? activeShift.shiftId! : prev));
```

Whenever the plant's *currently* active shift (per `/api/andon`) differs
from the linked loss's shift — e.g. a viewer drills into a Shift-1
breakdown from earlier today while the sim clock has since rolled into
Shift 2 — this effect silently rewrites `shiftId` back to `S2`. The Gantt
then fetches Shift-2 interval data, the highlighted band's
`highlightStart`/`highlightEnd` never overlap anything on screen, and the
"one click from broken promise to machine cause" demo moment (this
project's stated core value proposition) quietly fails for roughly half of
all possible deep-link targets — with no error, console warning, or empty
state to explain why. The code's own comment two lines above even
acknowledges this exact failure mode ("that default is the broken path for
~1/3 of sim-time") without fixing it. `lineId`/`shiftDate` don't have this
bug because their sentinel (`""`) can never collide with a real value;
`shiftId`'s sentinel (`SHIFT_OPTIONS[0].id`) can.

The existing Playwright smoke test (`tests/smoke/phase4-screens.spec.ts`'s
"drill-down money shot" test) does not catch this: it only asserts the
resulting URL *contains* `lineId=`/`highlightStart=`/`highlightEnd=`
substrings, never that the shift selector converged on the URL's
`shiftId` or that the highlighted band actually renders.

**Fix:** Track whether `shiftId` came from the URL independently of its
current value (e.g. seed from a ref, or gate the override on
`!searchParams.get("shiftId")` instead of comparing state to the default):

```ts
const shiftIdFromUrl = useRef(searchParams.get("shiftId") !== null);
// ...
if (activeShift && !shiftIdFromUrl.current) {
  setShiftId(activeShift.shiftId!);
}
```

## Warnings

### WR-01: `causality.test.ts` binds a raw `Date` object into `$queryRaw`, reintroducing the local-TZ footgun this codebase explicitly warns against elsewhere

**File:** `apps/worker/test/causality.test.ts:308-314`

**Issue:** `apps/web/src/app/api/orders/route.ts`'s own header comment
documents the standing rule: "always bind ISO 'Z' strings, never Date
objects" when parameterizing raw pg queries against naive
`TIMESTAMP(3) WITHOUT TIME ZONE` columns, because `pg`'s default Date
serialization uses the Node process's *local* timezone offset, not UTC.
`day1OrderStatuses` violates that rule directly:

```ts
const day1OrderStatuses = (db: Db): Promise<OrderStatusRow[]> =>
  db.$queryRaw<OrderStatusRow[]>`
    SELECT "orderId", "productId", status, "remainingQty", "qtyOrdered", "dueDate"
    FROM v_order_status
    WHERE "orderDate" = ${new Date(`${DAY1}T00:00:00.000Z`)}
    ORDER BY "orderId" ASC
  `;
```

On a CI runner or developer machine whose local timezone is not UTC (e.g.
WIB/UTC+7), this Date gets serialized as local wall-clock time, shifting
the literal by the local offset relative to the naive value actually
stored in `orderDate` (sim-day midnight, UTC-authored). The comparison
would then match zero rows. The test's own sanity assertion
(`expect(cycBOrdersA.size).toBeGreaterThan(0)`) would catch the *symptom*,
but as a confusing unrelated failure ("day 1 didn't generate CYC-B
demand") rather than the actual cause — flaky/non-portable test behavior
that directly mirrors the bug class this same file's sibling code was
already burned by once (`9d516fe`).

**Fix:** Bind an ISO string and cast, matching the convention used
everywhere else in this phase's production routes:

```ts
WHERE "orderDate" = ${`${DAY1}T00:00:00.000Z`}::timestamp
```

### WR-02: DDS "Top loss yesterday" and "Today's top 3 actions" can name different reasons for the same day

**File:** `apps/web/src/app/api/dds/route.ts:165-173` vs `apps/web/src/app/api/dds/route.ts:174-180,214-222`

**Issue:** `topLoss` is sourced from the single largest raw `loss_event`
row (`ORDER BY le."lostTimeSec" DESC LIMIT 1`), while the top-3 actions are
sourced from `v_loss_pareto` rows **aggregated** per `(reasonCode, lineId)`
via `generateDdsActions`. These are genuinely different metrics: a reason
that recurs across two shifts (e.g. two 25-min BRK-MECH stops = 50 min
aggregate) can be edged out of the "Top loss" tile by a single 40-min
CO-PRODUCT changeover event, while still correctly ranking #1 in the
actions list below it. A viewer scrutinizing the DDS board (exactly the
kind of factory-literate reviewer this project is built to survive) could
reasonably read that as an inconsistency/bug rather than two intentionally
different lenses on the data.

**Fix:** Either derive `topLoss` from the same aggregated `paretoRows` /
`actions[0]` the action list already computed (one source of truth), or
add a one-line label distinguishing "largest single event" from "largest
recurring reason" so the two tiles are legibly different metrics rather
than apparently-contradictory ones.

### WR-03: Cumulative rounding in `splitIntoOrders` can push the last order's quantity above the intended demand pool

**File:** `apps/worker/src/orders/generate.ts:113-141`

**Issue:** Every non-last order's share is
`Math.round((weights[i]/weightSum) * totalQty)`; the last order absorbs
whatever remains (`totalQty - allocated`), then is floored at 1 via
`Math.max(1, share)`. Because each of the earlier `Math.round()` calls can
independently round *up*, `allocated` can already reach or exceed
`totalQty` before the last order is computed, making `share` zero or
negative — which the `Math.max(1, share)` floor then silently turns into
an extra unit tacked onto the generated order book, rather than
redistributing the deficit. The effect is bounded (at most a few units per
product, given `numOrders <= 6`) and is within the tolerance the unit test
already budgets for (`ratio` asserted in `[0.8, 1.05]`, not `[0.85, 1.0]`),
so this isn't corrupting the DIFOT-01 "healthy lines mostly ship on time"
invariant — but it does mean the code doesn't actually guarantee what its
own doc comment claims ("no repeats... never negative... capped"), and the
slight systematic upward bias compounds across all products/days.

**Fix:** Clamp the last share to be non-negative *before* flooring at 1,
and if it goes negative, shave the excess off the largest earlier share
instead of silently adding an extra unit:

```ts
const lastShare = totalQty - allocated;
const qty = lastShare >= 1 ? lastShare : 1;
```
is equivalent to what's there today (still permits the +1 overshoot); a
real fix needs to reduce an earlier bucket when `lastShare < 1`, e.g. by
tracking `Math.min` bucket and stealing 1 unit from it.

## Info

### IN-01: `execFileSync(..., { shell: true })` in a test reintroduces the exact pattern `main.ts` documents avoiding

**File:** `apps/worker/test/causality.test.ts:83-90`

**Issue:** `apps/worker/src/main.ts`'s `runMigrations()` explicitly avoids
`shell: true` with a comment citing the Node `DEP0190` footgun (unescaped
shell-arg interpolation). `runMigrateDeploy` in this test file does the
opposite (`shell: true`), for the same `pnpm ... prisma migrate deploy`
invocation. All arguments here are hardcoded literals (no injection
surface today), so this is not exploitable as written, but it's a
copy-paste trap: the next person who parameterizes this helper with
anything derived from test input inherits the exact vulnerability class
`main.ts` went out of its way to avoid.

**Fix:** Drop `shell: true` and use the same `pnpm.cmd`/`pnpm`
platform-dispatch `main.ts` uses, for consistency and to remove the trap.

### IN-02: `escalationLossRows`/`paretoRows` re-derive `WHERE le."shiftDate" = ${yesterdayStr}` independently rather than sharing a base query

**File:** `apps/web/src/app/api/dds/route.ts:174-193`

**Issue:** `paretoRows` (from `v_loss_pareto`) and `escalationLossRows`
(from raw `loss_event`) both filter on `shiftDate = yesterdayStr` but are
separate queries with slightly different column sets and one extra
`lineId` filter on `paretoRows` only. This is intentional per the file's
own doc comment (actions can be scoped to `lineId`, escalations stay
plant-wide) and isn't a bug, but it's worth a quick sanity note for future
maintainers: if the `lineId` scoping requirement on `paretoRows` is ever
dropped, these two queries could be collapsed into one to guarantee they
can never drift out of sync on `shiftDate` semantics.

---

_Reviewed: 2026-08-23T09:23:17Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
