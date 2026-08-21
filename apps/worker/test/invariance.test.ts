import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client as PgClient } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlantConfigSchema, type TelemetryEvent } from '@linelens/contracts';
import { createDb, runSeed, type Db } from '@linelens/db';
import { createPlant } from '../../simulator/src/plant.js';
import { startDerivationLoop } from '../src/derive/runner.js';

/**
 * 02-03-PLAN.md Task 3 — ENG-06 acceleration invariance, spanning the
 * simulator AND the OEE engine (the "definitive no-wall-clock-leak proof"
 * per the plan). Runs the REAL pure simulator plant (apps/simulator/src/
 * plant.ts + machine.ts, seed 42, real plant.config.json) for 6 sim-hours,
 * stepped at two different real-tick-to-sim-ms granularities that mimic
 * SIM_SPEED=60 vs SIM_SPEED=600 (exactly how apps/simulator/src/main.ts's
 * own `setInterval(() => plant.advanceAll(simNow()), TICK_MS)` loop
 * advances the clock in production — see computeSimNow/ClockState there).
 * Asserts:
 *  1. The two step granularities produce a BYTE-IDENTICAL event sequence
 *     (the simulator-layer half of ENG-06 — already the mechanism proven at
 *     the unit level in Phase 1's SIM-04, re-verified here end-to-end).
 *  2. Piping that (identical) event stream through the REAL derivation loop
 *     (apps/worker/src/derive/runner.ts — the actual production poll-tick
 *     code, not a re-implementation) into two SEPARATE Postgres databases
 *     and querying v_machine_shift_oee from each yields identical A/P/Q/OEE
 *     to 6 decimal places — proving no wall-clock leaked in anywhere across
 *     derivation + the SQL views either.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;

const runMigrateDeploy = (databaseUrl: string): void => {
  execFileSync('pnpm', ['--filter', '@linelens/db', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
};

/** Mirrors apps/worker/src/ingest.ts's toRow (not exported there) — kept local per this plan's declared file scope. */
const toMachineEventRow = (event: TelemetryEvent) => {
  const base = { machineId: event.machineId, lineId: event.lineId, kind: event.kind, simTime: new Date(event.simTime), seq: event.seq };
  switch (event.kind) {
    case 'STATE_CHANGE':
      return { ...base, state: event.state, reasonCode: event.reasonCode, meta: event.meta ?? undefined };
    case 'COUNTS':
      return {
        ...base,
        goodDelta: event.goodDelta,
        rejectDelta: event.rejectDelta,
        rejectReason: event.rejectReason,
        idealCycleTimeSec: event.idealCycleTimeSec,
        productId: event.productId,
      };
    case 'ALARM':
      return { ...base, reasonCode: event.reasonCode, durationSec: event.durationSec };
  }
};

