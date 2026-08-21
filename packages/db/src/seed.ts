import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PlantConfigSchema,
  REASON_CODES,
  resolveCalibration,
  type PlantConfig,
} from '@linelens/contracts';
import type { Db } from './client.js';

// Repo root plant.config.json — this file lives at packages/db/src/seed.ts,
// three directories below the repo root (src -> db -> packages -> root).
const DEFAULT_CONFIG_URL = new URL('../../../plant.config.json', import.meta.url);

/**
 * Advisory lock key for seeding. Arbitrary but stable — keeps concurrent
 * seed attempts (e.g. `pnpm db:seed` racing the worker's own
 * seed-if-empty-on-boot) from upserting the same rows at once. Does not
 * collide with any other advisory-lock use in this codebase (none yet).
 */
const SEED_LOCK_KEY = 727271;

export interface SeedCounts {
  lines: number;
  products: number;
  machines: number;
  shifts: number;
  reasonCodes: number;
}

const loadPlantConfig = (configPath?: string): PlantConfig => {
  const resolvedPath = configPath ?? process.env.PLANT_CONFIG_PATH ?? fileURLToPath(DEFAULT_CONFIG_URL);
  const raw = readFileSync(path.resolve(resolvedPath), 'utf-8');
  return PlantConfigSchema.parse(JSON.parse(raw));
};

/**
 * Upsert master data from plant.config.json (+ the contracts REASON_CODES
 * taxonomy) into Products/Lines/Machines/Shifts/ReasonCodes. Idempotent:
 * running twice produces identical row counts. Machine
 * changeoverTargetMin/startupWindowMin are resolved via contracts
 * `resolveCalibration()` — the SAME source the simulator uses, never
 * re-derived here, so the OEE engine's overage split later runs against the
 * target the sim actually used.
 *
 * Does NOT touch SimClock — the simulator owns that clock; the worker syncs
 * it separately by polling the simulator's /clock endpoint (see main.ts).
 */
export const runSeed = async (db: Db, configPath?: string): Promise<SeedCounts> => {
  const config = loadPlantConfig(configPath);

  await db.$executeRaw`SELECT pg_advisory_lock(${SEED_LOCK_KEY})`;
  try {
    for (const p of config.products) {
      await db.product.upsert({
        where: { id: p.id },
        create: { id: p.id, name: p.name, idealCycleTimeSec: p.idealCycleTimeSec },
        update: { name: p.name, idealCycleTimeSec: p.idealCycleTimeSec },
      });
    }

    for (const line of config.lines) {
      await db.line.upsert({
        where: { id: line.id },
        create: { id: line.id, name: line.name },
        update: { name: line.name },
      });
    }

    for (const line of config.lines) {
      for (const m of line.machines) {
        const calibration = resolveCalibration(m);
        const data = {
          lineId: line.id,
          name: m.name,
          profile: m.profile,
          changeoverTargetMin: calibration.changeoverTargetMin,
          startupWindowMin: calibration.startupWindowMin,
          currentProductId: m.productId,
        };
        await db.machine.upsert({
          where: { id: m.id },
          create: { id: m.id, ...data },
          update: data,
        });
      }
    }

    for (const s of config.shifts) {
      await db.shift.upsert({
        where: { id: s.id },
        create: { id: s.id, name: s.name, startMin: s.startMin, endMin: s.endMin, breaks: s.breaks },
        update: { name: s.name, startMin: s.startMin, endMin: s.endMin, breaks: s.breaks },
      });
    }

    // Reason-code taxonomy comes from @linelens/contracts, not plant.config.json.
    for (const r of REASON_CODES) {
      await db.reasonCode.upsert({
        where: { code: r.code },
        create: { code: r.code, label: r.label, category: r.category },
        update: { label: r.label, category: r.category },
      });
    }
  } finally {
    await db.$executeRaw`SELECT pg_advisory_unlock(${SEED_LOCK_KEY})`;
  }

  return {
    lines: await db.line.count(),
    products: await db.product.count(),
    machines: await db.machine.count(),
    shifts: await db.shift.count(),
    reasonCodes: await db.reasonCode.count(),
  };
};

/**
 * Boot-time guard for the worker (compose-friendly): only seeds if master
 * data looks absent (no lines seeded yet). Wrapped in the same advisory
 * lock as `runSeed` so a fresh `docker compose up` with the worker racing
 * a manual `pnpm db:seed` can't double-run the upserts concurrently.
 */
export const seedIfEmpty = async (
  db: Db,
  configPath?: string,
): Promise<{ seeded: boolean; counts: SeedCounts }> => {
  const existingLines = await db.line.count();
  if (existingLines > 0) {
    return {
      seeded: false,
      counts: {
        lines: existingLines,
        products: await db.product.count(),
        machines: await db.machine.count(),
        shifts: await db.shift.count(),
        reasonCodes: await db.reasonCode.count(),
      },
    };
  }
  const counts = await runSeed(db, configPath);
  return { seeded: true, counts };
};
