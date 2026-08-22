import { PrismaPg } from '@prisma/adapter-pg';
// Self-referencing package import (Node's package.json "exports" self-import
// feature) instead of a relative `./generated/prisma/client.js` path. Turbopack
// cannot resolve a relative import from a module reached via an exports-map
// subpath (client.ts is reached via the "./client" subpath below) into a
// nested TS file one level deeper — same class of failure the "./client"
// subpath itself was added to work around one hop up (03-01-SUMMARY.md
// "Known Issues"). Routing through the SAME exports-map mechanism again
// (a dedicated "./generated-client" subpath, self-imported here) sidesteps
// it, since that mechanism is proven to work for Turbopack.
import { PrismaClient } from '@linelens/db/generated-client';

/**
 * Prisma 7 is driver-adapter-only — it will NOT connect without one
 * (STACK.md "Prisma without a driver adapter" — What NOT to Use). This is
 * the single client factory; every service (worker, web) imports this
 * instead of constructing PrismaClient directly.
 */
export const createDb = (url = process.env.DATABASE_URL): PrismaClient => {
  if (!url) {
    throw new Error('DATABASE_URL is required to create the Prisma client');
  }
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
};

export type Db = PrismaClient;
export * from '@linelens/db/generated-client';
