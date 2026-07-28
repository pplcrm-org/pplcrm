import crypto from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../../logger';
import {
  DEMO_ATTACHMENT_ASSETS,
  buildDemoAttachment,
  isDemoAttachmentKey,
} from '../../../modules/demo/demo-attachment-assets';
import { DEMO_MANIFEST_SETTINGS_KEY, DemoSeedManifestObj } from '../../../modules/demo/demo-seed';
import { StorageService } from '../../storage.service';
import type { JobPayloadOf } from '../job-payloads';

/**
 * Turn the demo inbox's metadata-only attachment rows into real downloadable files.
 *
 * Signup seeds `email_attachments` rows carrying `remote_ref = 'demo:<asset key>'` and a null
 * `file_id` — the same shape a deferred provider attachment has — and enqueues this job in the
 * same transaction (transactional outbox). Doing the uploads here rather than inline keeps blob
 * I/O out of the signup path: it cannot add latency to a signup, a storage outage cannot fail
 * one, and a rolled-back signup cannot strand blobs.
 *
 * Idempotent: rows that already have a `file_id` are skipped, so a retry after a partial run
 * finishes the remainder instead of duplicating blobs.
 */
export async function handleMaterializeDemoAttachments(
  payload: JobPayloadOf<'materialize_demo_attachments'>,
  db: Kysely<Models>,
): Promise<void> {
  const { tenant_id, user_id } = payload;

  const pending = await db
    .selectFrom('email_attachments')
    .select(['id', 'remote_ref'])
    .where('tenant_id', '=', tenant_id)
    .where('file_id', 'is', null)
    .where('remote_ref', 'like', 'demo:%')
    .execute();

  if (pending.length === 0) return;

  const storage = new StorageService();
  const newFileIds: string[] = [];
  // sha256 → files.id, so an asset used by two demo emails links one row and one blob — the
  // same dedupe the ingester does for real attachments.
  const fileIdByHash = new Map<string, string>();

  for (const row of pending) {
    const key = String(row.remote_ref).slice('demo:'.length);
    if (!isDemoAttachmentKey(key)) {
      // The asset was renamed or removed since this workspace was seeded. Leave the row as
      // metadata-only rather than inventing a payload for it.
      logger.warn({ tenant_id, key }, `Demo attachment asset "${key}" no longer exists; leaving it unmaterialized`);
      continue;
    }

    try {
      const asset = buildDemoAttachment(key);
      let fileId = fileIdByHash.get(asset.sha256_hex);

      if (fileId == null) {
        const existing = await db
          .selectFrom('files')
          .select('id')
          .where('tenant_id', '=', tenant_id)
          .where('sha256_hex', '=', asset.sha256_hex)
          .executeTakeFirst();

        if (existing) {
          fileId = String(existing.id);
        } else {
          // Hash, look up, THEN upload — uploading first and deduping after strands the second
          // blob, because the pre-existing row is linked and the new key is recorded nowhere.
          const storageKey = `emails/attachments/${crypto.randomUUID()}_${asset.filename}`;
          await storage.upload(storageKey, asset.bytes, asset.content_type);
          const inserted = await db
            .insertInto('files')
            .values({
              tenant_id,
              filename: asset.filename,
              mime_type: asset.content_type,
              size_bytes: asset.size_bytes,
              storage_key: storageKey,
              sha256_hex: asset.sha256_hex,
              uploaded_by: user_id,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          fileId = String(inserted.id);
          newFileIds.push(fileId);
        }
        fileIdByHash.set(asset.sha256_hex, fileId);
      }

      await db
        .updateTable('email_attachments')
        .set({ file_id: fileId, updated_at: new Date() })
        .where('tenant_id', '=', tenant_id)
        .where('id', '=', String(row.id))
        .execute();
    } catch (err) {
      // One bad asset must not abandon the rest; the row simply stays metadata-only.
      logger.error({ err, tenant_id, key }, 'Failed to materialize a demo attachment');
    }
  }

  if (newFileIds.length > 0) {
    await recordFilesInManifest(db, tenant_id, newFileIds);
  }
}

/**
 * Add the newly created `files` ids to the demo seed manifest.
 *
 * Without this, exit-demo would delete the emails (cascading the attachment rows) and leave the
 * `files` rows and their blobs behind forever — `files` is not reached by that cascade. The
 * manifest is the only record of what exit-demo is allowed to delete.
 */
async function recordFilesInManifest(db: Kysely<Models>, tenant_id: string, fileIds: string[]): Promise<void> {
  // Deliberately NOT wrapped in its own transaction: the worker may already be running this
  // handler inside one, and Kysely rejects a nested `transaction()`. The read-modify-write is
  // safe without it because this job is the only writer of `files`, and the one racing writer
  // that matters — exit-demo deleting the row — is caught by the affected-row check below.
  const row = await db
    .selectFrom('settings')
    .select('value')
    .where('tenant_id', '=', tenant_id)
    .where('key', '=', DEMO_MANIFEST_SETTINGS_KEY)
    .executeTakeFirst();

  // Already exited demo mode before the job ran — the emails are gone, so these files are
  // orphans. Delete them rather than leaving them unreferenced forever.
  if (!row) {
    await purgeUntrackedFiles(db, tenant_id, fileIds);
    return;
  }

  const raw: unknown = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
  const parsed = DemoSeedManifestObj.safeParse(raw);
  if (!parsed.success) {
    logger.error({ tenant_id }, 'Demo manifest is unreadable; demo attachment files will not be tracked');
    return;
  }

  const merged = { ...parsed.data, files: [...new Set([...parsed.data.files, ...fileIds])] };
  const result = await db
    .updateTable('settings')
    .set({ value: JSON.stringify(merged), updated_at: new Date() })
    .where('tenant_id', '=', tenant_id)
    .where('key', '=', DEMO_MANIFEST_SETTINGS_KEY)
    .executeTakeFirst();

  // The manifest disappeared between the read and the write — exit-demo won the race, and it
  // deleted a manifest that did not yet list these files. Clean them up ourselves.
  if ((result.numUpdatedRows ?? 0n) === 0n) {
    await purgeUntrackedFiles(db, tenant_id, fileIds);
  }
}

/** Best-effort cleanup for files whose demo workspace disappeared mid-job. */
async function purgeUntrackedFiles(db: Kysely<Models>, tenant_id: string, fileIds: string[]): Promise<void> {
  const storage = new StorageService();
  for (const fileId of fileIds) {
    try {
      const file = await db
        .selectFrom('files')
        .select('storage_key')
        .where('tenant_id', '=', tenant_id)
        .where('id', '=', fileId)
        .executeTakeFirst();
      await db.deleteFrom('files').where('tenant_id', '=', tenant_id).where('id', '=', fileId).execute();
      if (file?.storage_key) await storage.delete(file.storage_key);
    } catch (err) {
      logger.error({ err, tenant_id, fileId }, 'Failed to purge an orphaned demo attachment file');
    }
  }
}

/** Exposed so a spec can assert the job covers every asset the datasets reference. */
export const DEMO_ATTACHMENT_ASSET_KEYS = Object.keys(DEMO_ATTACHMENT_ASSETS);
