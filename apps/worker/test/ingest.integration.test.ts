import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mqtt, { type MqttClient } from 'mqtt';
import pino from 'pino';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { topicFor } from '@linelens/contracts';
import { createDb, type Db } from '@linelens/db';
import { createIngestion, type IngestHandle } from '../src/ingest.js';

/**
 * Integration test for the worker's MQTT ingestion path (plan
 * 02-01-PLAN.md Task 3 verify). Deliberately uses:
 *  - a DISPOSABLE Postgres via testcontainers (fresh schema per run), and
 *  - the REAL compose Mosquitto broker (eclipse-mosquitto:2.0.22,
 *    persistence true) at mqtt://localhost:1883 — an in-process fake broker
 *    (e.g. aedes) cannot honestly validate persisted QoS1/clean:false
 *    session survival across a client restart, which is exactly the
 *    property under test.
 *
 * Requires: `docker compose up -d db mqtt` running (mqtt published on
 * host:1883) and Docker available for testcontainers. Skipped automatically
 * if neither is reachable.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MQTT_URL = process.env.TEST_MQTT_URL ?? 'mqtt://localhost:1883';
// Unique per test run so this suite never collides with the live simulator's
// continuous stream (same broker, same wildcard subscription) or with a
// previous run's leftover retained/queued state.
const TEST_LINE_ID = `TEST-L-${Date.now()}`;
const TEST_MACHINE_ID = `TEST-M-${Date.now()}`;
const TOPIC = topicFor({ lineId: TEST_LINE_ID, machineId: TEST_MACHINE_ID });

const logger = pino({ name: 'ingest-integration-test', level: 'silent' });

const runMigrateDeploy = (databaseUrl: string): void => {
  // shell:true here (test-only, fixed argv, no untrusted input) — Windows
  // cannot execFileSync a .cmd shim without shell interpretation.
  execFileSync('pnpm', ['--filter', '@linelens/db', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
};

const buildCountsPayload = (seq: number) => ({
  v: 1,
  machineId: TEST_MACHINE_ID,
  lineId: TEST_LINE_ID,
  simTime: new Date(Date.UTC(2026, 0, 6, 7, 0, 0) + seq * 1000).toISOString(),
  seq,
  kind: 'COUNTS',
  goodDelta: 1,
  rejectDelta: 0,
  rejectReason: null,
  idealCycleTimeSec: 3,
  productId: 'CYC-A',
});

/** Publish `count` COUNTS events (seq 0..count-1) at QoS 1, resolving once all publishes are acked. */
const publishBatch = (client: MqttClient, count: number): Promise<void> =>
  Promise.all(
    Array.from({ length: count }, (_, seq) => {
      const payload = JSON.stringify(buildCountsPayload(seq));
      return new Promise<void>((resolve, reject) => {
        client.publish(TOPIC, payload, { qos: 1 }, (err) => (err ? reject(err) : resolve()));
      });
    }),
  ).then(() => undefined);

/**
 * Poll the DB until the row count for TEST_MACHINE_ID reaches `target` (or
 * the timeout elapses, returning whatever was last observed). Polling to a
 * known target — rather than "stable for N ms" — avoids a race where a
 * large batch's tail is still in flight when a stability window happens to
 * land quietly.
 */
const waitForCount = async (db: Db, target: number, timeoutMs = 15_000): Promise<number> => {
  const start = Date.now();
  let last = -1;
  while (Date.now() - start < timeoutMs) {
    last = await db.machineEvent.count({ where: { machineId: TEST_MACHINE_ID } });
    if (last >= target) return last;
    await new Promise((r) => setTimeout(r, 150));
  }
  return last;
};

/** Wait for an mqtt client to connect AND its (single) subscribe call to be acked. */
const waitUntilSubscribed = (client: MqttClient): Promise<void> =>
  new Promise<void>((resolve) => {
    if (client.connected) {
      // Already connected by the time we checked — give the in-flight
      // subscribe (fired from ingest.ts's own 'connect' handler) a moment.
      setTimeout(resolve, 300);
      return;
    }
    client.once('connect', () => setTimeout(resolve, 300));
  });

