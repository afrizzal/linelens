import type { SixBigLoss } from './losses.js';

/**
 * Reason-code taxonomy. Each code maps to exactly one Six Big Losses
 * category (docs/00-domain-research.md §3). Reason codes model
 * operator-style annotation (per Vorne XL's actual data model — reason data
 * comes from operator input, not sensors; docs/00-domain-research.md §4).
 */
export interface ReasonCode {
  code: string;
  label: string;
  category: SixBigLoss;
}

export const REASON_CODES: readonly ReasonCode[] = [
  // UNPLANNED_STOPS
  { code: 'BRK-MECH', label: 'Mechanical jam', category: 'UNPLANNED_STOPS' },
  { code: 'BRK-ELEC', label: 'Electrical fault', category: 'UNPLANNED_STOPS' },
  { code: 'BRK-SENSOR', label: 'Sensor failure', category: 'UNPLANNED_STOPS' },
  // Used only by the OEE engine's planned->unplanned overage split (plan 02-02)
  { code: 'CO-OVERAGE', label: 'Changeover overage', category: 'UNPLANNED_STOPS' },

  // PLANNED_STOPS
  { code: 'CO-PRODUCT', label: 'Product changeover', category: 'PLANNED_STOPS' },
  { code: 'CO-CLEAN', label: 'Cleaning/sanitation', category: 'PLANNED_STOPS' },

  // SMALL_STOPS
  { code: 'SS-MISFEED', label: 'Misfeed', category: 'SMALL_STOPS' },
  { code: 'SS-MATERIAL', label: 'Material jam', category: 'SMALL_STOPS' },
  { code: 'SS-SENSOR', label: 'Blocked sensor', category: 'SMALL_STOPS' },

  // SLOW_CYCLES
  { code: 'SL-SPEED', label: 'Running below rated speed', category: 'SLOW_CYCLES' },

  // STARTUP_REJECTS
  { code: 'RJ-STARTUP', label: 'Startup/warm-up reject', category: 'STARTUP_REJECTS' },

  // PRODUCTION_REJECTS
  { code: 'RJ-DIM', label: 'Dimensional defect', category: 'PRODUCTION_REJECTS' },
  { code: 'RJ-VISUAL', label: 'Visual defect', category: 'PRODUCTION_REJECTS' },
] as const;

export const REASON_BY_CODE: ReadonlyMap<string, ReasonCode> = new Map(
  REASON_CODES.map((r) => [r.code, r]),
);
