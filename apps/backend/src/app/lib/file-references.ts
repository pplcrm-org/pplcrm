import type { Kysely } from 'kysely';

import { logger } from '../logger';
import type { StorageService } from './storage.service';
import type { Models } from '../../../../../libs/common/src/lib/kysely.models';

/**
 * "Is this `files` row still pointed at by anything?" — the single answer every deletion site
 * must ask before removing a `files` row and its stored blob.
 *
 * Why this has to be shared. Uploads are sha256-deduped in several places, so one `files` row
 * routinely serves more than one feature: an email attachment, a profile avatar, a person photo
 * and a newsletter image can all resolve to the same row. Before this module each deletion site
 * asked only about its own domain (or, in the Files page and avatar cases, asked nothing at all),
 * so deleting an email could destroy somebody's avatar and deleting a file from the Files page
 * could destroy a live email attachment.
 *
 * Two kinds of pointer exist, and they are NOT the same thing:
 *
 * 1. A foreign-key-shaped column on another table (the seven listed in FILE_REFERENCE_COLUMNS).
 *    Only two of those seven have an actual database foreign key; the other five would be left
 *    dangling by a delete, with nothing in Postgres objecting. That is precisely why the check
 *    has to live in application code.
 * 2. The `files.entity_type` / `files.entity_id` ownership tag, written by
 *    `FilesController.registerFile`. A newsletter image and a team logo are owned this way and
 *    have NO column anywhere pointing back at them, so a column-only check would happily delete
 *    them. Callers opt in with `includeEntityOwnership`.
 *
 * Keep FILE_REFERENCE_COLUMNS in step with the schema — `file-references.spec.ts` compares it
 * against the live database's `information_schema` and fails if a migration adds a column this
 * list does not know about.
 */

/** The root Kysely instance or an open transaction — both satisfy this. */
type DbHandle = Kysely<Models>;

export interface FileReferenceHit {
  /** Table holding the pointer. `files` itself for the entity-ownership tag. */
  readonly table: string;
  /** Column holding the pointer. */
  readonly column: string;
  /** Plain-English name of the holder, for a user-facing message. */
  readonly label: string;
}

export interface FileReferenceOptions {
  /**
   * Count a live `files.entity_type` / `entity_id` ownership tag as a reference.
   *
   * Automatic cleanup (the email hard-delete purge, avatar replacement) passes `true`: those
   * paths must never remove a row another feature owns.
   *
   * The Files page delete passes `false`, because that same endpoint is how an owning feature
   * removes its own attachment — the newsletter editor calls `files.delete` to detach and delete
   * a newsletter image (`newsletter-detail.ts` → `removeAttachment`). Counting the tag there
   * would make a newsletter image permanently undeletable.
   */
  readonly includeEntityOwnership: boolean;
}

interface ColumnReference {
  readonly table: string;
  readonly column: string;
  readonly label: string;
  readonly isReferenced: (db: DbHandle, tenantId: string, fileId: string) => Promise<boolean>;
}

/**
 * Every column in the schema that holds a `files.id`.
 *
 * Verified against the live schema on 2026-07-31: seven columns, of which only
 * `email_attachments.file_id` and `profiles.avatar_file_id` carry a real foreign key
 * (both `ON DELETE SET NULL`). The remaining five are plain bigints.
 */
