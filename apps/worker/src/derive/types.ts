import type { ShiftDef } from '@linelens/contracts';

/**
 * Shared types for the derivation core (machine_event -> state_interval ->
 * loss_event). Deliberately decoupled from Prisma's generated types: the
 * business logic in intervals.ts/losses.ts operates against the
 * `DerivationStore` interface (store.ts) so it is testable with an
 * in-memory fixture store (no Postgres needed) AND driven for real by
 * `PrismaStore` (prisma-store.ts) inside a `$transaction`.
 *
 * STANDING RULE (docs/00-domain-research.md pitfall 3 + PLAN.md correctness
 * bar): every duration/window here is computed from `event.simTime` —
 * NEVER `Date.now()`/`new Date()`. This file only DECODES calendar
 * structure from an explicit sim-ms value (matching the precedent in
 * @linelens/contracts calendar.ts), it never reads the wall clock.
 */

/** A raw machine_event row, normalized to the shape the derivation core consumes. */
export interface DerivedEvent {
  id: bigint;
  machineId: string;
  lineId: string;
  kind: 'STATE_CHANGE' | 'COUNTS' | 'ALARM';
  /** Sim-time — the only "now" this file knows about. */
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
  meta?: { injected?: boolean } | null;
}

/** Master-data view of a machine, as needed by derivation (rule 2's changeoverTargetMin, rule 3b's currentProductId). */
export interface MachineMaster {
  id: string;
  lineId: string;
  changeoverTargetMin: number;
  currentProductId: string | null;
}

export interface EngineConfigState {
  changeoverAsPlanned: boolean;
}

/** An open (endTime null) or just-closed state_interval row, as the reducer sees it. */
export interface IntervalRow {
  machineId: string;
  lineId: string;
  state: string;
  startTime: Date;
  endTime: Date | null;
  reasonCode: string | null;
  injected: boolean;
  sourceEventId: bigint;
}

/** Input to open a brand-new interval. */
export type NewIntervalInput = Omit<IntervalRow, 'endTime'>;

/** Input to upsert one loss_event row (idempotent on the natural key — see schema.prisma LossEvent doc). */
export interface LossEventInput {
  machineId: string;
  lineId: string;
  factor: 'AVAILABILITY' | 'PERFORMANCE' | 'QUALITY';
  category: string;
  reasonCode: string;
  windowStart: Date;
  windowEnd: Date;
  lostTimeSec: number;
  lostUnits: number;
  injected: boolean;
  /** 0n = no source event (interval-derived rules 1/2/4). See schema.prisma LossEvent doc. */
  sourceEventId: bigint;
  shiftDate: string | null;
  shiftId: string | null;
}

/** A raw COUNTS row read back for rule 4's residual ICT-time sum. */
export interface CountsWindowRow {
  simTimeMs: number;
  goodDelta: number;
  rejectDelta: number;
  idealCycleTimeSec: number;
}

/** A raw SMALL_STOPS loss_event row read back for rule 4's residual subtraction. */
export interface SmallStopWindowRow {
  lostTimeSec: number;
}

export type { ShiftDef };
