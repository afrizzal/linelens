import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Static enforcement of the standing rule (docs/00-domain-research.md
 * pitfall 3, PLAN.md correctness bar): `Date.now()` / bare `new Date()` are
 * BANNED in apps/worker/src/derive/** — every duration/window in the OEE
 * engine must derive from event.simTime, never the wall clock, or the
 * accelerated demo clock silently corrupts every downstream number.
 *
 * `new Date(x)` WITH an explicit argument is fine (deterministic conversion
 * of an already-known ms value) — only the wall-clock-reading zero-arg form
 * is banned. Comments are stripped before scanning so this doc comment
 * itself (which mentions the banned patterns by name) doesn't self-trigger.
 */

const DERIVE_DIR = fileURLToPath(new URL('../src/derive', import.meta.url));
const BANNED_PATTERN = /Date\.now\(\)|new Date\(\)/;

const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/\/\/.*$/gm, ''); // line comments

const listTsFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
};

describe('no Date.now() / bare new Date() in apps/worker/src/derive/**', () => {
  const files = listTsFiles(DERIVE_DIR);

  it('found the derive/ source files to scan (sanity check the scan itself is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${path.relative(DERIVE_DIR, file)} contains no wall-clock read`, () => {
      const source = readFileSync(file, 'utf-8');
      const stripped = stripComments(source);
      const match = BANNED_PATTERN.exec(stripped);
      expect(match, `found banned wall-clock pattern "${match?.[0]}" in ${file}`).toBeNull();
    });
  }
});
