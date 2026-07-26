import { z } from 'zod';
import { MACHINE_STATES } from './states.js';

/**
 * Telemetry event schema — PackTags-lite (Status + Admin subset), per
 * docs/00-domain-research.md §7. This is NOT a claim of PackML compliance
 * or full Sparkplug B compliance (JSON payloads, no birth/death lifecycle).
 */
const base = z.object({
  v: z.literal(1),
  machineId: z.string(),
  lineId: z.string(),
  /** Sim-time ISO timestamp — STAMPED AT SOURCE by the simulator (SIM-03). */
  simTime: z.string().datetime(),
  /** Per-machine monotonic sequence number; idempotency key for replay-safe upsert. */
  seq: z.number().int().nonnegative(),
});

export const StateChangeEvent = base.extend({
  kind: z.literal('STATE_CHANGE'),
  state: z.enum(MACHINE_STATES),
  /** Set for DOWN/CHANGEOVER; null for EXECUTE/BREAK. */
  reasonCode: z.string().nullable(),
  /** Inject-breakdown demo flag; optional and partial so absence is valid. */
  meta: z.object({ injected: z.boolean() }).partial().optional(),
});

export const CountsEvent = base.extend({
  kind: z.literal('COUNTS'),
  goodDelta: z.number().int().nonnegative(),
  rejectDelta: z.number().int().nonnegative(),
  /** Reason code when rejectDelta > 0; null otherwise. */
  rejectReason: z.string().nullable(),
  /** Ideal Cycle Time of the current product in seconds — drives the Performance calc. */
  idealCycleTimeSec: z.number().positive(),
  productId: z.string(),
});

export const AlarmEvent = base.extend({
  kind: z.literal('ALARM'),
  alarmType: z.literal('MICROSTOP'),
  /** SS-* reason code. */
  reasonCode: z.string(),
  /** Sim-seconds the micro-stop lasted. */
  durationSec: z.number().positive(),
});

export const TelemetryEvent = z.discriminatedUnion('kind', [
  StateChangeEvent,
  CountsEvent,
  AlarmEvent,
]);

export type StateChangeEvent = z.infer<typeof StateChangeEvent>;
export type CountsEvent = z.infer<typeof CountsEvent>;
export type AlarmEvent = z.infer<typeof AlarmEvent>;
export type TelemetryEvent = z.infer<typeof TelemetryEvent>;

/**
 * Design notes (do not change without updating downstream plans):
 *
 * - Counts are DELTAS, not cumulative counters. Idempotent upsert keyed by
 *   (machineId, seq) in the worker makes replay across broker/worker
 *   restarts safe (see STACK.md mqtt clean:false + QoS1 guidance).
 * - Micro-stops surface as ALARM events while the machine STAYS EXECUTE —
 *   this mirrors how a real 1-2-signal OEE device (Vorne XL) sees the
 *   world, and it is exactly what makes SMALL_STOPS a Performance loss
 *   downstream rather than an Availability loss.
 */
