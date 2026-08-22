import { createDb, type Db } from "@linelens/db";

/**
 * Shared Prisma client singleton for the web app's read-only API routes
 * (ENG-01: web NEVER writes derived state — only Prisma reads + the
 * dedicated LISTEN client in listener.ts touch Postgres from this
 * process). globalThis-cached so Next.js dev-mode module reloads reuse one
 * client instead of leaking a new connection pool per reload — the
 * standard Next.js + Prisma singleton pattern.
 */
declare global {
  // eslint-disable-next-line no-var
  var __linelensDb: Db | undefined;
}

export const db: Db = globalThis.__linelensDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalThis.__linelensDb = db;
}
