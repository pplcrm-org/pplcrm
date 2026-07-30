---
name: pplcrm-add-entity
description: "The ordered checklist for adding a whole new CRUD record type across every layer — Zod schema triad, DB migration, Kysely model, tRPC router, backend registration, frontend experience with list/detail/edit, breadcrumbs, activity log, help article, tests. USE WHEN adding a new CRUD entity/module/experience, scaffolding a new record type end-to-end, or wiring a new table all the way from Postgres to an Angular list+detail page. EXAMPLES: 'add a new Campaigns entity', 'scaffold a Projects module with a list and detail view'."
---

# Add a new CRUD entity (end-to-end orchestration)

This is the **checklist that ties all the layers together**. Each individual layer has its own
deep-dive skill (see Non-goals) — this skill's job is the ordering and the easy-to-forget
registration points. Use `teams` as the canonical reference module throughout: it has a full
controller, repository, tRPC router, service, list grid, detail view, and edit form.

## Gotchas to internalize before you start

1. **tRPC routers are NOT registered in `routes.ts`.** `apps/backend/src/app/routes.ts` is
   Fastify **REST-only** (webhooks, OAuth callbacks, file downloads). Your new entity's router is
   registered in the `trpcRouter` object in `apps/backend/src/app/modules/trpc.ts`. Putting it in
   `routes.ts` does nothing.
2. **Four separate `libs/common` files must all be touched** for the type layer — miss one and the
   build breaks in a confusing place: the schema barrel (`lib/schema.ts`), the `z.infer` type
   aliases (`lib/models.ts`), the Kysely `Models` interface + table interface
   (`lib/kysely.models.ts`), and the package barrel `libs/common/src/index.ts` — it uses
   **explicit named re-export blocks**, not `export *`, so your new symbols must be added by name
   to the `from './lib/schema'` block and the `from './lib/models'` block
   or the backend build fails with `No matching export in "libs/common/src/index.ts"`.
3. **`modules/trpc.ts` — the `trpcRouter({...})` object is the registration that
   matters.** The re-export block below it is a convenience convention most routers
   follow, but it is not required for the endpoint to work (`ZapierRouter` is registered in the
   object yet absent from the re-exports).
4. **Every DB query must be tenant-scoped.** `BaseController`/`crud-router` inject `tenant_id`
   automatically, but any hand-written query you add is checked by the `no-unscoped-db-query`
   ESLint rule → see `pplcrm-tenant-safety`.

## Ordered checklist

### 1. Zod schema triad (`libs/common/src/lib/schemas/<entity>.schema.ts`)

Create `Add<Entity>Obj` and `Update<Entity>Obj` using the shared helpers from `core.schema`
(`nameSchema`, `descriptionSchema`, `idSchema`). (The full triad adds an `XObj` read-shape, but
teams-style entities only need Add/Update — see `pplcrm-schemas-validation`.) Real example:
`AddTeamObj`/`UpdateTeamObj` in `libs/common/src/lib/schemas/teams.schema.ts`.
Then export it twice: add `export * from './schemas/<entity>.schema';` to
`libs/common/src/lib/schema.ts`, AND add `Add<Entity>Obj`/`Update<Entity>Obj` by name to the
`from './lib/schema'` re-export block in `libs/common/src/index.ts` (it's named exports, not
`export *` — skipping this breaks the backend build).
→ Deep dive on the triad, `.partial()` vs hand-written Update, `core.schema` helpers:
`pplcrm-schemas-validation`.

### 2. Inferred TS types (`libs/common/src/lib/models.ts`)

Add `export type Add<Entity>Type = z.infer<typeof Add<Entity>Obj>;` and the Update variant.
Real example: `AddTeamType` and `UpdateTeamType` in `libs/common/src/lib/models.ts`.
Then add both type names to the `from './lib/models'` named re-export block in
`libs/common/src/index.ts` (same named-exports gotcha as step 1).

### 3. Kysely model (`libs/common/src/lib/kysely.models.ts`)

The file's header comment states the rule: "When adding a new table … Add a model and add it to
the interface Models". Do both: define `interface <Entity> extends RecordType { ... }` (real
example: `interface Teams`) and add `<table>: <Entity>;` to the `Models` interface (see
`teams: Teams;`). Junction/mapping tables use `extends JunctionRecordType`
(`interface MapTeamsPersons`).

