import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plannedProductionTimeMs, shiftInstanceAt, type ShiftDef, type ShiftInstance } from '@linelens/contracts';
import { createDb, type Db } from '@linelens/db';
import { processMachineBatch } from '../src/derive/intervals.js';
import { PrismaStore } from '../src/derive/prisma-store.js';
import type { DerivedEvent } from '../src/derive/types.js';

/**
 * 02-03-PLAN.md Task 2 — THE CREDIBILITY GATE. A fixture-driven integration
 * test (Testcontainers postgres:18): feed machine_event rows directly, run
 * REAL derivation (apps/worker/src/derive/*, the same code path the
 * production poll loop uses), then query the REAL SQL views (views.sql,
 * applied via `prisma migrate deploy` — the same migration the live
 * appliance runs) and assert against hand-computed numbers to 4 decimal
 * places. This SUMMARY's golden table doubles as the "factory-person
 * review" artifact (02-03-PLAN.md <success_criteria>).
 *
 * THE GOLDEN SCENARIO (one machine, simplified calendar to keep hand-math
 * exact — a dedicated 480-min TEST-SHIFT with one 30-min break, so
 * PPT = 480 - 30 = 450 min, NOT the real plant's 07:00-15:00/two-break
 * shift):
 *   PPT        = 450 min
 *   Run Time   = 450 - 30 (DOWN) - 20 (CHANGEOVER) = 400 min
 *   A          = 400/450  = 0.888889
 *   ict_time   = 380 min (380 units x 1 min/unit ICT) -> P = 380/400 = 0.950000
 *   Q          = 361/380 = 0.950000 (361 good, 19 reject: 12 RJ-DIM + 7 RJ-STARTUP)
 *   OEE        = A x P x Q = 0.802222 (80.22%)
 *   Waterfall: a_loss = 50 min, p_loss = 20 min (SMALL_STOPS 6 + SLOW_CYCLES 14), q_loss = 19 min
 *   Identity 1: a_loss + p_loss + q_loss = 89 min; PPT - 89 = 361 min
 *   Identity 2: fully productive time = PPT x OEE = 450 x 0.802222 = 361 min = good_count x ICT = 361 x 1
 *   Identity 3 (ledger reconciles to waterfall):
 *     a_loss = UNPLANNED_STOPS(30 DOWN + 5 CO-OVERAGE) + PLANNED_STOPS(15) = 50
 *     p_loss = SMALL_STOPS(6) + SLOW_CYCLES(14) = 20
 *     q_loss = STARTUP_REJECTS(7) + PRODUCTION_REJECTS(12) = 19
 *
 * LOAD-BEARING SUBTLETY: micro-stops (ALARM, rule 3) are NEVER subtracted
 * from Run Time — they occur while the machine is EXECUTE; their cost is
 * Performance loss only. Subtracting them from run time would double-count
 * p_loss and break Identity 1. This fixture proves it: run_sec is derived
 * purely from state_interval DOWN/CHANGEOVER seconds, never from the ALARM
 * events, yet p_loss still comes out to exactly 20 min via
 * run_sec - ict_sec.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIN = 60_000;
const silentLogger = { warn: () => {} };

const runMigrateDeploy = (databaseUrl: string): void => {
  execFileSync('pnpm', ['--filter', '@linelens/db', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
};

// --- Fixture builders — mirror apps/worker/test/losses.test.ts's shape ---

let nextId = 1n;
const resetIds = (): void => {
  nextId = 1n;
};

const stateChange = (
  machineId: string,
  lineId: string,
  seq: number,
  atMs: number,
  state: string,
  reasonCode: string | null = null,
): DerivedEvent => ({
  id: nextId++,
  machineId,
  lineId,
  kind: 'STATE_CHANGE',
  simTime: new Date(atMs),
  seq,
  state,
  reasonCode,
});

const counts = (
  machineId: string,
  lineId: string,
  seq: number,
  atMs: number,
  params: { goodDelta: number; rejectDelta: number; rejectReason?: string | null; idealCycleTimeSec: number },
): DerivedEvent => ({
  id: nextId++,
  machineId,
  lineId,
  kind: 'COUNTS',
  simTime: new Date(atMs),
  seq,
  goodDelta: params.goodDelta,
  rejectDelta: params.rejectDelta,
  rejectReason: params.rejectReason ?? null,
  idealCycleTimeSec: params.idealCycleTimeSec,
});

const alarm = (machineId: string, lineId: string, seq: number, atMs: number, reasonCode: string, durationSec: number): DerivedEvent => ({
  id: nextId++,
  machineId,
  lineId,
  kind: 'ALARM',
  simTime: new Date(atMs),
  seq,
  reasonCode,
  durationSec,
});

/** DerivedEvent -> the same row shape apps/worker/src/ingest.ts persists (no FK, so ids need only be internally consistent, not tied to a real machine_event autoincrement). */
const toMachineEventRow = (e: DerivedEvent) => ({
  id: e.id,
  machineId: e.machineId,
  lineId: e.lineId,
  kind: e.kind,
  simTime: e.simTime,
  seq: e.seq,
  state: e.state ?? null,
  reasonCode: e.reasonCode ?? null,
  goodDelta: e.goodDelta ?? null,
  rejectDelta: e.rejectDelta ?? null,
  rejectReason: e.rejectReason ?? null,
  idealCycleTimeSec: e.idealCycleTimeSec ?? null,
  productId: e.productId ?? null,
  durationSec: e.durationSec ?? null,
  meta: e.meta ?? undefined,
});

