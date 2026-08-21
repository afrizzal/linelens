import mqtt, { type MqttClient } from 'mqtt';
import type { Logger } from 'pino';
import { TELEMETRY_SUBSCRIPTION, TelemetryEvent, parseTopic, type TelemetryEvent as TelemetryEventT } from '@linelens/contracts';
import type { Db } from '@linelens/db';

/**
 * Worker MQTT ingestion — the sole MQTT consumer and sole Postgres writer
 * (ARCHITECTURE.md "single consumer, single writer"). Persists raw
 * `machine_event` rows losslessly and idempotently; no derivation here.
 */
export interface IngestDeps {
  db: Db;
  logger: Logger;
  mqttUrl: string;
  /** Flush the pending batch after this many ms of inactivity. Default 100ms. */
  flushIntervalMs?: number;
  /** Flush immediately once the pending batch reaches this size. Default 500. */
  batchSize?: number;
  /**
   * MQTT client ID — session identity for clean:false persistence. FIXED at
   * 'linelens-worker' in production (single stable session). Overridable
   * only so integration tests can run an isolated session against the same
   * broker without evicting the real worker's persistent session (MQTT
   * spec: a second connect with the same clientId kicks the first).
   */
  clientId?: string;
}

export interface IngestHandle {
  client: MqttClient;
  /** Flush any buffered rows immediately. */
  flush: () => Promise<void>;
  /** Flush, then gracefully end the MQTT session (keeps the QoS1 persistent session on the broker). */
  close: () => Promise<void>;
}

interface MachineEventRow {
  machineId: string;
  lineId: string;
  kind: string;
  simTime: Date;
  seq: number;
  state?: string | null;
  reasonCode?: string | null;
  goodDelta?: number | null;
  rejectDelta?: number | null;
  rejectReason?: string | null;
  idealCycleTimeSec?: number | null;
  productId?: string | null;
  durationSec?: number | null;
  meta?: { injected?: boolean };
}

/**
 * Map a validated TelemetryEvent to a machine_event row. Deltas, not
 * cumulative counters — replay-safe via the (machineId, seq) unique key
 * upstream (createMany skipDuplicates). ALARM's `alarmType` is
 * intentionally NOT persisted: it is the constant 'MICROSTOP' — `kind`
 * ('ALARM') + `durationSec` already carry the information, so the field is
 * dropped silently here (per plan; not a validation failure).
 */
const toRow = (event: TelemetryEventT): MachineEventRow => {
  const base = {
    machineId: event.machineId,
    lineId: event.lineId,
    kind: event.kind,
    simTime: new Date(event.simTime),
    seq: event.seq,
  };
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

export const createIngestion = (deps: IngestDeps): IngestHandle => {
  const { db, logger, mqttUrl, flushIntervalMs = 100, batchSize = 500, clientId = 'linelens-worker' } = deps;

  let buffer: MachineEventRow[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (buffer.length === 0) return;
    const rows = buffer;
    buffer = [];
    try {
      const result = await db.machineEvent.createMany({ data: rows, skipDuplicates: true });
      logger.debug({ attempted: rows.length, inserted: result.count }, 'ingest batch flushed');
    } catch (err) {
      // A flush failure here is a DB/connectivity problem, not a
      // duplicate/validation issue — rows are NOT re-queued in memory. The
      // broker's persistent QoS1 session (clean:false) is what makes
      // replay-on-worker-restart safe, not an in-process retry buffer.
      logger.error({ err, attempted: rows.length }, 'ingest batch flush failed');
    }
  };

  const scheduleFlush = (): void => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      void flush();
    }, flushIntervalMs);
  };

  const enqueue = (row: MachineEventRow): void => {
    buffer.push(row);
    if (buffer.length >= batchSize) {
      void flush();
    } else {
      scheduleFlush();
    }
  };

  const client = mqtt.connect(mqttUrl, {
    clientId,
    clean: false,
    manualConnect: true,
  });

  // Register handlers BEFORE connecting (PITFALLS.md MQTT.js gotcha:
  // late-registered handlers silently drop messages replayed on a
  // persistent-session reconnect).
  client.on('connect', (packet) => {
    logger.info({ sessionPresent: packet.sessionPresent }, 'mqtt connected');
    client.subscribe(TELEMETRY_SUBSCRIPTION, { qos: 1 }, (err) => {
      if (err) logger.error({ err }, 'mqtt subscribe failed');
      else logger.info({ topic: TELEMETRY_SUBSCRIPTION }, 'mqtt subscribed');
    });
  });
  client.on('reconnect', () => logger.warn('mqtt reconnecting'));
  client.on('close', () => logger.warn('mqtt connection closed'));
  client.on('offline', () => logger.warn('mqtt offline'));
  client.on('error', (err) => logger.error({ err }, 'mqtt client error'));

  client.on('message', (topic, payload) => {
    const parts = parseTopic(topic);
    if (!parts) {
      logger.warn({ topic }, 'ingest: unrecognized topic, dropping');
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(payload.toString('utf-8'));
    } catch (err) {
      logger.warn({ topic, err }, 'ingest: invalid JSON payload, dropping');
      return;
    }
    const parsed = TelemetryEvent.safeParse(json);
    if (!parsed.success) {
      logger.warn({ topic, error: parsed.error.message }, 'ingest: contract validation failed, dropping');
      return;
    }
    enqueue(toRow(parsed.data));
  });

  client.connect();

  return {
    client,
    flush,
    close: async () => {
      await flush();
      await new Promise<void>((resolve) => {
        // end(false, ...) — graceful: sends DISCONNECT, keeps the QoS1
        // persistent session on the broker (see STACK.md/PITFALLS.md).
        client.end(false, () => resolve());
      });
    },
  };
};