### 4. Migration (`apps/backend/src/app/_migrations/YYYY-MM-DD-<description>.ts`)

New timestamped file exporting `up(db)` and `down(db)`. For the `up()`/`down()` shape see
`apps/backend/src/app/_migrations/2026-07-27-y-rate-limits.ts` (uses ``sql`...`.execute(db)``, and
shows both a `CREATE TABLE` and an `ALTER TABLE` in one file). A new entity needs a `CREATE TABLE`
including the standard `RecordType` base columns (`id`, `tenant_id`, `createdby_id`, `updatedby_id`, `created_at`,
`updated_at` — see `RecordType` in `kysely.models.ts`, and copy a real table's DDL from
`_migrations/schema.sql` for defaults/indexes). Never edit an already-applied migration.
→ Naming convention, the `schema.sql` baseline, the runner: `pplcrm-migrations`.

### 5. Backend module (`apps/backend/src/app/modules/<entity>/`)

- **Repository**: `repositories/<entity>.repo.ts` — `class <Entity>Repo extends BaseRepository<'<table>'>`
  with `super('<table>')`. Real example: `modules/teams/repositories/teams.repo.ts`.
- **Controller**: `controller.ts` — `class <Entity>Controller extends BaseController<'<table>', <Entity>Repo>`.
  Real example: `modules/teams/controller.ts` (and `tags/controller.ts`).
- **tRPC router**: `trpc.router.ts`. Two patterns exist:
  - Explicit procedures (`teams/trpc.router.ts` — `getAll`/`getById`/`add`/`update`/`delete`
    wired to `authProcedure`), OR
  - `createCrudRouter(controller, Add<Entity>Obj, Update<Entity>Obj)` for standard CRUD, then spread
    it: real example `tags/trpc.router.ts` using `apps/backend/src/app/lib/crud-router.ts`.
    `crud-router` already injects `tenant_id`/`createdby_id`/`updatedby_id` from `ctx.auth`.
    → TRPCError codes, correlationId+Pino sanitization, transactions, transactional outbox:
    `pplcrm-trpc-backend`.

### 6. Register the router (`apps/backend/src/app/modules/trpc.ts`)

Import it and add `<table>: <Entity>Router,` to the `trpcRouter` object (see `teams:` there) —
this is what makes the endpoint callable and type-safe from the frontend. Optionally also
add it to the convenience re-export block below it to match most existing routers.

### 7. Frontend service (`apps/frontend/src/app/experiences/<entity>/services/<entity>-service.ts`)

`@Service() class <Entity>Service extends AbstractAPIService<'<table>', Update<Entity>Type>` with
`endpointName = '<table>'`. Derive row/detail types from `RouterOutputs` rather than re-declaring:
`export type <Entity>Detail = RouterOutputs['<table>']['getById'];`. Real example:
`experiences/teams/services/teams-service.ts`. **`AbstractAPIService` is abstract with many
required members** (`add`, `addMany`, `attachTag`, `count`, `detachTag`, `getAll`,
`getAllArchived`, `getById`, `getTags`, `update`, `exportCsv`, …) — mirror how `teams-service.ts`
implements each; several are one-line tRPC delegations or no-op stubs.

### 8. Frontend experience UI (`apps/frontend/src/app/experiences/<entity>/ui/`)

Mirror teams:

- List grid: `<entity>-grid.ts` (real: `teams/ui/teams-grid.ts` — provides the service via
  `{ provide: AbstractAPIService, useExisting: <Entity>Service }`) → grid mechanics, columns,
  inline edit: `pplcrm-datagrid`. If the
  experience needs an icon, verify the name is a real `PcIconNameType` key in
  `libs/uxcommon/src/components/icons/icons.index.ts` before using it — invalid names silently
  render the `unknown` fallback.
- Detail view: `<entity>-view.ts` + `.html` (real: `teams/ui/team-view.ts`, `team-view.html`).
- Edit/add form: `<entity>-form.ts` + `.html` (real: `teams/ui/team-form.ts`). Uses Angular's
  signal-forms `form()` from `@angular/forms/signals` (not a project-internal helper) →
  `pplcrm-angular-components`.

### 9. Route wiring (`apps/frontend/src/app/dashboard.routes.ts`)

