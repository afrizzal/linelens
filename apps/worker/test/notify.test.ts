import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client as PgClient } from 'pg';
import pino from 'pino';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@linelens/db';
import { startDerivationLoop, type DerivationLoopHandle } from '../src/derive/runner.js';
import { createNotifier, type Notifier } from '../src/notify.js';

/**
 * Task 4 <verify>: run derivation over a burst of 500 events -> the LISTEN
 * client receives <=~8 notifications (coalescing works), each valid JSON.
 *
 * Disposable Postgres via testcontainers (no compose stack needed — same
 * hermetic-suite discipline as ingest.integration.test.ts's Finding 1 fix).
 * batchSize is deliberately small (100) so the 500-event burst requires
 * multiple poll ticks to fully drain, each producing a notifyLineIds call
 * for the SAME single line — bounding the worst case (no coalescing at
 * all) to ceil(500/100)=5 NOTIFYs, well under the plan's "<=~8", while
 * still proving the core property: 500 raw events never produce anywhere
 * near 500 NOTIFYs. A second, purely-timer-driven test below proves the
 * 250ms coalescing window itself deterministically (no DB-latency
 * dependence): 50 rapid notifyLineIds calls collapse into exactly one NOTIFY.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const logger = pino({ name: 'notify-integration-test', level: 'silent' });
const MACHINE_ID = 'M-NOTIFY-01';
const LINE_ID = 'L-NOTIFY-01';
const T0 = Date.UTC(2026, 0, 6, 7, 0, 0);

const runMigrateDeploy = (databaseUrl: string): void => {
  execFileSync('pnpm', ['--filter', '@linelens/db', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
};

describe('coalesced NOTIFY (integration: testcontainers postgres, disposable)', () => {
  let pg: StartedPostgreSqlContainer;
  let databaseUrl: string;
  let db: Db;
  let listener: PgClient;
  let notifier: Notifier;
  let loop: DerivationLoopHandle;
  const received: Array<{ channel: string; payload: string | undefined }> = [];

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:18')
      .withDatabase('linelens_test')
      .withUsername('linelens')
      .withPassword('linelens-test')
      .start();
    databaseUrl = pg.getConnectionUri();
    runMigrateDeploy(databaseUrl);
    db = createDb(databaseUrl);

    await db.line.create({ data: { id: LINE_ID, name: 'Notify Test Line' } });
    await db.machine.create({
      data: { id: MACHINE_ID, lineId: LINE_ID, name: 'Notify Test Machine', profile: 'typical', changeoverTargetMin: 20, startupWindowMin: 5 },
    });

    listener = new PgClient({ connectionString: databaseUrl });
    await listener.connect();
    await listener.query('LISTEN linelens');
    listener.on('notification', (msg) => received.push({ channel: msg.channel, payload: msg.payload }));

    notifier = await createNotifier({ connectionString: databaseUrl, logger, coalesceMs: 250 });
  }, 60_000);

  afterAll(async () => {
    loop?.stop();
    await notifier?.close();
    await listener?.end();
    await db?.$disconnect();
    await pg?.stop();
  }, 30_000);

  it('a 500-event burst, drained over ~5 batches, coalesces into <=8 NOTIFYs of valid JSON', async () => {
    // 500 STATE_CHANGE events alternating EXECUTE/DOWN every 5 sim-minutes —
    // a plausible-shaped burst, all on one machine/line so coalescing has
    // exactly one lineId to collapse repeatedly. batchSize=100 bounds this
    // to AT MOST 5 poll ticks (ceil(500/100)) regardless of real DB/network
    // latency in this environment — even in the worst case (every tick's
    // notifyLineIds call lands outside the previous flush's 250ms window,
    // so the notifier's timer coalescing contributes nothing extra), 5
    // NOTIFYs comfortably satisfies the plan's "<=~8" — and still proves
    // the core Anti-Pattern-7 property that matters most: 500 raw events
    // never produce anywhere near 500 NOTIFYs (one per batch, not per event).
    const rows = Array.from({ length: 500 }, (_, i) => ({
      machineId: MACHINE_ID,
      lineId: LINE_ID,
      kind: 'STATE_CHANGE',
      simTime: new Date(T0 + i * 5 * 60_000),
      seq: i,
      state: i % 2 === 0 ? 'EXECUTE' : 'DOWN',
      reasonCode: i % 2 === 0 ? null : 'BRK-MECH',
    }));
    await db.machineEvent.createMany({ data: rows });

    loop = startDerivationLoop({
      db,
      logger,
      intervalMs: 30,
      batchSize: 100, // 500 events / 100 per tick = 5 ticks to fully drain
      onLineIdsChanged: (lineIds) => notifier.notifyLineIds(lineIds),
    });

    // Wait until the cursor has consumed all 500 events (id 1..500).
    const deadline = Date.now() + 20_000;
    let lastEventId = 0n;
    while (Date.now() < deadline) {
      const cursor = await db.machineCursor.findUnique({ where: { machineId: MACHINE_ID } });
      lastEventId = cursor?.lastEventId ?? 0n;
      if (lastEventId >= 500n) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(lastEventId).toBe(500n);

    loop.stop();
    await notifier.flush();
    // Give the LISTEN client's async notification delivery a moment to catch up.
    await new Promise((r) => setTimeout(r, 300));

    expect(received.length).toBeGreaterThan(0);
    expect(received.length).toBeLessThanOrEqual(8);
    for (const n of received) {
      expect(n.channel).toBe('linelens');
      expect(() => JSON.parse(n.payload ?? '')).not.toThrow();
      const parsed = JSON.parse(n.payload ?? '{}') as { kinds: string[]; lineIds: string[] };
      expect(parsed.kinds).toEqual(['telemetry']);
      expect(parsed.lineIds).toEqual([LINE_ID]);
    }
  }, 30_000);

  it('the coalescing timer itself collapses many rapid notifyLineIds calls into exactly one NOTIFY (deterministic, no DB-latency dependence)', async () => {
    received.length = 0;
    for (let i = 0; i < 50; i++) {
      notifier.notifyLineIds([LINE_ID]); // 50 synchronous calls, well within one 250ms coalescing window
    }
    await new Promise((r) => setTimeout(r, 400)); // > coalesceMs so the pending flush fires
    expect(received).toHaveLength(1);
    const parsed = JSON.parse(received[0]?.payload ?? '{}') as { kinds: string[]; lineIds: string[] };
    expect(parsed).toEqual({ kinds: ['telemetry'], lineIds: [LINE_ID] });
  });
});
