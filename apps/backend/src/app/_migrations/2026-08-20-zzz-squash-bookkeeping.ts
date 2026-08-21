import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Bookkeeping for the 2026-08-20 re-squash — this file is PERMANENT and must never be deleted.
 *
 * The re-squash folds every dated migration up to and including 2026-08-20-x-integrity-and-
 * hot-path-indexes (and 2026-08-20-workflow-add-to-list-step) into `schema.sql`, then deletes
 * the dated files. Kysely aborts with "corrupt migrations" whenever `kysely_migration` records a
 * name with no matching file, so every existing database's ledger has to shed the folded names
 * BEFORE the squashed tree reaches it. Doing that as a migration means the reset travels through
 * the exact same pipeline as any schema change (deploy.yml's migrate job for prod, MIGRATE_ON_BOOT
 * for dev, the Vitest global-setup for the test DB) — no hand-run SQL against production.
 *
 * Sequencing (why this is safe in every state):
 * - This file sorts LAST among the 2026-08-20 files, so a database catching up runs all real
 *   migrations first, then drops their ledger rows. The schema they built stays, obviously —
 *   only the bookkeeping rows go.
 * - On the tree that still carries the dated files, the ledger after this runs says
 *   [0001_baseline, this] — both files exist, so nothing is corrupt.
 * - On the squashed tree, the folder holds exactly 0001_baseline and this file, matching that
 *   same ledger. A fresh database runs the (post-squash) baseline, then this as a no-op.
 * - Deleting THIS file later would recreate the exact corruption it exists to prevent: every
 *   database that ever ran it records its name. It stays.
 *
 * `NOT IN` keeps its own row-to-be and the baseline; everything else in the ledger is, by
 * construction of the squash, a name whose file is leaving the tree.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    DELETE FROM kysely_migration
    WHERE name NOT IN ('0001_baseline', '2026-08-20-zzz-squash-bookkeeping')
  `.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Irreversible by design: the deleted rows named migration files that no longer exist.
}
