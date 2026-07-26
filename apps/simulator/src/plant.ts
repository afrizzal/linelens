import type { PlantConfig, TelemetryEvent } from '@linelens/contracts';
import { makeRng, seedFor } from './rng.js';
import { advance, createMachineRuntime, forceBreakdown, type MachineCtx, type MachineRuntime } from './machine.js';
import { resolveCalibration } from '@linelens/contracts';

export interface Plant {
  advanceAll(toSimMs: number): void;
  /** Force an immediate DOWN on a chosen line (demo "inject breakdown" control). */
  injectBreakdown(
    lineId: string,
    atSimMs: number,
    opts?: { machineId?: string; durationSec?: number },
  ): { machineId: string; until: string } | null;
  machineCount(): number;
  machines(): readonly MachineRuntime[];
}

export interface PlantOptions {
  config: PlantConfig;
  onEvent: (e: TelemetryEvent) => void;
  /** Sim-ms at which the plant (and every machine) begins its life. */
  startSimMs: number;
}

/** Build the full plant (every line/machine) from `plant.config.json`, ready to `advanceAll`. */
export const createPlant = (opts: PlantOptions): Plant => {
  const { config, onEvent, startSimMs } = opts;
  const products = config.products;

  const machines: MachineRuntime[] = [];
  const ctxByMachine = new Map<string, MachineCtx>();

  for (const line of config.lines) {
    for (const m of line.machines) {
      const calib = resolveCalibration(m);
      const rng = makeRng(seedFor(config.seed, m.id));
      const ctx: MachineCtx = { calib, products, shifts: config.shifts, rng };
      const rt = createMachineRuntime({ id: m.id, lineId: line.id, productId: m.productId }, ctx, startSimMs);
      machines.push(rt);
      ctxByMachine.set(m.id, ctx);
    }
  }

  const advanceAll = (toSimMs: number): void => {
    for (const rt of machines) {
      const ctx = ctxByMachine.get(rt.machineId)!;
      advance(rt, toSimMs, ctx, onEvent);
    }
  };

  const injectBreakdown: Plant['injectBreakdown'] = (lineId, atSimMs, injOpts = {}) => {
    const lineMachines = machines.filter((m) => m.lineId === lineId);
    if (lineMachines.length === 0) return null;
    const target = injOpts.machineId
      ? lineMachines.find((m) => m.machineId === injOpts.machineId)
      : lineMachines.find((m) => m.state === 'EXECUTE') ?? lineMachines[0];
    if (!target) return null;
    const ctx = ctxByMachine.get(target.machineId)!;
    const durationMs = (injOpts.durationSec ?? 300) * 1000;
    const ok = forceBreakdown(target, atSimMs, durationMs, ctx, onEvent);
    if (!ok) return null;
    return { machineId: target.machineId, until: new Date(atSimMs + durationMs).toISOString() };
  };

  return {
    advanceAll,
    injectBreakdown,
    machineCount: () => machines.length,
    machines: () => machines,
  };
};
