---
status: testing
phase: 02-oee-engine
source: [02-VERIFICATION.md]
started: 2026-08-22T06:20:00Z
updated: 2026-08-22T06:20:00Z
---

## Current Test

number: 1
name: Decide whether to harden apps/worker's vitest concurrency before relying on this suite unattended
expected: |
  Either (a) an explicit concurrency guard is added so the container-heavy integration
  tests never race for Docker/DB resources, or (b) a documented decision that the
  occasional flake is an accepted risk for now.
awaiting: user response

## Tests

### 1. Vitest concurrency hardening for Testcontainers-based tests
expected: |
  5 of 9 files in apps/worker spin up Testcontainers (golden.test.ts,
  invariance.test.ts, ingest.integration.test.ts, notify.test.ts,
  sim-now-timezone.test.ts). The repo has no vitest pool/concurrency config and no
  CI workflow yet.

  Accept EITHER:
  (a) A concurrency guard — e.g. `fileParallelism: false`, or a
      `poolOptions.forks.maxForks` cap scoped to the container-based files — so
      Docker/DB resources are never contended.
  (b) An explicit, documented decision to accept the flake risk until a CI
      pipeline exists.

  Evidence for the risk: one full-suite run during orchestration reported
  "2 failed files / 4 skipped"; two subsequent runs and two verifier re-runs were
  clean at 88/88. No `.skip` logic exists anywhere in the suite, which rules out
  conditional skipping and points at resource contention.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

None. All 6 must-haves verified, all 5 ROADMAP Phase 2 success criteria met, all of
ENG-01..ENG-06 traced to concrete code and tests. The single item above is a
CI-hardening policy call, not a correctness defect.
