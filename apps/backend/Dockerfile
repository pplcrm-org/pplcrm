# syntax=docker/dockerfile:1
#
# Production image for the pplCRM backend (Fastify + tRPC + Kysely).
#
# The backend is a SINGLE process: it serves the API *and* runs the in-process background-job
# worker, the webhook worker, and self-scheduled cron (via the background_jobs table + Postgres
# LISTEN/NOTIFY). There is no separate worker/scheduler to deploy — but for that reason, run one
# instance to start (the DB queue makes scaling out safe later via SELECT ... FOR UPDATE SKIP LOCKED).
#
# Migrations are NOT run here. They run as a separate deploy step as the `pplcrm_owner` role, via
# `npx tsx apps/backend/src/app/migrate-cli.ts` over the source tree (the migrator imports the .ts
# migration files). This image sets MIGRATE_ON_BOOT=false and carries no migration files.

##############################
# Stage 1 — build the backend
##############################
# Node 26 matches the repo's local runtime. esbuild bundles main.ts to an ESM file but keeps
# node_modules EXTERNAL (project.json: packages "external", generatePackageJson false), so the
# runtime image must ship the production node_modules alongside the bundle.
FROM node:26-bookworm-slim AS builder
WORKDIR /app

# Install ALL deps (incl. dev) for the Nx/esbuild build. Lockfile first for layer caching.
# .npmrc carries legacy-peer-deps=true (Nx 23 vs Angular 22 peer conflict) — npm ci needs it here too.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# The backend build pulls cross-package types (@common, the tRPC router type) from elsewhere in the
# monorepo, so the whole repo must be present. The build's `generate-context` step runs `npx repomix`
# to refresh STRUCTURE.md and needs network access at build time (standard for image builds).
COPY . .

# Produce dist/apps/backend (ESM bundle; node_modules NOT bundled).
RUN npx nx build backend --configuration=production

# Re-resolve node_modules to production-only for the runtime image. Because esbuild left every
# dependency external, all *runtime* deps must remain — only devDependencies are dropped.
# The `prepare` script runs husky (a devDependency); under --omit=dev husky is gone and the script
# fails with 127. Strip the hook first — dependency install scripts still run (no native-dep risk).
RUN npm pkg delete scripts.prepare && npm ci --omit=dev

######################################
# Stage 2 — slim runtime (serve only)
######################################
FROM node:26-bookworm-slim AS runtime
WORKDIR /app
# Git commit SHA of this build, passed by CI (deploy.yml --build-arg BUILD_SHA=<github.sha>).
# /healthz reports it so the post-deploy smoke test can prove the NEW revision is serving —
# in single-revision Container Apps, a new revision that never becomes healthy leaves the old
# one answering 200. 'dev' for local builds.
ARG BUILD_SHA=dev
# TZ is pinned so date handling never depends on host config: Postgres `date` columns arrive from
# the pg driver as midnight in the process's local zone, and PDF/report code reads them by their
# local components. UTC is what the platform already gives us — this makes it explicit.
ENV NODE_ENV=production \
    TZ=UTC \
    HOST=0.0.0.0 \
    PORT=3000 \
    MIGRATE_ON_BOOT=false \
    BUILD_SHA=$BUILD_SHA

# Ship the pruned prod deps + the bundle. Run as the image's built-in unprivileged `node` user.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist/apps/backend ./dist/apps/backend
COPY --from=builder --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 3000

# Readiness probe hits the DB-aware /healthz (returns 503 when Postgres is unreachable).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/apps/backend/main.js"]
