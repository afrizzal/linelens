/**
 * Six Big Losses — verified 2-2-2 taxonomy (docs/00-domain-research.md §3),
 * confirmed independently by TeepTrak, Evocon, Intelycx (traces to TPM/Nakajima).
 *
 * CRITICAL (verified, credibility-bearing): SMALL_STOPS is a PERFORMANCE loss,
 * never an Availability loss. There is NO hardcoded minute-threshold constant
 * anywhere in this package or downstream — small stops are identified by
 * ALARM events (see events.ts, and the state machine in plan 01-03), never by
 * a duration cutoff. This directly refutes anti-pattern §8.2 (no normative
 * 2-minute-or-any-fixed threshold exists in the verified sources).
 */
export const SIX_BIG_LOSSES = [
  'UNPLANNED_STOPS',
  'PLANNED_STOPS',
  'SMALL_STOPS',
  'SLOW_CYCLES',
  'STARTUP_REJECTS',
  'PRODUCTION_REJECTS',
] as const;

export type SixBigLoss = (typeof SIX_BIG_LOSSES)[number];

export type OeeFactor = 'AVAILABILITY' | 'PERFORMANCE' | 'QUALITY';

export const LOSS_FACTOR: Record<SixBigLoss, OeeFactor> = {
  UNPLANNED_STOPS: 'AVAILABILITY',
  PLANNED_STOPS: 'AVAILABILITY',
  SMALL_STOPS: 'PERFORMANCE',
  SLOW_CYCLES: 'PERFORMANCE',
  STARTUP_REJECTS: 'QUALITY',
  PRODUCTION_REJECTS: 'QUALITY',
};
