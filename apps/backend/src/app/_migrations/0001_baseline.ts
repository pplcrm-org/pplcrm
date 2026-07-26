// tsco: ignore
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function up(db: Kysely<any>): Promise<void> {
  // Read the schema.sql baseline dump from the same directory
  const schemaPath = path.join(__dirname, 'schema.sql');
  const rawSql = fs.readFileSync(schemaPath, 'utf8');

  // Strip psql meta-commands (\restrict etc.) and PG17-only SET params that
  // don't exist on older servers (transaction_timeout added in PG17).
  const pg17OnlyParams = new Set(['transaction_timeout']);

  // Kysely's migrator creates and manages its own bookkeeping tables
  // (kysely_migration / kysely_migration_lock) before any migration runs.
  // pg_dump captures those tables into the schema dump, so executing them
  // here would collide ("relation already exists"). Skip any DDL block that
  // targets them. A block starts at a CREATE/ALTER TABLE referencing the
  // table and continues until the statement-terminating ';'.
  const kyselyBlockStart = /^(CREATE TABLE|ALTER TABLE(\s+ONLY)?)\s+(public\.)?kysely_migration(_lock)?\b/i;
  let skippingKyselyBlock = false;

  const schemaSql = rawSql
    .split('\n')
    .filter((line) => {
      const t = line.trimStart();
      if (t.startsWith('\\')) return false;
      // pg_dump empties the session search_path; if left in, every subsequent
      // unqualified statement on this connection (including Kysely's own INSERT
      // into kysely_migration) fails with "relation does not exist".
      if (/^SELECT\s+pg_catalog\.set_config\(\s*'search_path'/i.test(t)) return false;
      // pg_dump's `SET row_security = off` leaks forward through Kysely's single
      // migration session. Combined with a table's FORCE ROW LEVEL SECURITY it
      // makes Postgres REJECT even policy-permitted writes (SQLSTATE 42501)
      // instead of applying the policy — so any later migration that backfills
      // data on an RLS table rolls the whole batch back, and no fresh database
      // (CI, new dev) can bootstrap. Drop it: the default `row_security = on`
      // lets the tenant policy apply, and with no `app.tenant_id` GUC set the
      // policy's `NULLIF(...) IS NULL` escape permits every row, so migration
      // backfills work without per-migration RLS toggles.
      if (/^SET\s+row_security\b/i.test(t)) return false;
      const setMatch = t.match(/^SET\s+(\w+)\s*=/i);
      if (setMatch && setMatch[1] && pg17OnlyParams.has(setMatch[1].toLowerCase())) return false;

      if (skippingKyselyBlock) {
        // Drop lines until we reach the end of the current statement.
        if (t.endsWith(';')) skippingKyselyBlock = false;
        return false;
      }
      if (kyselyBlockStart.test(t)) {
        // Single-line statement ends immediately; otherwise keep skipping.
        skippingKyselyBlock = !t.endsWith(';');
        return false;
      }
      return true;
    })
    .join('\n');

  await sql.raw(schemaSql).execute(db);

  await seedRows(db);
}

/**
 * Rows the baseline must create that a `pg_dump --schema-only` cannot carry.
 *
 * Everything else in this repo seeds at runtime (system lists via
 * `ensureSystemLists()`, demo data via the demo-mode job), so this stays tiny —
 * add here ONLY when a fresh database is broken without the row. When a
 * re-squash folds a dated migration that seeded data, its INSERT moves here.
 */
async function seedRows(db: Kysely<any>): Promise<void> {
  // The ops_watchdog dead-man's-switch row (observability). Seeded at bootstrap
  // deliberately: if the background worker never completes a watchdog cycle
  // after deploy, this row is already stale and `GET /healthz/worker` reports
  // 503 — the correct failure direction. Without it the endpoint has no row to
  // judge and a wedged worker looks healthy.
  await sql`INSERT INTO public.ops_heartbeats (name) VALUES ('ops_watchdog') ON CONFLICT (name) DO NOTHING`.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // A squashed baseline migration generally shouldn't be rolled back,
  // as dropping the entire public schema is highly destructive.
  // We throw an error here to prevent accidental database wiping.
  throw new Error('This is a baseline migration and cannot be safely rolled back.');
}
