import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client as PgClient } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * FINDING 3 regression test (02-02 mandatory finding — the "silent
 * number-corruption trap"): `machine_event.simTime` (and every sim-time
 * column added in this plan — state_interval.startTime/endTime,
 * loss_event.windowStart/windowEnd) is `timestamp(3)` WITHOUT time zone
 * (Prisma's default `DateTime` mapping), but `sim_now()` returns
 * `timestamptz`. Comparing a naive `timestamp` to a `timestamptz` makes
 * Postgres implicitly reinterpret the naive value in the SESSION TimeZone
 * before comparing — so the SAME query against the SAME data returns a
 * DIFFERENT answer depending on the session's TimeZone setting, unless the
 * comparison goes through `sim_now() AT TIME ZONE 'UTC'` first (which
 * converts to a session-TimeZone-INDEPENDENT naive UTC value).
 *
 * CONVENTION FOR 02-03 (see 02-02-SUMMARY.md "Convention for 02-03"): every
 * SQL view/query that clamps an interval to `sim_now()` MUST compare
 * against `sim_now() AT TIME ZONE 'UTC'`, never bare `sim_now()`. This test
 * proves why: it is benign today only because the compose Postgres session
 * is `Etc/UTC` (verified by the orchestrator) — this test fails a
 * non-UTC-safe convention immediately, rather than 5 sprints from now on a
 * host/session with a different default TimeZone.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const runMigrateDeploy = (databaseUrl: string): void => {
  execFileSync('pnpm', ['--filter', '@linelens/db', 'exec', 'prisma', 'migrate', 'deploy'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
};

describe('sim_now() vs naive timestamp(3) columns — session-TimeZone safety (integration: testcontainers postgres, disposable)', () => {
  let pg: StartedPostgreSqlContainer;
  let client: PgClient;
  // A fixed sim instant, PAUSED (startedAtRealMs === pausedAtRealMs), so
  // sim_now() equals exactly this value regardless of how long the test
  // takes to run or the machine's wall clock — deterministic by construction.
  const FIXED_MS = Date.parse('2026-01-06T07:00:00.000Z');

  beforeAll(async () => {
    pg = await new PostgreSqlContainer('postgres:18')
      .withDatabase('linelens_test')
      .withUsername('linelens')
      .withPassword('linelens-test')
      .start();
    runMigrateDeploy(pg.getConnectionUri());

    client = new PgClient({ connectionString: pg.getConnectionUri() });
    await client.connect();

    await client.query(
      `INSERT INTO sim_clock (id, "epochSimMs", "startedAtRealMs", speed, "pausedAtRealMs")
       VALUES (1, $1, $1, 1, $1)`,
      [FIXED_MS],
    );
    // Bind an ISO 'Z'-suffixed STRING, never a raw JS `Date` object, for a
    // naive `timestamp` column through a raw `pg.Client`. This is itself a
    // footgun this test discovered: `pg`'s default Date->SQL serializer
    // formats a bound `Date` parameter using the CALLING PROCESS's LOCAL OS
    // timezone (not UTC) for a timezone-less column — e.g. on a UTC+7 dev
    // machine, `new Date('...07:00:00Z')` would be written as "14:00:00",
    // silently 7 hours wrong. Prisma's own client does NOT have this bug
    // (it serializes Date -> UTC-suffixed ISO text consistently, verified
    // separately) — this raw-pg-specific gotcha only matters for
    // notify.ts-style code and hand-written test SQL, never for this plan's
    // actual derivation writes (all go through PrismaStore). A 'Z'-suffixed
    // string, by contrast, is parsed by Postgres itself for a naive column
    // by taking the literal's digits directly — verified session-TimeZone-independent.
    await client.query(
      `INSERT INTO machine_event ("machineId", "lineId", kind, "simTime", seq, state)
         VALUES ($1, $2, 'STATE_CHANGE', $3, 0, 'EXECUTE')`,
      ['M-TZ', 'L-TZ', new Date(FIXED_MS).toISOString()],
    );
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await pg?.stop();
  }, 30_000);

  const countDirectMatch = async (tz: string): Promise<number> => {
    await client.query("SELECT set_config('TimeZone', $1, false)", [tz]);
    const res = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM machine_event WHERE "simTime" = sim_now()`,
    );
    return res.rows[0]?.c ?? 0;
  };

  const countAtTimeZoneUtcMatch = async (tz: string): Promise<number> => {
    await client.query("SELECT set_config('TimeZone', $1, false)", [tz]);
    const res = await client.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM machine_event WHERE "simTime" = (sim_now() AT TIME ZONE 'UTC')`,
    );
    return res.rows[0]?.c ?? 0;
  };

  it('DEMONSTRATES THE TRAP: bare `simTime = sim_now()` shifts result under a non-UTC session (same data, different answer)', async () => {
    const utcCount = await countDirectMatch('Etc/UTC');
    const jakartaCount = await countDirectMatch('Asia/Jakarta');

    expect(utcCount).toBe(1); // matches under UTC (the session this appliance currently runs under)
    expect(jakartaCount).toBe(0); // the SAME row, SAME data — silently stops matching under a +7h session
    expect(jakartaCount).not.toBe(utcCount); // the corruption, made explicit
  });

  it('THE SAFE CONVENTION: `simTime = (sim_now() AT TIME ZONE \'UTC\')` is session-TimeZone-independent', async () => {
    const utcCount = await countAtTimeZoneUtcMatch('Etc/UTC');
    const jakartaCount = await countAtTimeZoneUtcMatch('Asia/Jakarta');

    expect(utcCount).toBe(1);
    expect(jakartaCount).toBe(1);
    expect(jakartaCount).toBe(utcCount); // identical regardless of session TimeZone — this is the 02-03 convention
  });
});