describe('worker ingestion (integration: testcontainers postgres + compose mosquitto)', () => {
  let pg: StartedPostgreSqlContainer;
  let db: Db;
  let publisher: MqttClient;

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:18')
      .withDatabase('linelens_test')
      .withUsername('linelens')
      .withPassword('linelens-test')
      .start();

    const databaseUrl = pg.getConnectionUri();
    runMigrateDeploy(databaseUrl);
    db = createDb(databaseUrl);

    publisher = mqtt.connect(MQTT_URL, { clientId: `ingest-test-publisher-${Date.now()}` });
    await new Promise<void>((resolve, reject) => {
      publisher.once('connect', () => resolve());
      publisher.once('error', reject);
    });
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (!publisher) return resolve();
      publisher.end(false, () => resolve());
    });
    await db?.$disconnect();
    await pg?.stop();
  }, 30_000);

  it(
    'persists 800 rows from 1000 publishes with 200 duplicated seqs (idempotent on (machineId, seq))',
    async () => {
      // Own consumer, closed at the end of this test — kept from leaking
      // into the next test (which needs to observe redelivery to a FRESH
      // consumer in isolation, not a still-connected one from here).
      const ingestion: IngestHandle = createIngestion({
        db,
        logger,
        mqttUrl: MQTT_URL,
        clientId: `linelens-worker-test-${Date.now()}`,
      });
      // Wait for connect+subscribe BEFORE publishing — otherwise the early
      // messages race the SUBSCRIBE and are silently not delivered (a fresh
      // clientId has no prior session for the broker to queue them against).
      await waitUntilSubscribed(ingestion.client);

      // seqs 0..799 unique, then 200 more publishes repeating seqs 0..199 —
      // 1000 total publishes, 800 distinct (machineId, seq) keys.
      await publishBatch(publisher, 800);
      await publishBatch(publisher, 200);

      const count = await waitForCount(db, 800);
      expect(count).toBe(800);

      // Re-run the exact same publish set — still 800 (idempotent replay).
      await publishBatch(publisher, 800);
      await publishBatch(publisher, 200);
      const countAfterReplay = await waitForCount(db, 800);
      expect(countAfterReplay).toBe(800);

      await ingestion.close();
    },
    30_000,
  );

  it(
    'survives a kill+restart mid-stream with no loss and no duplicates (QoS1 persistent session)',
    async () => {
      const restartClientId = `linelens-worker-test-restart-${Date.now()}`;

      // 1. Connect + subscribe under a fresh persistent session, then
      //    force-kill it (simulates a worker crash) BEFORE any of the next
      //    batch is published — so the broker has nothing to redeliver yet,
      //    only a live subscription recorded against this clientId. No
      //    other consumer is subscribed at this point (the previous test's
      //    ingestion was closed) — redelivery to `resumedIngestion` below
      //    is the ONLY path these events can reach the DB through.
      const restartIngestion = createIngestion({ db, logger, mqttUrl: MQTT_URL, clientId: restartClientId });
      await waitUntilSubscribed(restartIngestion.client);
      restartIngestion.client.end(true); // force=true: raw disconnect, no DISCONNECT packet — session persists

      // 2. Publish while the worker is "down" — clean:false + QoS1 means
      //    the broker queues these against the now-disconnected session
      //    instead of dropping them.
      await publishBatch(publisher, 1100); // seqs 0..1099 (re-publishes 0..799 too — still idempotent)

      // 3. Reconnect with the SAME clientId — broker replays the queued
      //    backlog, resuming the stream with no gap.
      const resumedIngestion = createIngestion({ db, logger, mqttUrl: MQTT_URL, clientId: restartClientId });
      const finalCount = await waitForCount(db, 1100, 25_000);
      await resumedIngestion.close();

      expect(finalCount).toBe(1100);

      const distinctKeys = await db.machineEvent.groupBy({
        by: ['machineId', 'seq'],
        where: { machineId: TEST_MACHINE_ID },
        _count: true,
      });
      // One row per (machineId, seq) — the unique constraint + skipDuplicates
      // guarantee this, but assert it explicitly as the idempotency proof.
      expect(distinctKeys.length).toBe(finalCount);
    },
    45_000,
  );
});
