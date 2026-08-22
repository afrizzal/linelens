/**
 * POST /api/control/inject {lineId} — thin proxy to the simulator's
 * control server (03-03-PLAN.md Task 2, SIM-05). The web container never
 * talks MQTT/DB-write directly for this action — this route proxies to
 * `POST http://simulator:4000/control/inject-breakdown` over the compose
 * network.
 *
 * SECURITY NOTE (Phase 3 audit T-04): this route is the only bridge the
 * BROWSER uses, but it is not the only path to the control server — compose
 * publishes simulator port 4000 to the host for the smoke test, so
 * `/control/*` is also reachable directly via localhost, bypassing this
 * proxy and its client-side cooldown entirely. Accepted for a localhost
 * demo appliance; revisit before any non-local deployment.
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
