import { db } from "@/lib/db";

/**
 * GET /api/sim-clock — {simNow, speed}. Built here in wave 1 because both
 * wave-2 UI plans (03-02 top bar, 03-03 live timeline edge) consume it.
 */
export const dynamic = "force-dynamic";

interface SimNowRow {
  simNow: Date;
}

export async function GET(): Promise<Response> {
  const [clock, rows] = await Promise.all([
    db.simClock.findUnique({ where: { id: 1 } }),
    // The sim clock function returns timestamptz on purpose here (scalar
    // clock read, no comparison) — casting via `AT TIME ZONE 'UTC'` would
    // re-serialize it as a naive value and reintroduce the Phase-02 bug for
    // every OTHER route that clamps against this value's callers. Trailing
    // marker on the query line below keeps the repo-wide sim-time gate grep
    // (`grep -v "AT TIME ZONE 'UTC'" | grep -v "sim-tz-ok:"`) clean.
    db.$queryRaw<SimNowRow[]>`SELECT sim_now() AS "simNow"`, // sim-tz-ok: scalar clock read, no comparison
  ]);

  const simNow = rows[0]?.simNow ?? null;

  return Response.json({
    simNow: simNow ? simNow.toISOString() : null,
    speed: clock?.speed ?? null,
  });
}
