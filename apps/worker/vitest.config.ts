import { defineConfig } from 'vitest/config';

/**
 * Worker-scoped test config.
 *
 * WHY `fileParallelism: false`: 5 of this package's 9 test files stand up real
 * Testcontainers (golden, invariance, ingest.integration, notify,
 * sim-now-timezone) — some of them TWO containers at once (postgres +
 * eclipse-mosquitto), and invariance.test.ts alone runs two separate Postgres
 * databases side by side. Run in parallel they contend for Docker daemon,
 * host ports and memory; that contention produced an observed one-off
 * "2 failed files" run during phase 02 execution that did not reproduce on
 * four subsequent runs. A flaky suite cannot serve as this project's
 * credibility gate, so the container-heavy package runs its files one at a
 * time.
 *
 * Scoped deliberately to `apps/worker`: Vitest resolves `fileParallelism`
 * from each project's OWN options (project config wins over root), and
 * `false` pins this project to maxWorkers: 1 without slowing the other
 * projects — no other package in the workspace uses Testcontainers.
 *
 * Timeouts are raised, never lowered: container pull/boot far exceeds
 * Vitest's 5s test / 10s hook defaults. Individual tests that already pass
 * an explicit timeout argument keep it.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
