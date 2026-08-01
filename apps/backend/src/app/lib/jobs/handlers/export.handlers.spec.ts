import type { Readable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../../base.repo';
import { StorageService } from '../../storage.service';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import { handleExportCsv } from './export.handlers';

/**
 * The export job used to run `selectFrom(table).selectAll()` and let `csv-stream.ts` derive the
 * CSV header from the first row's keys. Combined with `EXPORT_ENTITY_TABLE.users -> authusers`
 * and a `queue` procedure open to every signed-in member, that wrote the whole `authusers` table
 * — argon2id password hashes, password-reset code hashes, live two-factor code hashes, previous
 * email addresses and previous roles — into a CSV in blob storage.
 *
 * These tests assert on the bytes that actually reach storage, because that is the artifact that
 * leaks. Asserting on the query builder would pass against a version that reads the columns and
 * merely omits them from the header.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
const db = (BaseRepository as any)._db;
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

// Distinctive values so a leak is unambiguous in the CSV text rather than a column-name match.
const PASSWORD_HASH = 'argon2id$LEAKED-PASSWORD-HASH';
const RESET_CODE_HASH = 'LEAKED-RESET-CODE-HASH';
const TWO_FACTOR_HASH = 'LEAKED-TWO-FACTOR-HASH';
const PREVIOUS_EMAIL = 'leaked-previous@example.com';

describe('handleExportCsv column allow-list', () => {
  let tenantId: string;
  let userId: string;
  let exportId: string;
  let uploaded: string;

  async function seedExportRow(columns: string[] | null): Promise<string> {
    const row = await db
      .insertInto('data_exports')
      .values({
        tenant_id: tenantId,
        user_id: userId,
        entity: 'users',
        file_name: 'users-export.csv',
        status: 'pending',
        columns: columns ? JSON.stringify(columns) : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  }

  /** Runs the job for the `users` entity and returns the CSV text handed to blob storage. */
  async function runUsersExport(columns: string[] | null): Promise<string> {
    exportId = await seedExportRow(columns);
    await handleExportCsv(
      {
        type: 'export_csv',
        export_id: exportId,
        tenant_id: tenantId,
        user_id: userId,
        entity: 'users',
        table: 'authusers',
        options: {},
        columns,
        file_name: 'users-export.csv',
      },
      db,
    );
    return uploaded;
  }

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    uploaded = '';

    // Capture what the job streams to storage instead of talking to Azure.
    vi.spyOn(StorageService.prototype, 'uploadStream').mockImplementation(
      async (_key: string, stream: Readable): Promise<void> => {
        const chunks: string[] = [];
        for await (const chunk of stream) chunks.push(String(chunk));
        uploaded = chunks.join('');
      },
    );
    vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);
    vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined);

    await db.insertInto('tenants').values({ id: tenantId, name: 'Export Allow-list Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `member-${userId}@example.com`,
        first_name: 'Member',
        last_name: 'Person',
        verified: true,
        role: 'user',
        password: PASSWORD_HASH,
        password_reset_code: RESET_CODE_HASH,
        two_factor_code: TWO_FACTOR_HASH,
        two_factor_expires_at: new Date(Date.now() + 5 * 60 * 1000),
        previous_email: PREVIOUS_EMAIL,
        previous_role: 'owner',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('data_exports').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('omits credentials when no column list is given', async () => {
    const csv = await runUsersExport(null);

    // The export still works and still carries the roster.
    expect(csv).toContain(`member-${userId}@example.com`);

    const header = csv.split('\n')[0]?.split(',') ?? [];
    expect(header).not.toContain('password');
    expect(header).not.toContain('password_reset_code');
    expect(header).not.toContain('two_factor_code');
    expect(header).not.toContain('previous_email');
    expect(header).not.toContain('previous_role');

    expect(csv).not.toContain(PASSWORD_HASH);
    expect(csv).not.toContain(RESET_CODE_HASH);
    expect(csv).not.toContain(TWO_FACTOR_HASH);
    expect(csv).not.toContain(PREVIOUS_EMAIL);
  });

  it('omits credentials the caller names explicitly', async () => {
    const csv = await runUsersExport(['email', 'password', 'password_reset_code', 'two_factor_code']);

    expect(csv).toContain(`member-${userId}@example.com`);
    expect(csv.split('\n')[0]).toBe('email');

    expect(csv).not.toContain(PASSWORD_HASH);
    expect(csv).not.toContain(RESET_CODE_HASH);
    expect(csv).not.toContain(TWO_FACTOR_HASH);
  });

  it('falls back to the whole allow-list when every requested column is disallowed', async () => {
    const csv = await runUsersExport(['password', 'two_factor_code']);

    expect(csv).toContain(`member-${userId}@example.com`);
    expect(csv).not.toContain(PASSWORD_HASH);
    expect(csv).not.toContain(TWO_FACTOR_HASH);
  });

  it('records the export as completed rather than failing on a disallowed column', async () => {
    await runUsersExport(['email', 'password']);

    const record = await db
      .selectFrom('data_exports')
      .select(['status', 'error'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', exportId)
      .executeTakeFirstOrThrow();

    // Dropping (not rejecting) is deliberate: the Exports page renders a failure as a bare red
    // "Failed" badge with no reason, and the shipped People grid legitimately asks for display-only
    // columns ("name", "address") that are not columns of `persons`.
    expect(record.status).toBe('completed');
    expect(record.error).toBeNull();
  });
});