Add a route block with children: `''` → grid, `'add'` → form, `':id'` → view, `':id/edit'` → form.
Real example: the `people` and `tags` blocks in `dashboard.routes.ts`. (Top-level
`app.routes.ts` only lazy-loads the dashboard shell and auth pages — experiences live in
`dashboard.routes.ts`.)

**Every route needs `data: { breadcrumb: '…' }`** — the parent block gets the entity name
(`'People'`), the `add` child gets `'New person'`. `BreadcrumbDefaultsService`
(`apps/frontend/src/app/services/breadcrumb-defaults.service.ts`) publishes these to the navbar
on every NavigationEnd so the strip is never empty or stale; the `:id`/`:id/edit` children need
no label because the detail view/form overrides the default with the record name (step 10).

If the entity's URLs should carry record slugs instead of numeric ids (spec §1 — households
and companies use name slugs; **persons use an opaque `public_id`** instead), follow the
checklist in `docs/RECORD-SLUGS.md` (migration + `slugExists`/`getOneBySlug` repo methods +
`record-slug.resolver.ts` entry for the name-slug flow; for anything people/identity-sensitive
prefer the person `public_id` flow documented there).

### 10. Breadcrumbs (in the detail view component)

Expose a `computed<PcBreadcrumb[]>` and bind it to `[crumbs]` on `<pc-detail-layout>`. Real example:
the `crumbs` computed in `team-view.ts`, bound in `team-view.html`.
→ Detail-layout composition, record prev/next nav, `AlertService` vs confirm-dialog:
`pplcrm-page-layout-ux`.

### 11. Activity log (MANDATORY for any data-modifying entity)

Every detail view must include `<pc-record-activities [entity]="'<table>'" [entityId]="id()!">`.
Real example: `team-view.html`. Import `RecordActivities` from
`@experiences/activity/ui/record-activities/record-activities` (see `team-view.ts`).

### 12. Tests (co-located `*.spec.ts`, Vitest)

Spec files live next to source, not in a separate folder. Real examples:
`experiences/teams/ui/team-form.spec.ts`, `experiences/tags/services/tags-service.spec.ts`.
→ Runner specifics and the spec-file lint gap: `pplcrm-testing`.

### 13. Help documentation (MANDATORY for any user-facing entity)

A new entity is a new user-facing feature, so the in-app Help Center must ship in the same change.
Articles are typed TypeScript data in `libs/common/src/lib/help/articles/*.ts`
(one file per category, aggregated in `libs/common/src/lib/help/help-content.ts`) — shared so both the
CRM frontend and the marketing website consume the same content. Add or extend the article that covers the
new record type — what it is, how to create/edit/delete it, and any related flows — and wire its
`related` ids and internal `[label](/route)` links. Inline mini-markup only: `**bold**`, backtick
code, `[label](/internal/route)`. The integrity spec (`libs/common/src/lib/help/help-content.spec.ts`) fails on duplicate
slugs, broken `related` ids, and links to unknown routes, but it does **not** catch stale or missing
prose — write the words yourself. Run `npx nx test common`.

### 14. Verify

Run `/verify`, then the quality gate before committing → `pplcrm-quality-gate`
(remember: green `nx lint` is necessary but not sufficient; run plain `eslint` on your changed
files, the same command the pre-commit hook uses).

## Non-goals — what this skill deliberately does NOT deep-dive

- tRPC procedure mechanics, TRPCError, Kysely transactions/outbox → **`pplcrm-trpc-backend`**
- The Zod `AddXObj`/`UpdateXObj`/`XObj` triad rationale and `core.schema` helpers → **`pplcrm-schemas-validation`**
- Detail-layout / breadcrumbs / record-nav composition and UX review rules → **`pplcrm-page-layout-ux`**
- Migration naming, the `schema.sql` baseline, the runner → **`pplcrm-migrations`**
- Tenant scoping and the `no-unscoped-db-query` rule → **`pplcrm-tenant-safety`**
- `form()` helper, signals, loading gate, `pc-icon` → **`pplcrm-angular-components`**
- Vitest specifics and the spec-file lint gap → **`pplcrm-testing`**
- Generating project scaffolding via Nx generators → global **`nx-generate`** (no per-entity
  generator exists here; entities are added by hand following this checklist)