export const FILE_REFERENCE_COLUMNS: readonly ColumnReference[] = [
  {
    table: 'email_attachments',
    column: 'file_id',
    label: 'an email attachment',
    isReferenced: async (db, tenantId, fileId) =>
      Boolean(
        await db
          .selectFrom('email_attachments')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('file_id', '=', fileId)
          .limit(1)
          .executeTakeFirst(),
      ),
  },
  {
    table: 'profiles',
    column: 'avatar_file_id',
    label: 'a profile photo',
    isReferenced: async (db, tenantId, fileId) =>
      Boolean(
        await db
          .selectFrom('profiles')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('avatar_file_id', '=', fileId)
          .limit(1)
          .executeTakeFirst(),
      ),
  },
  {
    table: 'bug_reports',
    column: 'screenshot_file_id',
    label: 'a bug report screenshot',
    isReferenced: async (db, tenantId, fileId) =>
      Boolean(
        await db
          .selectFrom('bug_reports')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('screenshot_file_id', '=', fileId)
          .limit(1)
          .executeTakeFirst(),
      ),
  },
  {
    table: 'companies',
    column: 'file_id',
    label: 'a company',
    isReferenced: async (db, tenantId, fileId) =>
      Boolean(
        await db
          .selectFrom('companies')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('file_id', '=', fileId)
          .limit(1)
          .executeTakeFirst(),
      ),
  },
  {
    table: 'households',
    column: 'file_id',
    label: 'a household',
    isReferenced: async (db, tenantId, fileId) =>
      Boolean(
        await db
          .selectFrom('households')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('file_id', '=', fileId)
          .limit(1)
          .executeTakeFirst(),
      ),
  },
  {
    table: 'persons',
    column: 'file_id',
    label: 'a person',
    isReferenced: async (db, tenantId, fileId) =>
      Boolean(
        await db
          .selectFrom('persons')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('file_id', '=', fileId)
          .limit(1)
          .executeTakeFirst(),
      ),
  },
  {
    table: 'tasks',
    column: 'file_id',
    label: 'a task',
    isReferenced: async (db, tenantId, fileId) =>
      Boolean(
        await db
          .selectFrom('tasks')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('file_id', '=', fileId)
          .limit(1)
          .executeTakeFirst(),
      ),
  },
];

/** Plain-English name for each `files.entity_type` tag written by registerFile. */
const ENTITY_OWNER_LABELS: Readonly<Record<string, string>> = {
  bug_report: 'a bug report',
  newsletter: 'a newsletter',
  team: 'a team',
};

/**
 * Does the record named by a `files.entity_type` / `entity_id` tag still exist?
 *
 * A tag left behind by a deleted newsletter must not make the file undeletable forever — that
 * would be storage the tenant can never reclaim. An unrecognised tag is treated as live, because
 * guessing wrong in that direction only leaks a blob, while guessing wrong the other way destroys
 * a file somebody is still using.
 */
async function entityOwnerExists(
  db: DbHandle,
  tenantId: string,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  switch (entityType) {
    case 'bug_report':
      return Boolean(
        await db
          .selectFrom('bug_reports')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', entityId)
          .executeTakeFirst(),
      );
    case 'newsletter':
      return Boolean(
        await db
          .selectFrom('newsletters')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', entityId)
          .executeTakeFirst(),
      );
    case 'team':
      return Boolean(
        await db
          .selectFrom('teams')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', '=', entityId)
          .executeTakeFirst(),
      );
    default:
      return true;
  }
}