describe('02-03 Task 2 — golden OEE scenario (Testcontainers postgres:18, real derivation + real SQL views)', () => {
  let pg: StartedPostgreSqlContainer;
  let db: Db;

  const DAY1_MS = Date.parse('2026-02-01T00:00:00.000Z'); // golden + edge (a)/(c)/(d)
  const DAY2_MS = Date.parse('2026-02-05T00:00:00.000Z'); // isolated PPT single-truth grid
  const FAR_FUTURE_MS = Date.parse('2026-02-10T00:00:00.000Z'); // sim_now() pause point: closes every shift used above

  const TEST_SHIFT: ShiftDef = { id: 'TEST-SHIFT', name: 'Test Shift', startMin: 0, endMin: 480, breaks: [{ startMin: 200, endMin: 230 }] };
  const PPT_SHIFT: ShiftDef = { id: 'PPT-SHIFT', name: 'PPT Grid Shift', startMin: 0, endMin: 480, breaks: [{ startMin: 200, endMin: 230 }] };

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:18').withDatabase('linelens_golden').withUsername('linelens').withPassword('linelens-test').start();
    runMigrateDeploy(pg.getConnectionUri());
    db = createDb(pg.getConnectionUri());

    // --- Master data ---
    await db.line.createMany({ data: [{ id: 'L-GOLD', name: 'Gold Line' }, { id: 'L-EDGE', name: 'Edge Line' }, { id: 'L-PPT', name: 'PPT Line' }] });
    await db.machine.createMany({
      data: [
        { id: 'M-GOLD', lineId: 'L-GOLD', name: 'M-GOLD', profile: 'typical', changeoverTargetMin: 15, startupWindowMin: 5 },
        { id: 'M-ALLDOWN', lineId: 'L-EDGE', name: 'M-ALLDOWN', profile: 'typical', changeoverTargetMin: 15, startupWindowMin: 5 },
        { id: 'M-ICTBAD', lineId: 'L-EDGE', name: 'M-ICTBAD', profile: 'typical', changeoverTargetMin: 15, startupWindowMin: 5 },
        { id: 'M-PPT', lineId: 'L-PPT', name: 'M-PPT', profile: 'typical', changeoverTargetMin: 15, startupWindowMin: 5 },
      ],
    });
    await db.shift.createMany({
      data: [
        { id: TEST_SHIFT.id, name: TEST_SHIFT.name, startMin: TEST_SHIFT.startMin, endMin: TEST_SHIFT.endMin, breaks: TEST_SHIFT.breaks },
        { id: PPT_SHIFT.id, name: PPT_SHIFT.name, startMin: PPT_SHIFT.startMin, endMin: PPT_SHIFT.endMin, breaks: PPT_SHIFT.breaks },
      ],
    });
    // Paused far past every shift used below -> every shift is "closed"
    // (effectiveEnd = shiftEnd, unclamped) for the golden/edge assertions.
    // The PPT single-truth grid test below temporarily repoints this and
    // restores it when done.
    await db.simClock.create({ data: { id: 1, epochSimMs: BigInt(FAR_FUTURE_MS), startedAtRealMs: BigInt(FAR_FUTURE_MS), speed: 1, pausedAtRealMs: BigInt(FAR_FUTURE_MS) } });

    // --- M-GOLD: the golden scenario ---
    resetIds();
    const gold: DerivedEvent[] = [
      stateChange('M-GOLD', 'L-GOLD', 0, DAY1_MS + 0 * MIN, 'EXECUTE'),
      stateChange('M-GOLD', 'L-GOLD', 1, DAY1_MS + 10 * MIN, 'DOWN', 'BRK-MECH'),
      stateChange('M-GOLD', 'L-GOLD', 2, DAY1_MS + 40 * MIN, 'EXECUTE'), // closes DOWN: 30 min -> UNPLANNED_STOPS
      stateChange('M-GOLD', 'L-GOLD', 3, DAY1_MS + 60 * MIN, 'CHANGEOVER', 'CO-PRODUCT'),
      stateChange('M-GOLD', 'L-GOLD', 4, DAY1_MS + 80 * MIN, 'EXECUTE'), // closes CHANGEOVER: 20 min, target 15 -> 15 PLANNED_STOPS + 5 CO-OVERAGE
      counts('M-GOLD', 'L-GOLD', 5, DAY1_MS + 100 * MIN, { goodDelta: 200, rejectDelta: 0, idealCycleTimeSec: 60 }),
      counts('M-GOLD', 'L-GOLD', 6, DAY1_MS + 150 * MIN, { goodDelta: 161, rejectDelta: 0, idealCycleTimeSec: 60 }),
      counts('M-GOLD', 'L-GOLD', 7, DAY1_MS + 160 * MIN, { goodDelta: 0, rejectDelta: 7, rejectReason: 'RJ-STARTUP', idealCycleTimeSec: 60 }),
      counts('M-GOLD', 'L-GOLD', 8, DAY1_MS + 170 * MIN, { goodDelta: 0, rejectDelta: 12, rejectReason: 'RJ-DIM', idealCycleTimeSec: 60 }),
      alarm('M-GOLD', 'L-GOLD', 9, DAY1_MS + 250 * MIN, 'SS-MISFEED', 180), // 3 min, well clear of the 200-230min break
      alarm('M-GOLD', 'L-GOLD', 10, DAY1_MS + 260 * MIN, 'SS-MISFEED', 180), // 3 min -> 6 min total SMALL_STOPS
      stateChange('M-GOLD', 'L-GOLD', 11, DAY1_MS + 490 * MIN, 'EXECUTE'), // heartbeat past shift end (480) — no-op state, ONLY to advance the shift-transition detector so rule 4 (SLOW_CYCLES) fires
    ];

    // --- M-ALLDOWN: edge (a) — all DOWN, never closed, zero run time ---
    const allDown: DerivedEvent[] = [stateChange('M-ALLDOWN', 'L-EDGE', 0, DAY1_MS + 0 * MIN, 'DOWN', 'BRK-MECH')];

    // --- M-ICTBAD: edge (c) — DOWN spans the break (proves defense-in-depth break exclusion too), leaving 1 min run time, then a doubled-ICT COUNTS ---
    const ictBad: DerivedEvent[] = [
      stateChange('M-ICTBAD', 'L-EDGE', 0, DAY1_MS + 0 * MIN, 'DOWN', 'BRK-MECH'),
      stateChange('M-ICTBAD', 'L-EDGE', 1, DAY1_MS + 479 * MIN, 'EXECUTE'), // closes DOWN: 479 min raw, spans the 200-230min break
      counts('M-ICTBAD', 'L-EDGE', 2, DAY1_MS + 479.5 * MIN, { goodDelta: 2, rejectDelta: 0, idealCycleTimeSec: 60 }),
    ];

    // --- M-PPT: registers day2 in v_shift_windows for the isolated PPT grid test (no derivation needed) ---
    const pptDay: DerivedEvent[] = [stateChange('M-PPT', 'L-PPT', 0, DAY2_MS + 0 * MIN, 'EXECUTE')];

    const allEvents = [...gold, ...allDown, ...ictBad, ...pptDay];
    await db.machineEvent.createMany({ data: allEvents.map(toMachineEventRow) });

    for (const [machineId, events] of [
      ['M-GOLD', gold],
      ['M-ALLDOWN', allDown],
      ['M-ICTBAD', ictBad],
    ] as const) {
      await db.$transaction(async (tx) => {
        const store = new PrismaStore(tx);
        await processMachineBatch(store, silentLogger, machineId, events);
      });
    }
  }, 120_000);

  afterAll(async () => {
    await db?.$disconnect();
    await pg?.stop();
  }, 30_000);

  it('M-GOLD: matches the hand-computed golden numbers to 4 decimal places', async () => {
    const rows = await db.$queryRaw<
      Array<{
        pptSec: number;
        downSec: number;
        changeoverSec: number;
        runSec: number;
        totalCnt: number;
        goodCnt: number;
        ictSec: number;
        availability: number;
        performance: number;
        quality: number;
        oee: number;
        ictMisconfigured: boolean;
        aLossSec: number;
        pLossSec: number;
        qLossSec: number;
      }>
    >`SELECT * FROM v_machine_shift_oee WHERE "machineId" = 'M-GOLD' AND "shiftDate" = '2026-02-01' AND "shiftId" = 'TEST-SHIFT'`;

    expect(rows).toHaveLength(1);
    const r = rows[0]!;

    expect(r.pptSec).toBeCloseTo(450 * 60, 4);
    expect(r.downSec).toBeCloseTo(30 * 60, 4);
    expect(r.changeoverSec).toBeCloseTo(20 * 60, 4);
    expect(r.runSec).toBeCloseTo(400 * 60, 4);
    expect(r.totalCnt).toBe(380);
    expect(r.goodCnt).toBe(361);
    expect(r.totalCnt - r.goodCnt).toBe(19); // edge (d): Total = Good + Reject invariant
    expect(r.ictSec).toBeCloseTo(380 * 60, 4);

    expect(r.availability).toBeCloseTo(400 / 450, 4);
    expect(r.performance).toBeCloseTo(380 / 400, 4);
    expect(r.quality).toBeCloseTo(361 / 380, 4);
    expect(r.oee).toBeCloseTo((400 / 450) * (380 / 400) * (361 / 380), 4);
    expect(r.oee).toBeCloseTo(0.802222, 4); // 80.22%
    expect(r.ictMisconfigured).toBe(false);

    expect(r.aLossSec).toBeCloseTo(50 * 60, 4);
    expect(r.pLossSec).toBeCloseTo(20 * 60, 4);
    expect(r.qLossSec).toBeCloseTo(19 * 60, 4);

    // Identity 1: a_loss + p_loss + q_loss = 89 min; PPT - 89 = 361 min
    expect(r.aLossSec + r.pLossSec + r.qLossSec).toBeCloseTo(89 * 60, 4);
    expect(r.pptSec - (r.aLossSec + r.pLossSec + r.qLossSec)).toBeCloseTo(361 * 60, 4);

    // Identity 2: fully productive time = PPT x OEE = good_count x ICT
    expect(r.pptSec * r.oee).toBeCloseTo(361 * 60, 3);
    expect(r.goodCnt * 60).toBeCloseTo(361 * 60, 4); // ICT = 60s/unit in this fixture
  }, 30_000);

  it('M-GOLD: the loss ledger reconciles to the waterfall (Identity 3)', async () => {
    const rows = await db.$queryRaw<Array<{ category: string; reasonCode: string; lostTimeSec: number; lostUnits: number }>>`
      SELECT category, "reasonCode", "lostTimeSec"::float AS "lostTimeSec", "lostUnits"::float AS "lostUnits"
      FROM loss_event WHERE "machineId" = 'M-GOLD' AND "shiftDate" = '2026-02-01' AND "shiftId" = 'TEST-SHIFT'
      ORDER BY category, "reasonCode"
    `;

    const sumByCategory = (category: string): number => rows.filter((r) => r.category === category).reduce((s, r) => s + r.lostTimeSec, 0);

    // a_loss = UNPLANNED_STOPS(30 DOWN + 5 CO-OVERAGE) + PLANNED_STOPS(15) = 50 min
    expect(sumByCategory('UNPLANNED_STOPS')).toBeCloseTo(35 * 60, 4);
    expect(sumByCategory('PLANNED_STOPS')).toBeCloseTo(15 * 60, 4);
    // p_loss = SMALL_STOPS(6) + SLOW_CYCLES(14) = 20 min — proves rule 4 fired via the DAY1 490min heartbeat
    expect(sumByCategory('SMALL_STOPS')).toBeCloseTo(6 * 60, 4);
    expect(sumByCategory('SLOW_CYCLES')).toBeCloseTo(14 * 60, 4);
    // q_loss = STARTUP_REJECTS(7) + PRODUCTION_REJECTS(12) = 19 min
    expect(sumByCategory('STARTUP_REJECTS')).toBeCloseTo(7 * 60, 4);
    expect(sumByCategory('PRODUCTION_REJECTS')).toBeCloseTo(12 * 60, 4);

    const startupRow = rows.find((r) => r.category === 'STARTUP_REJECTS')!;
    expect(startupRow.lostUnits).toBe(7);
    const prodRejectRow = rows.find((r) => r.category === 'PRODUCTION_REJECTS')!;
    expect(prodRejectRow.lostUnits).toBe(12);

    const total = rows.reduce((s, r) => s + r.lostTimeSec, 0);
    expect(total).toBeCloseTo(89 * 60, 4); // ties out to Identity 1's a_loss+p_loss+q_loss
  }, 30_000);

  it('v_line_shift_oee: single-machine line rollup matches the machine row exactly (aggregate-of-sums sanity)', async () => {
    const [machineRow] = await db.$queryRaw<Array<{ oee: number; runSec: number }>>`
      SELECT oee, "runSec" FROM v_machine_shift_oee WHERE "machineId" = 'M-GOLD' AND "shiftDate" = '2026-02-01' AND "shiftId" = 'TEST-SHIFT'
    `;
    const [lineRow] = await db.$queryRaw<Array<{ oee: number; runSec: number }>>`
      SELECT oee, "runSec" FROM v_line_shift_oee WHERE "lineId" = 'L-GOLD' AND "shiftDate" = '2026-02-01' AND "shiftId" = 'TEST-SHIFT'
    `;
    expect(lineRow!.oee).toBeCloseTo(machineRow!.oee, 6);
    expect(lineRow!.runSec).toBeCloseTo(machineRow!.runSec, 6);
  }, 30_000);

  it('v_loss_pareto: UNPLANNED_STOPS sums both reason codes (BRK-MECH + CO-OVERAGE) to 35 min', async () => {
    const rows = await db.$queryRaw<Array<{ reasonCode: string; lostTimeSec: number }>>`
      SELECT "reasonCode", "lostTimeSec"::float AS "lostTimeSec" FROM v_loss_pareto
      WHERE "lineId" = 'L-GOLD' AND "shiftDate" = '2026-02-01' AND "shiftId" = 'TEST-SHIFT' AND category = 'UNPLANNED_STOPS'
    `;
    const total = rows.reduce((s, r) => s + r.lostTimeSec, 0);
    expect(total).toBeCloseTo(35 * 60, 4);
    expect(rows.map((r) => r.reasonCode).sort()).toEqual(['BRK-MECH', 'CO-OVERAGE']);
  }, 30_000);

  it('edge (a): all-DOWN shift -> availability = 0 exactly, performance NULL, oee NULL (never NaN, never a false 0%)', async () => {
    const [row] = await db.$queryRaw<Array<{ availability: number; performance: number | null; oee: number | null }>>`
      SELECT availability, performance, oee FROM v_machine_shift_oee WHERE "machineId" = 'M-ALLDOWN' AND "shiftDate" = '2026-02-01' AND "shiftId" = 'TEST-SHIFT'
    `;
    expect(row).toBeDefined();
    expect(row!.availability).toBe(0);
    expect(row!.performance).toBeNull();
    expect(row!.oee).toBeNull();
  }, 30_000);

  it('edge (b): empty shift (no events at all) -> row-absence = N/A (no row emitted, never a zero-filled row)', async () => {
    const rows = await db.$queryRaw<Array<unknown>>`SELECT * FROM v_machine_shift_oee WHERE "machineId" = 'M-DOES-NOT-EXIST'`;
    expect(rows).toHaveLength(0);
  }, 30_000);

  it('edge (c) + bonus (e): DOWN interval spanning a break -> break excluded from downSec exactly once (never double-subtracted from PPT), leaving 1 min run time; doubled-ICT COUNTS flips performance > 1.0 WITHOUT clamping', async () => {
    const [row] = await db.$queryRaw<
      Array<{ downSec: number; runSec: number; performance: number; ictMisconfigured: boolean; oee: number }>
    >`SELECT "downSec", "runSec", performance, "ictMisconfigured", oee FROM v_machine_shift_oee WHERE "machineId" = 'M-ICTBAD' AND "shiftDate" = '2026-02-01' AND "shiftId" = 'TEST-SHIFT'`;

    expect(row).toBeDefined();
    // DOWN interval raw duration = 479 min, minus the 30-min break it spans = 449 min counted.
    // If break-exclusion were missing (double-subtracted), downSec would be 479min
    // (or clamped run_sec would go to 0 via GREATEST(0,...), NOT reproduce this).
    expect(row!.downSec).toBeCloseTo(449 * 60, 4);
    expect(row!.runSec).toBeCloseTo(1 * 60, 4); // 450 PPT - 449 down = 1 min
    expect(row!.performance).toBeCloseTo(2, 4); // ict_sec(120) / run_sec(60) = 2.0 exactly
    expect(row!.ictMisconfigured).toBe(true);
    expect(row!.oee).not.toBeNull(); // NOT clamped away — a real (small) number, not hidden
  }, 30_000);

  it('PPT single-truth cross-check (MANDATORY, Task 1 <verify>): SQL v_shift_windows.pptSec and TS contracts.plannedProductionTimeMs agree to the second across a clamp-instant grid', async () => {
    const shifts: ShiftDef[] = [PPT_SHIFT];
    const inst: ShiftInstance = shiftInstanceAt(DAY2_MS + 10 * MIN, shifts)!;
    expect(inst).not.toBeNull();
    expect(inst.shiftId).toBe('PPT-SHIFT');
    expect(inst.date).toBe('2026-02-05');

    // Grid: shift start, mid-shift (before break), break start edge, mid-break, break end edge, shift end.
    const gridMinutes = [0, 100, 200, 215, 230, 480];

    try {
      for (const min of gridMinutes) {
        const clampMs = DAY2_MS + min * MIN;
        await db.simClock.update({ where: { id: 1 }, data: { epochSimMs: BigInt(clampMs), startedAtRealMs: BigInt(clampMs), pausedAtRealMs: BigInt(clampMs) } });

        const [sqlRow] = await db.$queryRaw<Array<{ pptSec: number }>>`
          SELECT "pptSec" FROM v_shift_windows WHERE "shiftDate" = '2026-02-05' AND "shiftId" = 'PPT-SHIFT'
        `;
        expect(sqlRow).toBeDefined();

        const expectedMs = plannedProductionTimeMs(inst, shifts, clampMs);
        const expectedSec = expectedMs / 1000;

        expect(Math.round(sqlRow!.pptSec)).toBe(Math.round(expectedSec));
      }
    } finally {
      // Restore the "far future" pause so no later test (if any were added) sees a mid-grid clock.
      await db.simClock.update({ where: { id: 1 }, data: { epochSimMs: BigInt(FAR_FUTURE_MS), startedAtRealMs: BigInt(FAR_FUTURE_MS), pausedAtRealMs: BigInt(FAR_FUTURE_MS) } });
    }
  }, 30_000);
});
