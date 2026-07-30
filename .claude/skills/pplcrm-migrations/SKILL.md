---
name: pplcrm-migrations
description: "Adding and running Kysely SQL migrations, the filename convention that controls run order, the never-edit-an-applied-migration rule, and how the schema.sql baseline works. USE WHEN adding or changing a database table/column, writing a migration file, debugging 'corrupt migrations' or 'relation already exists' errors on startup, or regenerating the schema baseline. EXAMPLES: 'add a column to persons', 'how do I regenerate the schema baseline', 'migration failed with corrupt migrations error'."
---

# pplCRM Database Migrations

Migrations are plain Kysely SQL files run by Kysely's `Migrator` + `FileMigrationProvider`. There is **no codegen and no separate `migrate` npm script** — migrations run automatically when the backend boots.

## The non-obvious rules first

1. **The baseline file is `schema.sql`, NOT `schema_dump.sql`.** The real file is `apps/backend/src/app/_migrations/schema.sql`, read by `0001_baseline.ts`. (Stale `schema_dump.sql` mentions may still lurk in older docs — trust the filename on disk.)

2. **Never edit or rename a migration that has already run.** Kysely records each applied migration by name in the `kysely_migration` table. An already-recorded migration is never re-run, so editing its `up()` silently changes nothing on any DB that already ran it. Renaming or deleting one is worse: Kysely finds a recorded name with no matching file and aborts with a **corrupt migrations** error. This has bitten before: `kyselyinit.ts` carried an `ensureMigrationTableUpdated` shim for years that `UPDATE kysely_migration SET name = ...` to paper over a rename (removed in the 2026-07-26 squash, once the migrations it renamed no longer existed). Don't create that mess — add a new file instead. (The one sanctioned exception is a deliberate pre-ship **re-squash**, which deletes the dated files _and_ resets `kysely_migration` in the same operation — see "Re-squashing" below.)

3. **`tools/ai-migrations/` is unrelated.** It contains only Nx package-upgrade notes and is referenced nowhere in the codebase. It is NOT a migration tool. Ignore it.

## Naming convention

Files live in `apps/backend/src/app/_migrations/`. Kysely runs them in **lexicographic filename order**, so the name is load-bearing:

- Regular migrations: `YYYY-MM-DD-short-description.ts` — e.g. `2026-08-14-add-campaign-budget.ts`. (After the 2026-07-26 re-squash there are no dated files in the tree to crib from — for worked examples see git history before that squash, e.g. `2026-07-25-system-lists.ts` for add-column + check-constraint + partial-unique-index, or `2026-07-07-record-slugs.ts` for an add-column + backfill.)
- The baseline is `0001_baseline.ts` — the `0001_` numeric prefix sorts before every dated file so it always runs first.
- **Same-day tie-break:** when two migrations share a date, disambiguate order with a letter segment: `2026-07-01-a-schema-improvements`, `2026-07-01-b-security-ops-improvements`. Use this if you add a second migration on a day that already has one.

Every file must export `up(db: Kysely<any>)` and `down(db: Kysely<any>)`.

## How migrations run

- Registered via `BaseRepository.migrator` — `Migrator` + `FileMigrationProvider` pointed at `apps/backend/src/app/_migrations`, resolved from `process.cwd()` (`apps/backend/src/app/lib/base.repo.ts`).
- **Two entry points, one engine.** `apps/backend/src/app/migrations/run-migrations.ts` holds the migrator and takes its DB config as an argument. `kyselyinit.ts` wraps it for the running server (`env.migrationDb`); `migrate-cli.ts` is the standalone deploy-time entry point and reads `DB_*` straight from `process.env`. The CLI must **never** import `env.ts`: that module runs `assertProductionSecrets()` on import, which demands `SHARED_SECRET`/`OAUTH_TOKEN_ENC_KEY`/`STRIPE_SECRET_KEY` — secrets a migration never uses. Wiring the CLI back through `env` means either shipping production secrets to CI or feeding the guard placeholders, and it is what broke the `migrate` job on its first real run (2026-07-28).
- **Dev:** applied automatically on backend startup — `apps/backend/src/main.ts` calls `migrateToLatest()` from `kyselyinit.ts` when `MIGRATE_ON_BOOT` is true (the default). Starting the backend brings the DB to latest.
- **Prod:** `MIGRATE_ON_BOOT=false` — startup does NOT migrate. The `migrate` job in `.github/workflows/deploy.yml` runs `migrate-cli.ts` (as the owner role, via the `PROD_DB_*` secrets) before the backend rolls to the new image; a migration failure blocks the deploy. Added after the 2026-07-23 outage, where code reading `authusers.campaign_id` deployed without its migration and every authenticated request 500'd while health probes stayed green. Manual fallback command: `deploy/GO-LIVE-CHECKLIST.md` §9.
- State is tracked in the Kysely-managed tables `kysely_migration` and `kysely_migration_lock`. Never write to these by hand — the sole exception is the reset step of a deliberate re-squash (see below).

