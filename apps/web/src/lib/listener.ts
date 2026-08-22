import { EventEmitter } from "node:events";
import { Client } from "pg";

/**
 * The web-side half of ARCHITECTURE.md Pattern 3 (LISTEN/NOTIFY -> in-process
 * fan-out -> SSE). apps/worker/src/notify.ts is the NOTIFY side (dedicated
 * raw pg Client, coalesced per-line payload, channel 'linelens'). This file
 * is the LISTEN side: ONE dedicated, unpooled `pg.Client` per process,
 * cached on `globalThis` so Next.js dev-mode module reloads never spin up a
 * second LISTEN connection (Anti-Pattern 5: a pooled/duplicated listener
 * either silently drops the LISTEN registration or double-delivers).
 *
 * Payload shape mirrors notify.ts's `{ kinds: string[], lineIds: string[] }`
 * — IDs only, never full snapshots (8000-byte NOTIFY cap); every SSE route
 * consumer is expected to re-query its own compact read model on 'change'.
 */

const CHANNEL = "linelens";
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export interface ChangePayload {
  kinds: string[];
  lineIds: string[];
}

interface ListenerState {
  emitter: EventEmitter;
  client: Client | null;
  backoffMs: number;
  stopped: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var __linelensListenerState: ListenerState | undefined;
}

const scheduleReconnect = (state: ListenerState): void => {
  if (state.stopped) return;
  state.client = null;
  const delay = state.backoffMs;
  state.backoffMs = Math.min(state.backoffMs * 2, MAX_BACKOFF_MS);
  setTimeout(() => void connect(state), delay);
};

const connect = async (state: ListenerState): Promise<void> => {
  if (state.stopped) return;
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[listener] DATABASE_URL is required to LISTEN for live changes");
    return;
  }

  const client = new Client({ connectionString: url });

  client.on("notification", (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {
      const payload = JSON.parse(msg.payload) as ChangePayload;
      state.emitter.emit("change", payload);
    } catch (err) {
      console.error("[listener] failed to parse NOTIFY payload", err);
    }
  });

  // Network partition / backend crash while idle — reconnect, don't crash
  // the process (mirrors the documented pg.Client 'error' event contract).
  client.on("error", (err) => {
    console.error("[listener] connection error, reconnecting", err);
    scheduleReconnect(state);
  });

  client.on("end", () => {
    if (state.client === client) {
      scheduleReconnect(state);
    }
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    state.client = client;
    state.backoffMs = INITIAL_BACKOFF_MS;
    console.info(`[listener] connected and LISTENing on '${CHANNEL}'`);
  } catch (err) {
    console.error("[listener] failed to connect", err);
    scheduleReconnect(state);
  }
};

const getState = (): ListenerState => {
  if (!globalThis.__linelensListenerState) {
    const emitter = new EventEmitter();
    // Many concurrent browser SSE connections subscribe to the same
    // in-process emitter — the default max-listeners warning (10) is not a
    // leak signal here, it is expected fan-out.
    emitter.setMaxListeners(0);
    const state: ListenerState = { emitter, client: null, backoffMs: INITIAL_BACKOFF_MS, stopped: false };
    globalThis.__linelensListenerState = state;
    void connect(state);
  }
  return globalThis.__linelensListenerState;
};

/** The shared in-process change emitter. Subscribe to the `'change'` event. */
export const getEmitter = (): EventEmitter => getState().emitter;
