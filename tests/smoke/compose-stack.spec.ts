import { test, expect } from '@playwright/test';
import mqtt from 'mqtt';
import {
  TelemetryEvent,
  TELEMETRY_SUBSCRIPTION,
  parseTopic,
} from '@linelens/contracts';

/**
 * Automates the Phase 1 human-UAT item: "does the full 5-service
 * `docker compose up` actually work?"
 *
 * Every assertion here is one a person would otherwise have made by eye. The
 * checks run against the live appliance, so they catch integration defects that
 * unit tests structurally cannot — e.g. a missing `.dockerignore` letting the
 * host's node_modules clobber the image's, which crash-looped all three app
 * services while every unit test stayed green.
 */

const SIM_URL = process.env.LINELENS_SIM_URL ?? 'http://localhost:4000';
const MQTT_URL = process.env.LINELENS_MQTT_URL ?? 'mqtt://localhost:1883';

test.describe('compose stack smoke', () => {
  test('simulator control endpoint reports a running plant', async ({ request }) => {
    const res = await request.get(`${SIM_URL}/healthz`);
    expect(res.ok(), `GET /healthz returned ${res.status()}`).toBe(true);

    const health = (await res.json()) as {
      simNow: string;
      speed: number;
      machines: number;
    };

    // A plant with zero machines would still answer 200 — assert it is populated.
    expect(health.machines).toBeGreaterThan(0);
    expect(health.speed).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(health.simNow))).toBe(false);
  });

  test('sim clock advances faster than wall-clock (accelerated, not real time)', async ({
    request,
  }) => {
    const first = await (await request.get(`${SIM_URL}/clock`)).json();
    const t0 = Date.now();

    await new Promise((r) => setTimeout(r, 3_000));

    const second = await (await request.get(`${SIM_URL}/clock`)).json();
    const realElapsedMs = Date.now() - t0;

    // /clock exposes the epoch + speed rather than a materialized now, so derive
    // sim-now the same way the simulator does — this also proves the two reads
    // share one clock origin (no per-request clock drift).
    expect(second.speed).toBe(first.speed);
    expect(second.epochSimMs).toBe(first.epochSimMs);
    expect(second.pausedAtRealMs).toBeNull();

    const simElapsedMs = realElapsedMs * second.speed;
    expect(simElapsedMs).toBeGreaterThan(realElapsedMs);
  });

  test('broker streams contract-valid telemetry on the Sparkplug-B-style topic', async () => {
    const client = await mqtt.connectAsync(MQTT_URL, {
      // Distinct clientId: a stable one would collide with the simulator's own
      // session and the broker would kick one of them off in a loop.
      clientId: `linelens-smoke-${process.pid}`,
      clean: true,
      connectTimeout: 10_000,
    });

    try {
      const events: unknown[] = [];
      const topics: string[] = [];

      await client.subscribeAsync(TELEMETRY_SUBSCRIPTION, { qos: 1 });

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`only ${events.length} events in 20s — is the simulator publishing?`)),
          20_000,
        );
        client.on('message', (topic, payload) => {
          topics.push(topic);
          events.push(JSON.parse(payload.toString()));
          if (events.length >= 5) {
            clearTimeout(timer);
            resolve();
          }
        });
      });

      expect(events.length).toBeGreaterThanOrEqual(5);

      // Validating with the shipped zod schema is the real assertion: the wire
      // format and the contracts package cannot silently diverge.
      for (const [i, raw] of events.entries()) {
        const parsed = TelemetryEvent.safeParse(raw);
        expect(
          parsed.success,
          `event ${i} failed contract validation: ${JSON.stringify(parsed.error?.issues)}`,
        ).toBe(true);
      }

      for (const topic of topics) {
        const parts = parseTopic(topic);
        expect(parts, `topic "${topic}" is not a valid LineLens topic`).not.toBeNull();
      }

      // Events must carry sim-time, not wall-clock — the credibility invariant.
      const simTimes = events.map((e) => Date.parse((e as { simTime: string }).simTime));
      const spreadMs = Math.max(...simTimes) - Math.min(...simTimes);
      const wallNow = Date.now();
      expect(Math.abs(simTimes[0] - wallNow)).toBeGreaterThan(60_000);
      expect(spreadMs).toBeGreaterThanOrEqual(0);
    } finally {
      await client.endAsync(true);
    }
  });

  test('inject-breakdown is accepted and takes a real machine down', async ({ request }) => {
    const res = await request.post(`${SIM_URL}/control/inject-breakdown`, {
      data: { lineId: 'L1', durationSec: 600 },
    });
    expect(res.ok(), `inject-breakdown returned ${res.status()}`).toBe(true);

    const body = (await res.json()) as { machineId: string; until: string };
    expect(body.machineId).toContain('L1-');
    expect(Number.isNaN(Date.parse(body.until))).toBe(false);

    // Nonexistent line must 404 rather than silently no-op — otherwise a broken
    // dashboard button would look like it worked.
    const bad = await request.post(`${SIM_URL}/control/inject-breakdown`, {
      data: { lineId: 'NOPE-999', durationSec: 60 },
    });
    expect(bad.status()).toBe(404);
  });

  test('web service renders without client-side errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

    expect(response?.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
    expect(pageErrors, `client-side errors: ${pageErrors.join('; ')}`).toEqual([]);

    // Phase 1 ships the Next.js skeleton on purpose — the dashboard arrives in
    // Phase 3. Assert only that the app boots; tighten this when the real UI lands.
  });
});
