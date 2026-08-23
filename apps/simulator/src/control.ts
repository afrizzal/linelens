import http from 'node:http';
import type { Logger } from 'pino';
import { rebase, type ClockState } from '@linelens/contracts';
import type { Plant } from './plant.js';

/**
 * Tiny HTTP control server (node:http, port 4000): inject-breakdown, speed
 * change, clock introspection, health check.
 *
 * SECURITY BOUNDARY (Phase 3 audit T-04): this port IS published to the host
 * by docker-compose.yml (`4000:4000`) — the compose smoke test and manual
 * `curl` demos need it. It is therefore unauthenticated and unthrottled on
 * localhost, and `/control/*` must be treated as a trusted-network-only
 * surface. Do not claim it is network-segmented. If this appliance is ever
 * deployed beyond localhost, change the mapping to `expose:` or put auth in
 * front of `/control/*` first.
 */
export interface ControlDeps {
  plant: Plant;
  getClock: () => ClockState;
  setClock: (c: ClockState) => void;
  simNow: () => number;
  /** Wall-clock "now" provider — kept as an injected dependency so this file never calls Date.now() itself (main.ts owns the clock edge). */
  nowRealMs: () => number;
  /**
   * Called when the ingestion worker reports that it has subscribed to the
   * telemetry topic. main.ts uses this to release the warm-start gate — see
   * the WINDOWS-15 note on `/control/ingestor-ready` below. Idempotent: the
   * worker re-signals on every MQTT reconnect.
   *
   * `maxSimTimeMs` is the newest `machine_event.simTime` already in the
   * database (null on an empty one) — WINDOWS 14, used to resume the clock
   * from stored history instead of blindly warm-starting over it.
   */
  onIngestorReady?: (maxSimTimeMs: number | null) => void;
  /** Warm-start progress, surfaced on /healthz so a cold start is debuggable. */
  getReadiness?: () => { ingestorReady: boolean; warmStartComplete: boolean };
  logger: Logger;
}

const readJsonBody = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });

const sendJson = (res: http.ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
};

export const createControlServer = (deps: ControlDeps, port: number): http.Server => {
  const { plant, getClock, setClock, simNow, nowRealMs, onIngestorReady, getReadiness, logger } = deps;

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';

    if (req.method === 'GET' && url === '/healthz') {
      sendJson(res, 200, {
        simNow: new Date(simNow()).toISOString(),
        speed: getClock().speed,
        machines: plant.machineCount(),
        // Warm-start state is part of health because the control server now
        // listens BEFORE the warm-start burst (WINDOWS 15) — "healthy" no
        // longer implies "backlog published".
        ...(getReadiness ? getReadiness() : {}),
      });
      return;
    }

    if (req.method === 'GET' && url === '/clock') {
      sendJson(res, 200, getClock());
      return;
    }

    if (req.method === 'POST' && url === '/control/inject-breakdown') {
      readJsonBody(req)
        .then((body) => {
          const lineId = typeof body.lineId === 'string' ? body.lineId : undefined;
          if (!lineId) {
            sendJson(res, 400, { error: 'lineId is required' });
            return;
          }
          const machineId = typeof body.machineId === 'string' ? body.machineId : undefined;
          const durationSec = typeof body.durationSec === 'number' ? body.durationSec : undefined;
          const result = plant.injectBreakdown(lineId, simNow(), { machineId, durationSec });
          if (!result) {
            sendJson(res, 404, { error: `no injectable machine found for line ${lineId}` });
            return;
          }
          logger.info({ lineId, ...result }, 'inject-breakdown applied');
          sendJson(res, 200, result);
        })
        .catch((err) => {
          logger.error({ err }, 'inject-breakdown request failed');
          sendJson(res, 400, { error: 'invalid JSON body' });
        });
      return;
    }

    if (req.method === 'POST' && url === '/control/speed') {
      readJsonBody(req)
        .then((body) => {
          const speed = typeof body.speed === 'number' ? body.speed : undefined;
          if (!speed || speed <= 0) {
            sendJson(res, 400, { error: 'speed must be a positive number' });
            return;
          }
          const next = rebase(getClock(), nowRealMs(), speed);
          setClock(next);
          logger.info({ speed }, 'clock rebased');
          sendJson(res, 200, next);
        })
        .catch((err) => {
          logger.error({ err }, 'speed request failed');
          sendJson(res, 400, { error: 'invalid JSON body' });
        });
      return;
    }

    /**
     * WINDOWS 15 — warm-start readiness handshake.
     *
     * The simulator publishes a full sim-day of backlog in ~1.5s at boot. On a
     * clean `docker compose up` the ingestion worker has not subscribed yet
     * (and `clean:false` + QoS1 only replays into a session that ALREADY
     * exists), so that entire day used to be dropped on the floor. The worker
     * now POSTs here once it is subscribed, and main.ts holds the burst until
     * it does.
     *
     * Idempotent by design: the worker re-signals on every MQTT reconnect, and
     * a worker restart long after go-live must be a no-op, not a second
     * warm-start.
     */
    if (req.method === 'POST' && url === '/control/ingestor-ready') {
      readJsonBody(req)
        .then((body) => {
          const raw = body.maxSimTimeMs;
          const maxSimTimeMs = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
          const readiness = getReadiness?.();
          onIngestorReady?.(maxSimTimeMs);
          logger.info(
            { warmStartComplete: readiness?.warmStartComplete ?? false, maxSimTimeMs },
            'ingestor-ready received',
          );
          sendJson(res, 200, { ok: true, warmStartComplete: readiness?.warmStartComplete ?? false });
        })
        .catch((err) => {
          // A malformed body must not strand the warm-start gate — release it
          // with no history hint and let the normal warm-start path run.
          logger.warn({ err }, 'ingestor-ready body unparseable; releasing gate without a history hint');
          onIngestorReady?.(null);
          sendJson(res, 200, { ok: true, warmStartComplete: getReadiness?.().warmStartComplete ?? false });
        });
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });

  server.listen(port, () => logger.info({ port }, 'control server listening'));
  return server;
};
