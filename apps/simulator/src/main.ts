import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pino from 'pino';
import { PlantConfigSchema, simNow as computeSimNow, type ClockState } from '@linelens/contracts';
import { createPlant } from './plant.js';
import { createPublisher } from './publisher.js';
import { createControlServer } from './control.js';

const logger = pino({ name: 'linelens-simulator', level: process.env.LOG_LEVEL ?? 'info' });

// Warm-start constants (pin exactly — 04-01/04-03 depend on them). SIM_START
// is one full sim-day before GO_LIVE; the simulator advances the plant
// through that day internally at boot (publishing the whole backlog), so
// "yesterday" at go-live is always a fully-completed sim-day for DDS/order
// backfill to read.
const SIM_START = Date.parse('2026-01-05T06:55:00.000Z');
const GO_LIVE = Date.parse('2026-01-06T06:55:00.000Z');

const CONTROL_PORT = Number(process.env.CONTROL_PORT ?? 4000);
const TICK_MS = 250;
// Backstop for the WINDOWS-15 ingestor handshake. Generous: the worker runs
// `prisma migrate deploy` before it subscribes (~13s observed on a cold
// volume). Only reached when no ingestion worker exists at all.
const INGESTOR_READY_TIMEOUT_MS = Number(process.env.INGESTOR_READY_TIMEOUT_MS ?? 120_000);

const defaultConfigPath = fileURLToPath(new URL('../../../plant.config.json', import.meta.url));
const configPath = process.env.PLANT_CONFIG_PATH ?? path.resolve(defaultConfigPath);

const loadConfig = () => {
  const raw = readFileSync(configPath, 'utf-8');
  const parsed = PlantConfigSchema.parse(JSON.parse(raw));
  // Env overrides (documented in .env.example): SIM_SEED/SIM_SPEED override
  // the plant.config.json defaults at boot, without mutating the file.
  const seed = process.env.SIM_SEED ? Number(process.env.SIM_SEED) : parsed.seed;
  const speed = process.env.SIM_SPEED ? Number(process.env.SIM_SPEED) : parsed.speed;
  return { ...parsed, seed, speed };
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  logger.info({ configPath, seed: config.seed, speed: config.speed, lines: config.lines.length }, 'plant config loaded');

  const mqttUrl = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
  const publisher = await createPublisher({ url: mqttUrl, logger });

  const plant = createPlant({ config, onEvent: publisher.publish, startSimMs: SIM_START });

  // The clock starts PAUSED at go-live. simNow() is therefore pinned to
  // GO_LIVE for as long as we wait on the ingestor handshake below
  // (sim-clock.ts: a non-null pausedAtRealMs freezes the clock), so waiting
  // cannot silently advance sim time past the backlog we have not published
  // yet. The live clock is installed after the warm-start burst.
  const bootRealMs = Date.now();
  let clock: ClockState = {
    epochSimMs: GO_LIVE,
    startedAtRealMs: bootRealMs,
    speed: config.speed,
    pausedAtRealMs: bootRealMs,
  };

  const getClock = (): ClockState => clock;
  const setClock = (c: ClockState): void => {
    clock = c;
  };
  const simNow = (): number => computeSimNow(clock, Date.now());

  let ingestorReady = false;
  let warmStartComplete = false;
  let releaseGate: (() => void) | null = null;
  const ingestorReadyGate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  // Control server FIRST — before the warm-start burst, not after it. compose
  // gates the worker on this service's healthcheck, so the endpoint must be
  // answering before we can wait on the worker, or the two would deadlock.
  const server = createControlServer(
    {
      plant,
      getClock,
      setClock,
      simNow,
      nowRealMs: () => Date.now(),
      onIngestorReady: () => {
        ingestorReady = true;
        releaseGate?.();
      },
      getReadiness: () => ({ ingestorReady, warmStartComplete }),
      logger,
    },
    CONTROL_PORT,
  );

  // WINDOWS 15: hold the backlog until the ingestion worker is subscribed.
  // MQTT `clean:false` + QoS1 only replays into a session that already
  // exists, so anything published before the worker's first connect is gone
  // for good — and compose *guarantees* the worker starts after us.
  logger.info({ timeoutMs: INGESTOR_READY_TIMEOUT_MS }, 'waiting for ingestor to subscribe before warm-start');
  const gateStartedAt = Date.now();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    ingestorReadyGate,
    new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(resolve, INGESTOR_READY_TIMEOUT_MS);
    }),
  ]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  if (ingestorReady) {
    logger.info({ waitedMs: Date.now() - gateStartedAt }, 'ingestor ready; releasing warm-start');
  } else {
    // Deliberately non-fatal: running the simulator without an ingestion
    // worker (bare `pnpm --filter @linelens/simulator start`) must still
    // work. Loud, because in compose this means the warm-start day is lost.
    logger.warn(
      { waitedMs: Date.now() - gateStartedAt },
      'ingestor did not report ready before timeout — warm-starting anyway; the warm-start sim-day will NOT be ingested if a worker is expected',
    );
  }

  logger.info({ from: new Date(SIM_START).toISOString(), to: new Date(GO_LIVE).toISOString() }, 'warm-starting plant through prior sim-day');
  plant.advanceAll(GO_LIVE);
  warmStartComplete = true;
  logger.info('warm-start complete; entering live loop at go-live');

  // Only now does sim time start running — measured from the end of the
  // burst, so the backlog and the live loop stay contiguous.
  clock = { epochSimMs: GO_LIVE, startedAtRealMs: Date.now(), speed: config.speed, pausedAtRealMs: null };

  const interval = setInterval(() => {
    try {
      plant.advanceAll(simNow());
    } catch (err) {
      logger.error({ err }, 'plant advance failed');
    }
  }, TICK_MS);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down simulator');
    clearInterval(interval);
    server.close();
    await publisher.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

main().catch((err) => {
  logger.error({ err }, 'simulator failed to start');
  process.exit(1);
});
