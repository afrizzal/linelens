# Single image for simulator, worker, and web — AIDA's proven one-image shape.
# Command (and therefore which app runs) is set per-service in docker-compose.yml.
FROM node:24-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.34.4 --activate

WORKDIR /app

# Install deps first (better layer caching), then copy the rest of the source.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
COPY apps/simulator/package.json apps/simulator/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --frozen-lockfile

COPY . .

# No build step for v1: simulator/worker run via tsx directly, web runs `next dev`.
# This is an appliance, not a scaled service — dev-mode Next.js is an accepted
# tradeoff for the foundation phase (Phase 1 has no UI yet, no domain logic).
EXPOSE 3000 4000
CMD ["node", "--version"]
