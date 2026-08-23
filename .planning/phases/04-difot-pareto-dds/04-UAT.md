---
status: complete
phase: 04-difot-pareto-dds
source: [04-VERIFICATION.md]
started: 2026-08-23T10:20:00Z
updated: 2026-08-23T14:40:00Z
---

## Current Test

none — all tests resolved

## Tests

### 1. Live drill-down click-through lands on the correct shift with the band pulsing
expected: The deep link lands on the correct line/shift/date (not silently overridden back to the sim's currently-active shift) and the target state-interval band visibly pulses amber.
result: pass

Satisfied by the automated guard, exactly as option 2 of "How to run this test"
prescribed — no manual fallback and no forced condition needed.

Evidence (2026-08-23, live docker stack, clean volume):
- The sim clock produced a genuine AT_RISK order on its own: `ORD-2026-01-05-CYC-C-0`,
  due 2026-01-07, found via `GET /api/orders?day=2026-01-07`. No breakdown was
  injected and the sim clock was not fast-forwarded.
- `pnpm exec playwright test tests/smoke/phase4-screens.spec.ts -g "drill-down money shot"`
  → **1 passed (15.5s)**. It did NOT `test.skip()`, so every assertion executed:
  the ranked-loss ordering guard, the `lineId`/`highlightStart`/`highlightEnd`
  deep-link params, the URL round-trip of `shiftId`, and — the CR-01 regression
  guard itself — `expect(shiftSelect).toHaveValue(linkedShiftId)`, proving the
  mount-time `/api/andon` effect no longer overrides an explicit `shiftId` deep
  link back to the currently-active shift. Zero client-side page errors.
- WINDOWS entry 13 closed on this evidence.

Caveat recorded honestly: `AT_RISK` is a transient status (`projectedFinish >
dueDate` against the current good-rate), and a full-suite re-run minutes later
skipped test 9 again because the order had returned to `OPEN`. The assertion
ran and passed; it is not reproducible on demand until sim time passes a due
date.

## Summary

total: 1
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None identified by automated verification. The single pending item is a
behavior-present-but-unwitnessed case, not a suspected defect:

- The mechanism is wired end-to-end and its causal claim is independently proven
  by `apps/worker/test/causality.test.ts` (real-pipeline A/B, seed 42, nothing mocked).
- The specific bug that would break this path (CR-01, the Timeline shift picker
  silently overriding an explicit `shiftId=S1` deep link) was found by code review
  and fixed in `4650a12`; the fix is confirmed by code reading, typecheck,
  `next build`, and 34/34 apps/web unit tests.
- What has never executed is the regression guard for that fix: the
  "drill-down money shot" test in `tests/smoke/phase4-screens.spec.ts` calls
  `test.skip()` whenever no LATE/AT_RISK order exists, and it skipped on every
  run so far. Tracked as WINDOWS.md entries 9 and 13.

### How to run this test

1. Bring the stack up and let the sim clock run until a LATE or AT_RISK order exists:
   `docker compose up -d` then check `curl http://localhost:3000/api/orders?day=<sim day>`
   for an order whose status is `LATE` or `AT_RISK`.
2. Preferred — let the automated guard do it: `pnpm test:smoke`. If test 9
   ("drill-down money shot") **passes** instead of skipping, this UAT item is
   satisfied by the suite itself and WINDOWS entries 9 and 13 can be closed.
3. Manual fallback: open that order at `/orders/<id>`, click the top ranked loss
   card, and confirm the Timeline page's shift selector matches the loss's shift
   and the band pulses.

Do NOT force the condition by injecting a breakdown to manufacture an AT_RISK
order — `v_order_status` uses
`COALESCE(NULLIF(recent.goodPerSec, 0), fallback.goodPerSec, 0)`, so a fully
downed product falls back to the ideal rate and reads healthy. Only a partial
collapse trips it, and only in a transient window. That shortcut is explicitly
forbidden in the phase plans.
