import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PlantConfigSchema, PROFILES, resolveCalibration } from '../src/plant-config.js';

const PLANT_CONFIG_PATH = fileURLToPath(new URL('../../../plant.config.json', import.meta.url));

describe('PlantConfigSchema', () => {
  it('parses the default plant.config.json', () => {
    const raw = JSON.parse(readFileSync(PLANT_CONFIG_PATH, 'utf-8'));
    const parsed = PlantConfigSchema.parse(raw);
    expect(parsed.lines).toHaveLength(4);
    expect(parsed.products).toHaveLength(3);
    expect(parsed.speed).toBe(60);
    expect(parsed.seed).toBe(42);
  });
});

describe('resolveCalibration', () => {
  it('uses profile defaults when no overrides given', () => {
    const resolved = resolveCalibration({
      id: 'M1',
      name: 'M1',
      productId: 'CYC-A',
      profile: 'showcase',
    });
    expect(resolved).toEqual(PROFILES.showcase);
  });

  it('merges per-machine overrides on top of profile defaults', () => {
    const resolved = resolveCalibration({
      id: 'M1',
      name: 'M1',
      productId: 'CYC-A',
      profile: 'typical',
      overrides: { mtbfMin: 999 },
    });
    expect(resolved.mtbfMin).toBe(999);
    expect(resolved.mttrMeanMin).toBe(PROFILES.typical.mttrMeanMin);
  });
});
