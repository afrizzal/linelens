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
  // RESOLVED (see 03-01-SUMMARY.md "Known Issues" for the original bug, and
  // the wave-2 quick-fix commit for the full investigation): this gets
  // Turbopack past `packages/db/src/*`, but a *relative* import from a file
  // reached via a package.json `exports` subpath (e.g. `src/client.ts`,
  // reached via the `./client` subpath below) into a nested sibling file —
  // `../generated/prisma/client.js`, the Prisma-7 generated TS client —
  // reliably failed to resolve in Turbopack's `next dev`, regardless of
  // whether that generated output lived beside `src/` or inside it, and
  // regardless of `importFileExtension` on the Prisma generator. The fix:
  // route the SAME way the `./client` subpath itself was routed — a second
  // package.json `exports` subpath (`./generated-client`), self-imported
  // from `packages/db/src/client.ts` via `@linelens/db/generated-client`
  // instead of a relative path. Turbopack resolves exports-map subpaths
  // correctly; it just can't chase a relative import one hop past one.
  // Tried and ruled out: adding `generated` to packages/db/tsconfig.json's
  // `include`, an explicit `turbopack.root`, and `importFileExtension = ""`
  // on the Prisma generator (Prisma's own `nextjs-schema-not-found`
  // monorepo e2e fixture uses this, but it did not affect resolution of
  // this specific hand-written re-export).
  transpilePackages: ["@linelens/db", "@linelens/contracts"],
};

export default nextConfig;
