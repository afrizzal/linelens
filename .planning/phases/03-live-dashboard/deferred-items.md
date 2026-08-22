# Deferred Items

Out-of-scope discoveries logged during execution, per the executor's SCOPE BOUNDARY rule
("only auto-fix issues DIRECTLY caused by the current task's changes").

## 03-02

- **`apps/worker` pre-existing `tsc --noEmit` failures (not caused by 03-02, not fixed).**
  `pnpm -r run typecheck` fails on `apps/worker` with 15 `TS7006: Parameter '...' implicitly
  has an 'any' type` errors across `src/derive/prisma-store.ts`, `src/derive/runner.ts`, and
  `test/golden.test.ts` (callback params on raw-SQL/`$transaction` results: `s`, `r`, `tx`).
  Confirmed pre-existing via `git stash` (errors persist identically with all 03-02 changes
  reverted) — unrelated to the `@linelens/contracts` Turbopack fix or any 03-02 file. Runtime
  is unaffected: the full monorepo `pnpm vitest run` suite (24 files / 93 tests, including
  `apps/worker`'s testcontainers-based `ingest.integration.test.ts`) passes. Left unfixed per
  the executor's scope boundary — flag for a future phase's typecheck cleanup.
