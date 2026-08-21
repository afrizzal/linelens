import { createDb } from '../src/client.js';
import { runSeed } from '../src/seed.js';

/**
 * CLI entrypoint (`pnpm db:seed`). Always upserts unconditionally — the
 * boot-time "only if empty" guard lives in `seedIfEmpty` (src/seed.ts),
 * used by the worker's startup path instead.
 */
const main = async (): Promise<void> => {
  const db = createDb();
  try {
    const counts = await runSeed(db);
    console.log('[seed] complete', counts);
  } finally {
    await db.$disconnect();
  }
};

main().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