### Data backfills on FORCE-RLS tables just work — but always test a fresh bootstrap

Most domain tables run `FORCE ROW LEVEL SECURITY` (the S-1 tenant backstop; grep `schema.sql` for it — persons, households, companies, tasks, and the `map_*` junctions all do). A migration runs with **no `app.tenant_id` GUC set**, but every `tenant_isolation` policy has the escape `NULLIF(current_setting('app.tenant_id', true), '') IS NULL OR …` in both `USING` and `WITH CHECK`, so an unset GUC makes the policy permit **every** row. A migration's `UPDATE`/`DELETE`/backfill therefore reaches all rows — **no per-migration RLS toggle is needed**, and you should not add one.

This only works because `0001_baseline.ts` **strips `SET row_security = off`** out of the pg*dump preamble (same line-filter that strips `search_path`). That dump setting would otherwise leak forward through Kysely's single-session `migrateToLatest()` run, and `row_security = off` + FORCE RLS makes Postgres **reject** even policy-permitted writes with `SQLSTATE 42501` / *"query would be affected by row-level security policy"\_ — rolling back the whole batch including the baseline, so no fresh DB (CI, new dev) can bootstrap. If you ever see that 42501 in a migration, the cause is a stray `row_security = off` in session scope, **not** a reason to disable FORCE RLS.

Always verify a new migration by running the whole batch against a **freshly provisioned** DB (`TEST_DB_NAME=pplcrm_x_test apps/backend/scripts/setup-test-db.sh`, then `migrateToLatest`) — an already-migrated `pplcrm_test` won't re-run your migration or a bootstrap. Pure DDL (`ADD COLUMN`, `CREATE INDEX`, `ADD CONSTRAINT`) is unaffected either way.

## Worked example — add a table

A dated migration is a small raw-SQL file. Model yours on this shape (real ones carry more columns/indexes and a `tenant_id` for multi-tenant scoping):

