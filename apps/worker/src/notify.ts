import { Client } from 'pg';
import type { Logger } from 'pino';

/**
 * Coalesced NOTIFY (02-02-PLAN.md Task 4). After each derivation batch that
 * changed anything, the affected lineIds are coalesced over a short real-ms
 * window and sent as ONE `pg_notify('linelens', ...)` call — IDs only, well
 * under the 8000-byte NOTIFY payload cap (ARCHITECTURE.md Pattern 3 /
 * Anti-Pattern 5/7). Phase 3's SSE route LISTENs on this same channel and
 * re-queries a compact live snapshot; this file only signals "something on
 * these lines changed," it never carries the data itself.
 *
 * Uses a DEDICATED raw `pg` Client — never Prisma, never a pool — per the
 * plan (and PITFALLS.md: pgBouncer/transaction-pooled connections silently
 * drop LISTEN registrations; the same discipline applies symmetrically to
 * the NOTIFY side so this file's connection lifecycle mirrors what Phase
 * 3's LISTEN side will need).
 */

export interface NotifierDeps {
  connectionString: string;
  logger: Logger;
  /** Real-ms coalescing window. Default 250ms per plan. */
  coalesceMs?: number;
  /** NOTIFY channel name. Default 'linelens' per plan. */
  channel?: string;
}

export interface Notifier {
  /** Queue lineIds to be coalesced into the next NOTIFY flush. */
  notifyLineIds: (lineIds: string[]) => void;
  /** Flush any pending lineIds immediately (bypasses the coalescing timer). */
  flush: () => Promise<void>;
  close: () => Promise<void>;
}

export const createNotifier = async (deps: NotifierDeps): Promise<Notifier> => {
  const { connectionString, logger, coalesceMs = 250, channel = 'linelens' } = deps;

  const client = new Client({ connectionString });
  await client.connect();

  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.size === 0) return;
    const lineIds = [...pending];
    pending = new Set();
    const payload = JSON.stringify({ kinds: ['telemetry'], lineIds });
    if (Buffer.byteLength(payload, 'utf-8') > 7900) {
      // Defensive — should never happen at demo scale (a handful of lines),
      // but a truncated NOTIFY silently corrupts the JSON on the LISTEN
      // side, so fail loudly instead of sending a bad payload.
      logger.error({ byteLength: Buffer.byteLength(payload, 'utf-8'), lineIdCount: lineIds.length }, 'notify: payload too large, dropping');
      return;
    }
    try {
      await client.query('SELECT pg_notify($1, $2)', [channel, payload]);
      logger.debug({ channel, lineIds }, 'notify: flushed');
    } catch (err) {
      logger.error({ err, channel, lineIds }, 'notify: pg_notify failed');
    }
  };

  const scheduleFlush = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      void flush();
    }, coalesceMs);
  };

  return {
    notifyLineIds: (lineIds: string[]): void => {
      if (lineIds.length === 0) return;
      for (const id of lineIds) pending.add(id);
      scheduleFlush();
    },
    flush,
    close: async (): Promise<void> => {
      await flush();
      await client.end();
    },
  };
};
