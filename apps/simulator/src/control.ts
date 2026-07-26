import http from 'node:http';
import type { Logger } from 'pino';
import { rebase, type ClockState } from '@linelens/contracts';
import type { Plant } from './plant.js';

/**
 * Tiny HTTP control server (node:http, port 4000): inject-breakdown, speed
 * change, clock introspection, health check. Not published on the host by
 * compose — reachable only from inside the compose network (web will proxy
 * in Phase 3).
 */
export interface ControlDeps {
  plant: Plant;
  getClock: () => ClockState;
  setClock: (c: ClockState) => void;
  simNow: () => number;
  /** Wall-clock "now" provider — kept as an injected dependency so this file never calls Date.now() itself (main.ts owns the clock edge). */
  nowRealMs: () => number;
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
  const { plant, getClock, setClock, simNow, nowRealMs, logger } = deps;

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';

    if (req.method === 'GET' && url === '/healthz') {
      sendJson(res, 200, { simNow: new Date(simNow()).toISOString(), speed: getClock().speed, machines: plant.machineCount() });
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

    sendJson(res, 404, { error: 'not found' });
  });

  server.listen(port, () => logger.info({ port }, 'control server listening'));
  return server;
};
