/**
 * POST /api/control/inject {lineId} — thin proxy to the simulator's
 * control server (03-03-PLAN.md Task 2, SIM-05). The web container never
 * talks MQTT/DB-write directly for this action (ARCHITECTURE boundary: the
 * simulator's control server is only reachable inside the compose network,
 * not published to the host) — this route is the ONLY bridge from the
 * browser to `POST http://simulator:4000/control/inject-breakdown`.
 */
export const dynamic = "force-dynamic";

const SIMULATOR_URL = process.env.SIMULATOR_URL ?? "http://simulator:4000";

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const lineId = typeof body.lineId === "string" ? body.lineId : undefined;
  if (!lineId) {
    return Response.json({ error: "lineId is required" }, { status: 400 });
  }

  try {
    const res = await fetch(`${SIMULATOR_URL}/control/inject-breakdown`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineId }),
    });
    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "simulator control server unreachable" }, { status: 502 });
  }
}