describe('02-03 Task 3 — ENG-06 acceleration invariance (real simulator + real derivation, Testcontainers postgres:18)', () => {
  let pg: StartedPostgreSqlContainer;
  let dbA: Db;
  let dbB: Db;
  const logger = pino({ level: 'error' });

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:18').withDatabase('linelens_invariance').withUsername('linelens').withPassword('linelens-test').start();
    const baseUri = pg.getConnectionUri();

    const admin = new PgClient({ connectionString: baseUri });
    await admin.connect();
    await admin.query('CREATE DATABASE invariance_a');
    await admin.query('CREATE DATABASE invariance_b');
    await admin.end();

    const urlA = baseUri.replace(/\/[^/]+(\?.*)?$/, '/invariance_a$1');
    const urlB = baseUri.replace(/\/[^/]+(\?.*)?$/, '/invariance_b$1');

    runMigrateDeploy(urlA);
    runMigrateDeploy(urlB);
    dbA = createDb(urlA);
    dbB = createDb(urlB);

    // Real master-data seed from the real plant.config.json — same code
    // path production boots with (packages/db/src/seed.ts runSeed()).
    await runSeed(dbA);
    await runSeed(dbB);
  }, 180_000);

  afterAll(async () => {
    await dbA?.$disconnect();
    await dbB?.$disconnect();
    await pg?.stop();
  }, 60_000);

  it(
    'identical events at speed-60-like vs speed-600-like step granularity, and identical derived v_machine_shift_oee (A/P/Q/OEE to 6 dp)',
    async () => {
      const configRaw = readFileSync(path.join(REPO_ROOT, 'plant.config.json'), 'utf-8');
      const config = PlantConfigSchema.parse(JSON.parse(configRaw));
      expect(config.seed).toBe(42);

      // 07:30 sim-time — inside Shift 1 (07:00-15:00, startMin 420), so the
      // whole 6-hour window is live production (including both shift 1
      // breaks: 09:30-09:45 and 12:00-12:30), never idle schedule-loss time.
      const START_SIM_MS = Date.parse('2026-03-01T07:30:00.000Z');
      const SIX_HOURS_MS = 6 * HOUR_MS;
      const TARGET_SIM_MS = START_SIM_MS + SIX_HOURS_MS;
      const REAL_TICK_MS = 200; // matches apps/simulator/src/main.ts's TICK_MS

      // Mirrors main.ts's `setInterval(() => plant.advanceAll(simNow()), TICK_MS)`
      // with simNow() driven by ClockState at the given speed — the ONLY
      // difference between the two runs is how many sim-ms elapse per
      // simulated "real tick" (12s at speed 60, 120s at speed 600).
      const runPlant = (speed: number): TelemetryEvent[] => {
        const events: TelemetryEvent[] = [];
        const plant = createPlant({ config, onEvent: (e) => events.push(e), startSimMs: START_SIM_MS });
        const stepMs = REAL_TICK_MS * speed;
        let cursor = START_SIM_MS;
        while (cursor < TARGET_SIM_MS) {
          cursor = Math.min(cursor + stepMs, TARGET_SIM_MS);
          plant.advanceAll(cursor);
        }
        return events;
      };

      const eventsSpeed60 = runPlant(60);
      const eventsSpeed600 = runPlant(600);

      // --- Simulator-layer proof: byte-identical PER-MACHINE event streams
      // regardless of step granularity. Comparing the flat, all-machines
      // `events` array directly (in emission order) is NOT the right
      // invariant to assert: `advanceAll` iterates `machines[]` in a fixed
      // order PER CALL, so the cross-machine INTERLEAVING of the shared
      // array depends on how many advanceAll() calls it took to reach the
      // same target sim-ms (1800 calls at speed 60 vs 180 at speed 600) —
      // that's a merge-order artifact of this test's harness, not a domain
      // guarantee. What actually matters (and is what `machineId`+`seq`-
      // keyed idempotent persistence and per-machine derivation depend on,
      // per schema.prisma's MachineEvent doc) is that EACH machine's OWN
      // ordered sub-sequence is identical — which this asserts directly.
      expect(eventsSpeed60.length).toBeGreaterThan(500); // sanity: the plant actually produced meaningful activity
      expect(eventsSpeed600.length).toBe(eventsSpeed60.length);

      const byMachine = (events: TelemetryEvent[]): Map<string, TelemetryEvent[]> => {
        const map = new Map<string, TelemetryEvent[]>();
        for (const e of events) {
          const arr = map.get(e.machineId) ?? [];
          arr.push(e);
          map.set(e.machineId, arr);
        }
        return map;
      };
      const perMachine60 = byMachine(eventsSpeed60);
      const perMachine600 = byMachine(eventsSpeed600);
      expect([...perMachine600.keys()].sort()).toEqual([...perMachine60.keys()].sort());
      for (const [machineId, seq60] of perMachine60) {
        const seq600 = perMachine600.get(machineId)!;
        expect(seq600).toEqual(seq60); // byte-identical per-machine stream, any step granularity
      }

      // --- Pipe BOTH into the REAL derivation loop (production code path), separate DBs ---
      await dbA.machineEvent.createMany({ data: eventsSpeed60.map(toMachineEventRow) });
      await dbB.machineEvent.createMany({ data: eventsSpeed600.map(toMachineEventRow) });

      // Paused sim_clock at the run's end — proves the OPEN-interval clamp
      // math (LEAST(shiftEnd, sim_now())) is identical between the two
      // derivation runs too (PITFALLS.md Pitfall 2's "in-progress interval"
      // concern), not just the closed-shift case.
      for (const db of [dbA, dbB]) {
        await db.simClock.create({
          data: { id: 1, epochSimMs: BigInt(TARGET_SIM_MS), startedAtRealMs: BigInt(TARGET_SIM_MS), speed: 1, pausedAtRealMs: BigInt(TARGET_SIM_MS) },
        });
      }

      // Drain via REPEATED ticks at production's default batchSize (500),
      // not one giant tick. A single tick trying to push a machine's ENTIRE
      // multi-thousand-event 6-hour backlog through one Prisma
      // `$transaction` blew Prisma's default 5s interactive-transaction
      // timeout (P2028, "query cannot be executed on an expired
      // transaction") — silently rolling back that machine's whole batch,
      // which is exactly what runner.ts's own per-machine try/catch is
      // designed to survive by retrying next tick in production (a
      // 200ms-cadence loop never asks one transaction to do 6 hours of
      // work). Looping tick() here reproduces that same retry-until-drained
      // behavior instead of fighting the timeout with a bigger batchSize.
      const drain = async (db: Db): Promise<void> => {
        const loop = startDerivationLoop({ db, logger, intervalMs: 3_600_000 });
        for (let i = 0; i < 40; i++) {
          await loop.tick();
        }
        loop.stop();
      };
      await drain(dbA);
      await drain(dbB);

      const oeeA = await dbA.$queryRaw<
        Array<{ machineId: string; shiftDate: string; shiftId: string; availability: number | null; performance: number | null; quality: number | null; oee: number | null }>
      >`SELECT "machineId", "shiftDate", "shiftId", availability, performance, quality, oee FROM v_machine_shift_oee ORDER BY "machineId", "shiftDate", "shiftId"`;
      const oeeB = await dbB.$queryRaw<
        Array<{ machineId: string; shiftDate: string; shiftId: string; availability: number | null; performance: number | null; quality: number | null; oee: number | null }>
      >`SELECT "machineId", "shiftDate", "shiftId", availability, performance, quality, oee FROM v_machine_shift_oee ORDER BY "machineId", "shiftDate", "shiftId"`;

      expect(oeeA.length).toBeGreaterThan(0); // sanity: the 6-hour window actually produced (machine, shift) rows
      expect(oeeB.length).toBe(oeeA.length);

      for (let i = 0; i < oeeA.length; i++) {
        const a = oeeA[i]!;
        const b = oeeB[i]!;
        expect(b.machineId).toBe(a.machineId);
        expect(b.shiftDate).toBe(a.shiftDate);
        expect(b.shiftId).toBe(a.shiftId);
        for (const col of ['availability', 'performance', 'quality', 'oee'] as const) {
          if (a[col] === null || b[col] === null) {
            expect(b[col]).toBe(a[col]); // both-null or neither, never one-sided
          } else {
            expect(b[col]).toBeCloseTo(a[col]!, 6);
          }
        }
      }
    },
    600_000,
  );
});
