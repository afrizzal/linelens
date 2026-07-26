import { z } from 'zod';
import type { ShiftDef } from './calendar.js';

/**
 * Calibration parameters for a single machine's simulated behavior. This is
 * the SINGLE SOURCE for both the simulator (plan 01-03) and the DB seed
 * (plan 02-01) — they must never diverge on changeoverTargetMin/
 * startupWindowMin, or the OEE engine's overage split would run against a
 * different target than the sim actually used.
 */
export const CalibrationParamsSchema = z.object({
  mtbfMin: z.number().positive(),
  mttrMeanMin: z.number().positive(),
  changeoverEveryMin: z.number().positive(),
  changeoverDurMin: z.number().positive(),
  changeoverTargetMin: z.number().positive(),
  microstopsPerHour: z.number().nonnegative(),
  microstopMeanSec: z.number().positive(),
  slowCycleFactor: z.number().positive(),
  rejectRate: z.number().min(0).max(1),
  startupRejectRate: z.number().min(0).max(1),
  startupWindowMin: z.number().positive(),
});
export type CalibrationParams = z.infer<typeof CalibrationParamsSchema>;

export const CALIBRATION_PROFILES = ['showcase', 'typical', 'problem'] as const;
export type CalibrationProfile = (typeof CALIBRATION_PROFILES)[number];

/**
 * Profile knobs tuned to land in the verified OEE bands
 * (docs/00-domain-research.md §2: most lines 50-65%, one showcase ~85%,
 * one problem <45%). This is engineering calibration, NOT a sourced
 * industry claim — an honesty guardrail per PROJECT.md.
 */
export const PROFILES: Record<CalibrationProfile, CalibrationParams> = {
  showcase: {
    mtbfMin: 300,
    mttrMeanMin: 8,
    changeoverEveryMin: 240,
    changeoverDurMin: 14,
    changeoverTargetMin: 15,
    microstopsPerHour: 0.5,
    microstopMeanSec: 20,
    slowCycleFactor: 1.02,
    rejectRate: 0.008,
    startupRejectRate: 0.03,
    startupWindowMin: 5,
  },
  typical: {
    mtbfMin: 110,
    mttrMeanMin: 16,
    changeoverEveryMin: 150,
    changeoverDurMin: 24,
    changeoverTargetMin: 20,
    microstopsPerHour: 3,
    microstopMeanSec: 45,
    slowCycleFactor: 1.08,
    rejectRate: 0.025,
    startupRejectRate: 0.06,
    startupWindowMin: 5,
  },
  problem: {
    mtbfMin: 55,
    mttrMeanMin: 28,
    changeoverEveryMin: 120,
    changeoverDurMin: 35,
    changeoverTargetMin: 20,
    microstopsPerHour: 6,
    microstopMeanSec: 60,
    slowCycleFactor: 1.15,
    rejectRate: 0.05,
    startupRejectRate: 0.1,
    startupWindowMin: 8,
  },
};

const ShiftBreakSchema = z.object({ startMin: z.number().nonnegative(), endMin: z.number().nonnegative() });

export const ShiftDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  startMin: z.number().nonnegative(),
  endMin: z.number().nonnegative(),
  breaks: z.array(ShiftBreakSchema),
}) satisfies z.ZodType<ShiftDef>;

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  idealCycleTimeSec: z.number().positive(),
});

export const MachineConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  productId: z.string(),
  profile: z.enum(CALIBRATION_PROFILES),
  overrides: CalibrationParamsSchema.partial().optional(),
});
export type MachineConfig = z.infer<typeof MachineConfigSchema>;

export const LineConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  machines: z.array(MachineConfigSchema),
});

export const PlantConfigSchema = z.object({
  seed: z.number().int(),
  speed: z.number().positive(),
  products: z.array(ProductSchema),
  shifts: z.array(ShiftDefSchema),
  lines: z.array(LineConfigSchema),
});
export type PlantConfig = z.infer<typeof PlantConfigSchema>;

/** Resolve a machine's effective calibration: profile defaults merged with per-machine overrides. */
export const resolveCalibration = (m: MachineConfig): CalibrationParams => ({
  ...PROFILES[m.profile],
  ...m.overrides,
});