/** The entity-ownership tag on the row itself, when it names a record that still exists. */
async function findEntityOwnerReference(
  db: DbHandle,
  tenantId: string,
  fileId: string,
): Promise<FileReferenceHit | null> {
  const row = await db
    .selectFrom('files')
    .select(['entity_type', 'entity_id'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', fileId)
    .executeTakeFirst();

  const entityType = row?.entity_type;
  if (entityType == null || entityType === '') return null;

  const hit: FileReferenceHit = {
    table: 'files',
    column: 'entity_type',
    label: ENTITY_OWNER_LABELS[entityType] ?? `a ${entityType}`,
  };

  // Tagged with a type but no id: nothing to look up, so keep the file.
  if (row?.entity_id == null) return hit;

  return (await entityOwnerExists(db, tenantId, entityType, String(row.entity_id))) ? hit : null;
}

/** Everything that currently points at this file. Empty means the row is safe to delete. */
export async function findFileReferences(
  db: DbHandle,
  tenantId: string,
  fileId: string,
  options: FileReferenceOptions,
): Promise<FileReferenceHit[]> {
  const hits: FileReferenceHit[] = [];

  for (const site of FILE_REFERENCE_COLUMNS) {
    if (await site.isReferenced(db, tenantId, fileId)) {
      hits.push({ table: site.table, column: site.column, label: site.label });
    }
  }

  if (options.includeEntityOwnership) {
    const owner = await findEntityOwnerReference(db, tenantId, fileId);
    if (owner) hits.push(owner);
  }

  return hits;
}

/** Same question as findFileReferences, but stops at the first pointer it finds. */
export async function isFileReferenced(
  db: DbHandle,
  tenantId: string,
  fileId: string,
  options: FileReferenceOptions,
): Promise<boolean> {
  for (const site of FILE_REFERENCE_COLUMNS) {
    if (await site.isReferenced(db, tenantId, fileId)) return true;
  }
  if (options.includeEntityOwnership) {
    return (await findEntityOwnerReference(db, tenantId, fileId)) != null;
  }
  return false;
}

/** "an email attachment and a profile photo" — for a user-facing refusal message. */
export function describeFileReferences(hits: readonly FileReferenceHit[]): string {
  const labels = [...new Set(hits.map((h) => h.label))];
  if (labels.length === 0) return 'another record';
  const last = labels.pop() ?? 'another record';
  return labels.length === 0 ? last : `${labels.join(', ')} and ${last}`;
}

/**
 * Delete the `files` row only if nothing points at it. Returns the storage key of the blob that
 * is now unreferenced, or null when the row was kept (or never existed).
 *
 * It deliberately does NOT touch blob storage. The caller deletes the blob only after the
 * surrounding transaction has committed — see the ordering note on purgeUnreferencedFiles.
 *
 * Pass an open transaction to get the check and the delete in one atomic step.
 */
export async function deleteFileRowIfUnreferenced(
  db: DbHandle,
  tenantId: string,
  fileId: string,
  options: FileReferenceOptions,
): Promise<string | null> {
  if (await isFileReferenced(db, tenantId, fileId, options)) return null;

  const file = await db
    .selectFrom('files')
    .select(['id', 'storage_key'])
    .where('tenant_id', '=', tenantId)
    .where('id', '=', fileId)
    .executeTakeFirst();
  if (!file) return null;

  await db.deleteFrom('files').where('tenant_id', '=', tenantId).where('id', '=', fileId).execute();

  return file.storage_key == null ? null : String(file.storage_key);
}

/**
 * Automatic cleanup after something that used files was deleted: drop each `files` row that
 * nothing points at any more, then drop its blob.
 *
 * Ordering, deliberately row-first-then-blob. The two failure modes are not equally bad:
 *
 * - Blob deleted, row delete then rolled back  → a row pointing at a blob that is gone. Every
 *   download of that file 404s. Harmful, and invisible until a user clicks.
 * - Row deleted and committed, blob delete then fails → a blob nothing references. Wasted bytes,
 *   nothing user-visible.
 *
 * So the row delete runs inside a transaction, and the blob delete runs only after that
 * transaction has committed, and its failure is logged rather than thrown. The worst case is a
 * storage leak.
 *
 * Residual race, accepted knowingly: between the reference check and the commit another request
 * could attach the same file to a new record. The window is one short transaction and the two
 * columns with a foreign key are `ON DELETE SET NULL`, so the loser sees an empty attachment
 * rather than a broken pointer. Closing it properly needs row locks on all eight write paths.
 */
export async function purgeUnreferencedFiles(
  db: Kysely<Models>,
  storage: Pick<StorageService, 'delete'>,
  tenantId: string,
  fileIds: readonly string[],
): Promise<void> {
  for (const fileId of fileIds) {
    let storageKey: string | null = null;

    try {
      storageKey = await db
        .transaction()
        .execute((trx) => deleteFileRowIfUnreferenced(trx, tenantId, fileId, { includeEntityOwnership: true }));
    } catch (err) {
      logger.error({ err }, `Failed to purge unreferenced file ${fileId}`);
      continue;
    }

    if (storageKey == null) continue;

    try {
      await storage.delete(storageKey);
    } catch (err) {
      logger.error({ err }, `Failed to delete storage blob ${storageKey} for file ${fileId}`);
    }
  }
}
