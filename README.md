# 🧱 pplCRM

**pplCRM** is a full‑stack campaign CRM built with Nx, Angular, Fastify, and PostgreSQL. It supports user management, authentication, and session tracking while emphasizing performance and modularity.

---

## 🧰 Tech Stack

| Layer         | Tools                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| Frontend      | Angular 22 (zoneless, signals), Tailwind CSS v4, DaisyUI v5, a house-built `pc-datagrid`    |
| Backend       | Fastify 5, tRPC, Kysely, PostgreSQL (row-level security)                                    |
| Auth          | JWT via `fast-jwt`, refresh tokens, passkeys, session tracking                              |
| Styling       | Tailwind CSS v4 — configured in CSS; there is no `tailwind.config.js` — plus DaisyUI        |
| Emails        | Postmark for transactional (pplCRM → users), SendGrid for newsletters (tenant → supporters) |
| Build Tooling | Nx monorepo, esbuild                                                                        |
| Testing       | Vitest (unit + integration), Playwright (e2e)                                               |
| Hosting       | Azure Container Apps (API) + Cloudflare Pages/Workers (web, edge)                           |

---

## 🗂️ Repository Structure

Four deployables:

- `apps/backend/` – Fastify API server: modules (controllers, repositories, routers), migrations, background-job worker.
- `apps/frontend/` – the desktop CRM. Angular 22 SPA, standalone components and signals. Also serves the public form/event pages.
- `apps/companion/` – the mobile volunteer apps (canvassing `/t/:token`, deliveries `/r/:token`). REST-only, no tRPC, works offline.
- `apps/website/` – the marketing site (SSR), including the public docs and legal pages.

Shared libraries:

- `libs/common/` – shared TypeScript/Zod schemas and the Kysely database models. Import as `@common`.
- `libs/uxcommon/` – generic shared UI controls and the DaisyUI theme. Import as `@uxcommon/*`.

Never use relative paths across a package boundary; the aliases in `tsconfig.base.json` exist for
this. Other docs: [Common UX Elements](docs/UX_COMMON.md), [Feature Components](docs/COMPONENTS.md),
and the task-specific skills in `.claude/skills/`.

---

## 🔧 Backend Highlights

- `main.ts` boots a `FastifyServer` instance (`fastify.server.ts`) that registers REST routes and mounts tRPC.
- Controllers (`controllers/`) host business logic; repositories (`repositories/`) implement CRUD with Kysely.
- Authentication uses `fast-jwt` for access/refresh tokens, **argon2** for password hashing, passkeys, and session tracking.
- API is exposed via both tRPC routers and REST routes, organized by domain under `apps/backend/src/app/modules`.

---

## 🎨 Frontend Highlights

- Standalone Angular 22 components (`app.ts`, `app.routes.ts`) using signals and reactive forms.
- `services/api/` provides tRPC client setup, token storage, and search utilities.
- Feature modules live in `experiences/` (persons, households, tags, campaigns, canvassing, …), each with its grid, detail pages, and services.
- Reusable UI elements live in `layout/` and `uxcommon/`, which now groups shared
  Angular pieces into `components/`, `directives/`, `pipes/`, and `services/`.

---

## 🏃 Daily Development

For day-to-day work, assuming you've already completed the first-time setup:

### 1. Start Background Services

Two services must be running: PostgreSQL and Azurite (the Azure blob-storage emulator).

**PostgreSQL** — if installed via Homebrew, it is usually already running as a service.
Check with `pg_isready -h localhost`; if it is not running:

```bash
brew services start postgresql@18
```

**Azurite** — run in its own terminal window (stays in the foreground):

```bash
npm run azurite:start
```

The `--skipApiVersionCheck` flag baked into that script is required: the repo's
`@azure/storage-blob` library speaks a newer API version than Azurite accepts, and
without the flag every storage call fails with an `InvalidHeaderValue` error.

<details>
<summary>Using Docker instead</summary>

If you set up with Docker (see the [Setup Guide](SETUP.md)), start the existing containers:

```bash
docker start pplcrm-db
docker start pplcrm-azurite
```

</details>

### 2. Run the Apps

Start the backend and frontend in two separate terminal windows:

**Terminal 1 (Backend):**

```bash
nx serve backend
```

**Terminal 2 (Frontend):**

```bash
nx serve frontend
```

---

## 🚀 First-Time Setup

If you are setting up the project for the very first time, please follow the step-by-step instructions in the [Setup Guide](SETUP.md).

---

## 🧪 Testing & Linting

```bash
npx nx run-many -t test -p frontend backend common uxcommon companion website
npx nx e2e frontend-e2e

# Both lint passes are required and enforce DISJOINT rule sets — a green run of one
# says nothing about the other. See .claude/skills/pplcrm-quality-gate.
npx nx run-many -t lint -p frontend backend common uxcommon companion website
npx eslint <changed-files> --report-unused-disable-directives-severity=off
npx prettier --write .
```

Backend specs run against a real PostgreSQL database (`*_test`), which the Vitest global setup
migrates and truncates. Some share the queue and take an advisory lock — see
`apps/backend/src/app/lib/test-utils/exclusive-db-lock.ts`.

---

## 📦 Deployment

Deployment is automated by `.github/workflows/deploy.yml`; there is nothing to run by hand.

- Every PR runs `verify.yml` (lint → test → build → e2e); `main` is gated by the same workflow.
- The API ships as a container image to **Azure Container Apps**, with database migrations run as
  a job that gates the deploy.
- The marketing site and the CRM ship to **Cloudflare Pages**; the edge routing (`go.pplcrm.com`,
  `*.pplforms.com`) is Cloudflare Workers.
- Builds output to `dist/apps/<project>`.

---

## 📚 Next Steps & Resources

- [Setup Guide](SETUP.md)
- [Common UX Elements Guide](docs/UX_COMMON.md)
- [Feature Components Catalog](docs/COMPONENTS.md)
- [Nx Docs](https://nx.dev)
- [tRPC](https://trpc.io)
- [Kysely](https://github.com/kysely-org/kysely)
- [Angular Standalone APIs](https://angular.dev/guide/standalone-components)
- [Fastify](https://www.fastify.io)

With this structure in mind, newcomers can navigate the repository, understand how front‑ and back‑end pieces interact, and identify the next areas to explore for deeper proficiency.
