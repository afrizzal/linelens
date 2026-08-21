import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

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
export * from '../generated/prisma/client.js';
