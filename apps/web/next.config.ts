import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @linelens/db (and its own @linelens/contracts dependency) ship
  // TypeScript SOURCE directly via package.json "exports" (no build step —
  // apps/worker/apps/simulator consume it via `tsx`, which resolves this
  // fine on its own). Next.js's bundler needs to be told to include these
  // workspace packages in ITS OWN compilation pipeline, or `next dev`
  // fails at runtime with "Module not found: Can't resolve './client.js'"
  // (03-01-PLAN.md Task 2 in-docker verification caught this — found only
  // by testing inside docker, not `next dev` on the host, per
  // PITFALLS.md's own warning about that exact gap).
  //
  // KNOWN OPEN ISSUE (see 03-01-SUMMARY.md "Known Issues"): this gets
  // Turbopack past `packages/db/src/*`, but a deeper relative import from
  // `src/client.ts` into `../generated/prisma/client.js` (the Prisma-7
  // generated TS client, reached through the pnpm-symlinked
  // node_modules/@linelens/db) still fails to resolve in `next dev`
  // inside docker. Tried and ruled out: a `./client` package.json export
  // subpath (packages/db/package.json), adding `generated` to
  // packages/db/tsconfig.json's `include`, and an explicit
  // `turbopack.root`. Unresolved — flagged for follow-up in wave 2.
  transpilePackages: ["@linelens/db", "@linelens/contracts"],
};

export default nextConfig;
