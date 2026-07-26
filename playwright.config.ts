import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests for the running `docker compose up` appliance.
 *
 * These are NOT unit tests — they assert against a live stack, which is exactly
 * what the Phase 1 human-UAT item asked a person to check by hand. Bring the
 * stack up first (`docker compose up -d`), then `pnpm test:smoke`.
 *
 * Deliberately no `webServer:` block — Playwright must not start the app itself.
 * The whole point is to verify the *compose-composed* system, including that the
 * simulator's MQTT publishing and control endpoint work inside the container
 * network with healthcheck-gated ordering.
 */
export default defineConfig({
  testDir: './tests/smoke',
  // The stack is shared mutable state (one broker, one simulator clock) — parallel
  // workers would inject breakdowns into each other's assertions.
  workers: 1,
  fullyParallel: false,
  // Sim clock runs at SIM_SPEED (default 60x), but MQTT publishes in real time;
  // a cold `next dev` first-request compile can take ~10s.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: process.env.LINELENS_WEB_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
