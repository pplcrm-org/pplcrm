import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../../base.repo';
import { StorageService } from '../../storage.service';
import { TransactionalEmailService } from '../../mail/transactional-mail.service';
import { DB_TEST_LOCKS, useExclusiveDbLock } from '../../test-utils/exclusive-db-lock';
import { handleRunYearEndStatements } from './receipts.handlers';

// Generates statement rows with committed transactions on the shared Postgres.
useExclusiveDbLock(DB_TEST_LOCKS.RECEIPT_COUNTERS);

const rand = () => String(Math.floor(Math.random() * 100000000) + 1000000);
const YEAR = new Date().getFullYear() - 1;

describe('year-end statement batch', () => {
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let personWithEmail: string;
  let personWithoutEmail: string;
  let runId: string;

  beforeEach(async () => {
    // Statement PDFs and donor emails are not the subject here — the batch bookkeeping is.
    vi.spyOn(StorageService.prototype, 'upload').mockResolvedValue(undefined as never);
    vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined as never);

    tenantId = rand();
    userId = rand();
    campaignId = rand();
    personWithEmail = rand();
    personWithoutEmail = rand();

    await db.insertInto('tenants').values({ id: tenantId, name: 'Statement Batch Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `run-${userId}@example.com`,
        password: 'password',
        first_name: 'Admin',
        last_name: 'Runner',
        verified: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('campaigns')
      .values({
        id: campaignId,
        tenant_id: tenantId,
        admin_id: userId,
        name: 'Office',
        kind: 'office',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    const householdId = rand();
    await db
      .insertInto('households')
      .values({
        id: householdId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        city: 'Ottawa',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    for (const [personId, email] of [
      [personWithEmail, 'donor@example.com'],
      [personWithoutEmail, null],
    ] as const) {
      await db
        .insertInto('persons')
        .values({
          id: personId,
          tenant_id: tenantId,
          campaign_id: campaignId,
          household_id: householdId,
          first_name: 'Donor',
          last_name: personId,
          email,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
      await db
        .insertInto('donations')
        .values({
          tenant_id: tenantId,
          campaign_id: campaignId,
          person_id: personId,
          amount: 5000,
          status: 'succeeded',
          method: 'cash',
          created_at: new Date(YEAR, 5, 15),
        })
        .execute();
    }
    await db
      .insertInto('settings')
      .values({
        tenant_id: tenantId,
        key: 'receipts.regime',
        value: JSON.stringify('cra_charity'),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    const run = await db
      .insertInto('receipt_statement_runs')
      .values({
        tenant_id: tenantId,
        year: YEAR,
        status: 'running',
        donors_total: 2,
        requested_by: userId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    runId = String(run.id);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
    for (const table of [
      'background_jobs',
      'notifications',
      'donation_receipt_items',
      'donation_receipts',
      'receipt_statement_runs',
      'files',
      'donations',
      'settings',
      'persons',
      'households',
      'campaigns',
      'authusers',
    ]) {
      await db.deleteFrom(table).where('tenant_id', '=', tenantId).execute();
    }
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('generates one statement per donor, emails where possible, counts the print pile, completes', async () => {
    await handleRunYearEndStatements(
      { type: 'run-year-end-statements', tenant_id: tenantId, run_id: runId, user_id: userId, year: YEAR },
      db,
    );

    const run = await db
      .selectFrom('receipt_statement_runs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', runId)
      .executeTakeFirstOrThrow();
    expect(run.status).toBe('completed');
    expect(run.generated_count).toBe(2);
    expect(run.emailed_count).toBe(1);
    expect(run.skipped_no_email).toBe(1);
    expect(run.failed_count).toBe(0);

    const statements = await db
      .selectFrom('donation_receipts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('kind', '=', 'statement')
      .execute();
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement.serial).toBeNull();
      expect(statement.file_id).not.toBeNull(); // PDF stored even for the print-and-mail donor
    }

    // A rerun finds no donor lacking a live statement and changes nothing.
    const rerun = await db
      .insertInto('receipt_statement_runs')
      .values({
        tenant_id: tenantId,
        year: YEAR,
        status: 'running',
        donors_total: 2,
        requested_by: userId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await handleRunYearEndStatements(
      { type: 'run-year-end-statements', tenant_id: tenantId, run_id: String(rerun.id), user_id: userId, year: YEAR },
      db,
    );
    const after = await db
      .selectFrom('donation_receipts')
      .select(({ fn }) => [fn.countAll<string | number>().as('total')])
      .where('tenant_id', '=', tenantId)
      .where('kind', '=', 'statement')
      .executeTakeFirstOrThrow();
    expect(Number(after.total)).toBe(2);
  });

  it('fails the run visibly when sending is paused instead of stalling', async () => {
    await db.updateTable('tenants').set({ sending_paused_at: new Date() }).where('id', '=', tenantId).execute();
    await handleRunYearEndStatements(
      { type: 'run-year-end-statements', tenant_id: tenantId, run_id: runId, user_id: userId, year: YEAR },
      db,
    );
    const run = await db
      .selectFrom('receipt_statement_runs')
      .select(['status', 'error'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', runId)
      .executeTakeFirstOrThrow();
    expect(run.status).toBe('failed');
    expect(run.error).toContain('paused');
  });
});
