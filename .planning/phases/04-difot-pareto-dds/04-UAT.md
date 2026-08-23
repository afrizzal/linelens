---
status: testing
phase: 04-difot-pareto-dds
source: [04-VERIFICATION.md]
started: 2026-08-23T10:20:00Z
updated: 2026-08-23T10:20:00Z
---

## Current Test

number: 1
name: Live drill-down click-through lands on the correct shift with the band pulsing
expected: |
  Opening a real LATE or AT_RISK order's detail page and clicking its top ranked
  loss card navigates to /timeline with the linked line, shift and shift-date.
  The shift selector shows the LINKED loss's shift — not the sim's currently
  active shift — and the target state-interval band visibly pulses amber.
awaiting: user response

## Tests

### 1. Live drill-down click-through lands on the correct shift with the band pulsing
expected: The deep link lands on the correct line/shift/date (not silently overridden back to the sim's currently-active shift) and the target state-interval band visibly pulses amber.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
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
