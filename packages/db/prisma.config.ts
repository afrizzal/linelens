import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Repo root .env lives two levels up from packages/db — load it explicitly
// since the Prisma CLI's cwd is this package, not the workspace root. In the
// Docker build, .env is deliberately excluded from the build context (never
// bake local secrets into an image — see .dockerignore), so this is a no-op
// there and DATABASE_URL stays unset — fine for `prisma generate`, which
// does not need a live datasource. `migrate`/`db` commands DO need it and
// will fail with Prisma's own clear error if it's missing at that point.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx seed/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
