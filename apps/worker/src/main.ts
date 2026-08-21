import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { createDb, seedIfEmpty, type Db } from '@linelens/db';
import { startDerivationLoop } from './derive/runner.js';
import { createIngestion } from './ingest.js';
import { createNotifier } from './notify.js';

const logger = pino({ name: 'linelens-worker', level: process.env.LOG_LEVEL ?? 'info' });

// Repo root — apps/worker/src/main.ts is three directories below it
// (src -> worker -> apps -> root), same depth pattern the simulator uses
// for plant.config.json resolution.
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
const SIMULATOR_URL = process.env.SIMULATOR_URL ?? 'http://localhost:4000';
const CLOCK_POLL_MS = 2000;

/**
 * Run pending migrations at boot (compose-friendly: a fresh `docker compose
 * up` self-migrates with no manual step). Shells out to the Prisma CLI in
 * @linelens/db's own package context so prisma.config.ts resolves relative
 * to itself regardless of the worker's cwd.
 */
const runMigrations = (): void => {
  logger.info('running prisma migrate deploy');
  // Resolve the pnpm binary explicitly (rather than `shell: true`) — passing
  // args through a shell without escaping is a Node-flagged footgun
  // (DEP0190); Windows local dev needs the .cmd shim, Linux (the docker
  // image) does not.
  const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  execFileSync(pnpmBin, ['--filter', '@linelens/db', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
};

interface SimulatorClockState {
  epochSimMs: number;
  startedAtRealMs: number;
  speed: number;
  pausedAtRealMs: number | null;
}

interface ClockRow {
  epochSimMs: bigint;
  startedAtRealMs: bigint;
  speed: number;
  pausedAtRealMs: bigint | null;
}

const toClockRow = (clock: SimulatorClockState): ClockRow => ({
  epochSimMs: BigInt(clock.epochSimMs),
  startedAtRealMs: BigInt(clock.startedAtRealMs),
  speed: clock.speed,
  pausedAtRealMs: clock.pausedAtRealMs === null ? null : BigInt(clock.pausedAtRealMs),
});

const clockRowsEqual = (a: ClockRow, b: ClockRow | null): boolean =>
  b !== null &&
  a.epochSimMs === b.epochSimMs &&
  a.startedAtRealMs === b.startedAtRealMs &&
  a.speed === b.speed &&
  a.pausedAtRealMs === b.pausedAtRealMs;

/**
 * Sync the SimClock singleton from the simulator's authoritative
 * ClockState. The simulator owns the clock; the worker is the sole
 * Postgres writer (ENG-01) — it mirrors, never derives, the clock. Polled
 * every 2s: ClockState fields are absolute (not deltas), so sim_now()
 * stays continuous between polls — the poll only needs to catch rebases
 * (boot, warm-start completion, /control/speed).
 */
const syncClock = async (db: Db): Promise<void> => {
  try {
    const res = await fetch(`${SIMULATOR_URL}/clock`);
    if (!res.ok) {
      logger.warn({ status: res.status }, 'clock poll: non-OK response');
      return;
    }
    const clock = (await res.json()) as SimulatorClockState;
    const row = toClockRow(clock);
    const existing = await db.simClock.findUnique({ where: { id: 1 } });
    if (clockRowsEqual(row, existing)) return;

    await db.simClock.upsert({
      where: { id: 1 },
      create: { id: 1, ...row },
      update: row,
    });
    logger.info({ clock }, 'sim_clock synced');
  } catch (err) {
    logger.warn({ err }, 'clock poll failed');
  }
};

const main = async (): Promise<void> => {
  runMigrations();

  const db = createDb();
  const seedResult = await seedIfEmpty(db);
  logger.info(seedResult, 'seed-if-empty complete');

  await syncClock(db);
  const clockInterval = setInterval(() => void syncClock(db), CLOCK_POLL_MS);

  const ingestion = createIngestion({ db, logger, mqttUrl: MQTT_URL });

  // The OEE engine: machine_event -> state_interval -> loss_event
  // (02-02-PLAN.md). The notifier is a DEDICATED raw pg connection (never
  // Prisma, never pooled — see notify.ts); DATABASE_URL is required to get
  // this far (createDb() above already throws if it's unset).
  const notifier = await createNotifier({ connectionString: process.env.DATABASE_URL!, logger });
  const derivationLoop = startDerivationLoop({
    db,
    logger,
    onLineIdsChanged: (lineIds) => notifier.notifyLineIds(lineIds),
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down worker');
    clearInterval(clockInterval);
    derivationLoop.stop();
    await ingestion.close();
    await notifier.close();
    await db.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('worker started');
};

main().catch((err) => {
  logger.error({ err }, 'worker failed to start');
  process.exit(1);
});
