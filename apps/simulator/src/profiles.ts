/**
 * Calibration profiles — thin re-export. The single source of truth is
 * `@linelens/contracts` (PROFILES/resolveCalibration), shared with the DB
 * seed (plan 02-01) so the simulator and engine never diverge on
 * changeoverTargetMin/startupWindowMin. Do NOT redefine numbers here.
 */
export { PROFILES, resolveCalibration, CALIBRATION_PROFILES } from '@linelens/contracts';
export type { CalibrationParams, CalibrationProfile, MachineConfig } from '@linelens/contracts';
