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

  logger.info({ from: new Date(SIM_START).toISOString(), to: new Date(GO_LIVE).toISOString() }, 'warm-starting plant through prior sim-day');
  plant.advanceAll(GO_LIVE);
  logger.info('warm-start complete; entering live loop at go-live');

  let clock: ClockState = {
    epochSimMs: GO_LIVE,
    startedAtRealMs: Date.now(),
    speed: config.speed,
    pausedAtRealMs: null,
  };

  const getClock = (): ClockState => clock;
  const setClock = (c: ClockState): void => {
    clock = c;
  };
  const simNow = (): number => computeSimNow(clock, Date.now());

  const server = createControlServer({ plant, getClock, setClock, simNow, nowRealMs: () => Date.now(), logger }, CONTROL_PORT);

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