```ts
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE public.person_newsletter_engagements (
      tenant_id     bigint  NOT NULL,
      newsletter_id bigint  NOT NULL,
      email         text    NOT NULL,
      PRIMARY KEY (tenant_id, newsletter_id, email)
    )
  `.execute(db);
  await sql`CREATE INDEX idx_pne_tenant_email ON public.person_newsletter_engagements (tenant_id, email)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS public.person_newsletter_engagements`.execute(db);
}
```

For column additions, use idempotent `ADD COLUMN IF NOT EXISTS` / `DROP COLUMN IF EXISTS`. Note tables carry a `tenant_id` for multi-tenant scoping (see `pplcrm-tenant-safety`).

## After the migration: update the Kysely types by hand

There is **no `kysely-codegen`**. The `Models` interface is maintained manually in `libs/common/src/lib/kysely.models.ts`; its header comment states the rule: "When adding a new table … Add a model and add it to the interface Models." So a migration that adds/changes a table is not finished until you add/edit the corresponding model interface and register it in the `Models` map. Without this, Kysely queries against the new table won't type-check.

## The schema baseline (`schema.sql`)

`0001_baseline.ts` bootstraps a database by executing `schema.sql` (a `pg_dump --schema-only`). It does not re-run on a database that already recorded it.

**As of the 2026-07-26 re-squash, the baseline IS the current, complete schema and there are no dated migrations.** The 2026-07-07 squash collapsed the ~34 dated remediation migrations; 2026-07-10 folded the 17 that followed; 2026-07-26 folded the 29 after that (companion apps → email payload storage). Each time: fresh `pg_dump` taken with the PG18 client (`/opt/homebrew/opt/postgresql@18/bin/pg_dump`; the PATH default is a 17.6 client that refuses an 18 server), dated files deleted, `kysely_migration` reset on every existing DB (see "Re-squashing"). So on a fresh DB Kysely runs `0001_baseline` and nothing else, and `schema.sql` **does** reflect the current shape. (`libs/common/src/lib/kysely.models.ts` and a live `psql \d` are still the authoritative Kysely-side view.)

**The baseline also seeds rows** (`seedRows()` in `0001_baseline.ts`) — currently just the `ops_watchdog` row in `ops_heartbeats`, which the dead-man's-switch health probe needs and which a `--schema-only` dump cannot carry. When a re-squash folds a dated migration that INSERTed data, its seed moves into that function or a fresh DB comes up subtly broken.

### Fresh-database prerequisites — provisioning, run BEFORE the app first boots

The baseline assumes the S-2 least-privilege role split already exists. A brand-new database must be provisioned first or `0001_baseline` fails with one of these (both verified 2026-07-07):

- **`permission denied to create extension "pg_trgm"`** — the database is not owned by `pplcrm_owner`. Trusted extensions (`pg_trgm`, `pgcrypto`) need CREATE on the database, which the owner has.
- **`must be owner of schema public`** — schema `public` is not owned by `pplcrm_owner`, so the baseline's own `ALTER SCHEMA public OWNER TO pplcrm_owner` can't run.

Both are fixed by running `apps/backend/scripts/setup-db-roles.sql` **once as a superuser** (or the DB's current owner) before migrating — it creates the `pplcrm_owner`/`pplcrm_app` roles, transfers database + `public`-schema ownership to `pplcrm_owner`, and applies the grants. `setup.sh` runs it for a new dev machine. On Render (no superuser) create the two roles and transfer ownership via the primary role before the first deploy. The `0001_baseline` loader does **not** strip the `OWNER TO` / `ALTER SCHEMA` / `GRANT` lines — they rely on this provisioning being correct.

### Going forward — the normal flow resumes

New schema changes are new dated `YYYY-MM-DD-*.ts` files on top of the baseline, exactly as before. **Do NOT regenerate `schema.sql` for an ordinary change** — add a migration file. `schema.sql` is only re-dumped during a deliberate re-squash.

### Re-squashing (optional, pre-ship only)

When the dated-migration list grows unwieldy and there is no production data to preserve, collapse again. Order matters — step 4 before step 5, always:

0. **Confirm every DB is exactly at the tree** before dumping: `SELECT name FROM kysely_migration ORDER BY name` on dev, test, and prod, diffed against the `*.ts` filenames. If a DB is behind, bring it up first (`set -a; . ./.env.<env>; set +a; NODE_ENV=<env> npx tsx apps/backend/src/app/migrate-cli.ts` — the CLI needs only the `DB_*` vars, but sourcing the env file is the easiest way to get them). Squashing while prod is behind bakes a schema into the baseline that prod does not have, and no future migration will ever repair the gap.
1. `pg_dump --schema-only` a fully-migrated DB → overwrite `schema.sql`. Plain `--schema-only`; do **not** add `--no-privileges`, the loader relies on the `OWNER TO`/`GRANT` lines.
2. **Rescue any seeded rows.** `grep "INSERT INTO" apps/backend/src/app/_migrations/2026-*.ts` before deleting anything — a `--schema-only` dump drops them silently. Move each into `seedRows()` in `0001_baseline.ts`.
3. Delete the dated `*.ts` files (keep `0001_baseline.ts`).
4. **Verify a from-scratch build** — provision a throwaway DB (`TEST_DB_NAME=pplcrm_squash_test apps/backend/scripts/setup-test-db.sh`), migrate it, and confirm `migration up:"0001_baseline" successful` is the only line. Then diff its `pg_dump --schema-only` against the fully-migrated dev DB's: they must be **identical**. That diff, not the successful boot, is what proves the squash lossless.
5. Reset tracking so Kysely doesn't abort on the missing files: `DELETE FROM kysely_migration WHERE name <> '0001_baseline'` on **every** existing DB — dev, test, _and prod_ (`.env.production` carries the `pplcrm_owner` credentials; Azure Postgres needs `PGSSLMODE=require`).

**The prod window (the part that can break deploys):** prod runs `MIGRATE_ON_BOOT=false` and migrates only via the `migrate` job in `deploy.yml`, which aborts on _corrupt migrations_ when `kysely_migration` names a file that no longer exists. So the prod DELETE must land **after** the files leave the tree and **before** the squashed tree deploys. Between the DELETE and the push, a deploy of the _old_ tree would try to re-run every dated migration against a database that already has those objects and fail on `relation already exists`. Do the reset and the push back to back, and don't deploy in between.

Note the loader strips at run time: psql `\` meta-commands (`\restrict`/`\unrestrict`), the `search_path` `set_config` line, the PG17-only `transaction_timeout` SET, and any `kysely_migration`/`kysely_migration_lock` DDL — so a dump taken with a newer `pg_dump` client against an older server still loads.

## Non-goals

- **Kysely query/repository patterns, `Insertable`/`Updateable`, transactions, transactional outbox** → `pplcrm-trpc-backend`.
- **Zod schema triad (`AddXObj`/`UpdateXObj`/`XObj`)** that usually accompanies a new table → `pplcrm-schemas-validation`.
- **The full "add a new entity end-to-end" chain** (schema → migration → types → router → frontend) → `pplcrm-add-entity`; this skill owns only the migration + baseline step.
- **`tenant_id` scoping and the `no-unscoped-db-query` rule** → `pplcrm-tenant-safety`.
