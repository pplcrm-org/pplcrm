import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncInboxPurgeSchedule } from '../../../modules/billing/inbox-purge';
import { BaseRepository } from '../../base.repo';
import { StorageService } from '../../storage.service';
import { handlePurgeDowngradedInboxes } from './inbox-purge.handlers';

/**
 * The nightly `purge_downgraded_inboxes` cron permanently destroys a workspace's synced mail 30
 * days after it drops to a plan without the shared inbox. Nothing it deletes can be restored — a
 * fresh mailbox connection only backfills the initial-sync window — so the invariants pinned here
 * are the ones whose failure would silently delete a paying customer's mailbox:
 *
 *  - a workspace that still has the inbox feature is never purged, whatever its schedule column says
 *  - a workspace that regained the plan before the sweep ran is never purged
 *  - a workspace still inside the 30-day window is never purged
 *  - a purge that stops mid-way (plan changed while it ran) does not also drop the mailbox
 *    connection or clear the deadline
 *  - purging one workspace never reaches into another one's mail
 *
 * Why this spec writes to the database directly instead of `useTestTransaction()`: the code under
 * test opens its own Kysely transaction per chunk (`EmailIngesterService.purgeAllTenantEmails`),
 * and Kysely refuses `transaction()` on an already-open `Transaction` ("calling the transaction
 * method for a Transaction is not supported"). The cron swallows per-tenant errors, so passing a
 * test transaction in would make every purge silently do nothing and every assertion here lie.
 * The suite runs against the disposable `pplcrm_test` database (see src/test-setup/global-setup.ts)
 * and each test cleans up the tenants it created.
 */

// The cron re-queues itself in a `finally`, which would leave a pending row in the shared
// background_jobs queue. The rescheduling is not what this spec is about.
vi.mock('../reschedule', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../reschedule')>();
  return { ...actual, scheduleNextRun: vi.fn().mockResolvedValue(undefined) };
});

const db = BaseRepository.dbInstance;

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number): Date => new Date(Date.now() + days * DAY_MS);

/** `emails.folder_id` is constrained to a fixed set of ids; 11 is the inbox. */
const INBOX_FOLDER = '11';

interface WorkspaceOptions {
  readonly plan: string;
  readonly purgeScheduledAt: Date | null;
  readonly demo?: boolean;
  readonly emailCount?: number;
}

interface Workspace {
  readonly tenantId: string;
  readonly userId: string;
  readonly campaignId: string;
  readonly emailIds: string[];
  readonly fileIds: string[];
  readonly bodyKeys: string[];
}

const createdTenantIds: string[] = [];

/**
 * A workspace with everything the purge is supposed to take with it: synced emails, a stored body
 * blob per email, an attachment pointing at a `files` row, a read state, an inbox draft, and both
 * mailbox OAuth grants.
 */
async function seedWorkspace(options: WorkspaceOptions): Promise<Workspace> {
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  createdTenantIds.push(tenantId);

  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      name: `Inbox Purge Tenant ${tenantId}`,
      subscription_plan: options.plan,
      demo_mode_at: options.demo ? new Date() : null,
      inbox_purge_scheduled_at: options.purgeScheduledAt,
    })
    .execute();

  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `member-${userId}@example.com`,
      password: 'not-a-real-hash',
      first_name: 'Inbox',
      last_name: 'Member',
      verified: true,
      role: 'user',
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
      name: `Inbox Purge Campaign ${campaignId}`,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  const emailIds: string[] = [];
  const fileIds: string[] = [];
  const bodyKeys: string[] = [];

  for (let i = 0; i < (options.emailCount ?? 1); i++) {
    const created = await db
      .insertInto('emails')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: INBOX_FOLDER,
        from_email: 'voter@example.com',
        to_email: `member-${userId}@example.com`,
        subject: `Synced message ${i}`,
        preview: `google:${rand()}`,
        status: 'open',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const emailId = String(created.id);
    emailIds.push(emailId);

    const bodyKey = `emails/bodies/${rand()}.html`;
    bodyKeys.push(bodyKey);
    await db
      .insertInto('email_bodies')
      .values({
        tenant_id: tenantId,
        email_id: emailId,
        body_html: null,
        storage_key: bodyKey,
        body_text: 'hello there',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const file = await db
      .insertInto('files')
      .values({
        tenant_id: tenantId,
        filename: `attachment-${rand()}.pdf`,
        mime_type: 'application/pdf',
        size_bytes: 1234,
        storage_key: `emails/attachments/${rand()}.pdf`,
        uploaded_by: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const fileId = String(file.id);
    fileIds.push(fileId);

    await db
      .insertInto('email_attachments')
      .values({
        tenant_id: tenantId,
        email_id: emailId,
        filename: `attachment-${rand()}.pdf`,
        content_type: 'application/pdf',
        size_bytes: 1234,
        file_id: fileId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await db
      .insertInto('email_read_states')
      .values({ tenant_id: tenantId, user_id: userId, email_id: emailId, is_read: true })
      .execute();
  }

  await db
    .insertInto('email_drafts')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      user_id: userId,
      subject: 'Half-written reply',
      body_html: '<p>later</p>',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  await db
    .insertInto('google_oauth_tokens')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: daysFromNow(1),
      google_email: `mailbox-${tenantId}@example.com`,
    })
    .execute();

  await db
    .insertInto('ms_oauth_tokens')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: daysFromNow(1),
      ms_email: `mailbox-${tenantId}@example.com`,
    })
    .execute();

  return { tenantId, userId, campaignId, emailIds, fileIds, bodyKeys };
}

async function countRows(
  table: 'emails' | 'email_bodies' | 'email_attachments' | 'email_drafts',
  tenantId: string,
): Promise<number> {
  const rows = await db.selectFrom(table).select('id').where('tenant_id', '=', tenantId).execute();
  return rows.length;
}

async function countTokens(tenantId: string): Promise<number> {
  const google = await db.selectFrom('google_oauth_tokens').select('id').where('tenant_id', '=', tenantId).execute();
  const ms = await db.selectFrom('ms_oauth_tokens').select('id').where('tenant_id', '=', tenantId).execute();
  return google.length + ms.length;
}

async function countFiles(tenantId: string): Promise<number> {
  const rows = await db.selectFrom('files').select('id').where('tenant_id', '=', tenantId).execute();
  return rows.length;
}

async function scheduleColumn(tenantId: string): Promise<Date | null | undefined> {
  const row = await db
    .selectFrom('tenants')
    .select('inbox_purge_scheduled_at')
    .where('id', '=', tenantId)
    .executeTakeFirst();
  return row?.inbox_purge_scheduled_at;
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await db.deleteFrom('email_read_states').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('email_attachments').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('email_bodies').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('email_drafts').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('emails').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('files').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('google_oauth_tokens').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('ms_oauth_tokens').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('purge_downgraded_inboxes cron', () => {
  let storageDeleteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createdTenantIds.length = 0;
    storageDeleteSpy = vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const tenantId of createdTenantIds) {
      await cleanupTenant(tenantId);
    }
    createdTenantIds.length = 0;
  });

  it('destroys the mail, bodies, attachments, drafts and mailbox grants of a Free tenant past the deadline', async () => {
    const ws = await seedWorkspace({ plan: 'free', purgeScheduledAt: daysFromNow(-1), emailCount: 2 });

    await handlePurgeDowngradedInboxes(db);

    expect(await countRows('emails', ws.tenantId)).toBe(0);
    expect(await countRows('email_bodies', ws.tenantId)).toBe(0);
    expect(await countRows('email_attachments', ws.tenantId)).toBe(0);
    expect(await countRows('email_drafts', ws.tenantId)).toBe(0);
    expect(await countFiles(ws.tenantId)).toBe(0);
    expect(await countTokens(ws.tenantId)).toBe(0);
    expect(await scheduleColumn(ws.tenantId)).toBeNull();
    for (const key of ws.bodyKeys) {
      expect(storageDeleteSpy).toHaveBeenCalledWith(key);
    }
  });

  it('never purges a tenant whose plan still includes the inbox, even with a deadline in the past', async () => {
    const ws = await seedWorkspace({ plan: 'grassroots', purgeScheduledAt: daysFromNow(-90), emailCount: 3 });

    await handlePurgeDowngradedInboxes(db);

    expect(await countRows('emails', ws.tenantId)).toBe(3);
    expect(await countRows('email_bodies', ws.tenantId)).toBe(3);
    expect(await countRows('email_attachments', ws.tenantId)).toBe(3);
    expect(await countRows('email_drafts', ws.tenantId)).toBe(1);
    expect(await countTokens(ws.tenantId)).toBe(2);
    expect(storageDeleteSpy).not.toHaveBeenCalled();
    // The stale deadline is cleared so the tenant stops showing up in the due scan.
    expect(await scheduleColumn(ws.tenantId)).toBeNull();
  });

  it('spares a tenant that re-upgraded before the sweep ran', async () => {
    const ws = await seedWorkspace({ plan: 'free', purgeScheduledAt: daysFromNow(-2), emailCount: 2 });

    // The real re-upgrade path: the plan write is followed by syncInboxPurgeSchedule, which
    // clears the deadline.
    await db.updateTable('tenants').set({ subscription_plan: 'movement' }).where('id', '=', ws.tenantId).execute();
    await syncInboxPurgeSchedule(db, ws.tenantId);

    await handlePurgeDowngradedInboxes(db);

    expect(await countRows('emails', ws.tenantId)).toBe(2);
    expect(await countTokens(ws.tenantId)).toBe(2);
    expect(await scheduleColumn(ws.tenantId)).toBeNull();
  });

  it('does not purge a downgraded tenant that is still inside the grace window', async () => {
    const deadline = daysFromNow(5);
    const ws = await seedWorkspace({ plan: 'free', purgeScheduledAt: deadline, emailCount: 2 });

    await handlePurgeDowngradedInboxes(db);

    expect(await countRows('emails', ws.tenantId)).toBe(2);
    expect(await countRows('email_bodies', ws.tenantId)).toBe(2);
    expect(await countRows('email_drafts', ws.tenantId)).toBe(1);
    expect(await countTokens(ws.tenantId)).toBe(2);
    // Deadline untouched — the purge is still coming, just not yet.
    expect(await scheduleColumn(ws.tenantId)).toEqual(deadline);
  });

  it('never purges a Free tenant that has no deadline set at all', async () => {
    const ws = await seedWorkspace({ plan: 'free', purgeScheduledAt: null, emailCount: 2 });

    await handlePurgeDowngradedInboxes(db);

    expect(await countRows('emails', ws.tenantId)).toBe(2);
    expect(await countTokens(ws.tenantId)).toBe(2);
    expect(await scheduleColumn(ws.tenantId)).toBeNull();
  });

  it('never purges a demo workspace, and clears its deadline', async () => {
    const ws = await seedWorkspace({ plan: 'free', purgeScheduledAt: daysFromNow(-10), demo: true, emailCount: 2 });

    await handlePurgeDowngradedInboxes(db);

    expect(await countRows('emails', ws.tenantId)).toBe(2);
    expect(await countTokens(ws.tenantId)).toBe(2);
    expect(await scheduleColumn(ws.tenantId)).toBeNull();
  });

  it('purging one workspace leaves another workspace untouched', async () => {
    const doomed = await seedWorkspace({ plan: 'free', purgeScheduledAt: daysFromNow(-1), emailCount: 2 });
    const neighbour = await seedWorkspace({ plan: 'grassroots', purgeScheduledAt: null, emailCount: 3 });

    await handlePurgeDowngradedInboxes(db);

    expect(await countRows('emails', doomed.tenantId)).toBe(0);

    expect(await countRows('emails', neighbour.tenantId)).toBe(3);
    expect(await countRows('email_bodies', neighbour.tenantId)).toBe(3);
    expect(await countRows('email_attachments', neighbour.tenantId)).toBe(3);
    expect(await countRows('email_drafts', neighbour.tenantId)).toBe(1);
    expect(await countFiles(neighbour.tenantId)).toBe(3);
    expect(await countTokens(neighbour.tenantId)).toBe(2);
    for (const key of neighbour.bodyKeys) {
      expect(storageDeleteSpy).not.toHaveBeenCalledWith(key);
    }
  });

  it('keeps the mailbox connection and the deadline when an upgrade lands mid-purge', async () => {
    const ws = await seedWorkspace({ plan: 'free', purgeScheduledAt: daysFromNow(-1), emailCount: 2 });

    // Simulate an upgrade landing while the purge is already running: the plan flips during the
    // first chunk's blob cleanup, so the next chunk's re-check finds the tenant no longer due.
    // The caller must then treat the run as a skip, not as a finished purge. `delete` returns an
    // awaited promise, so an async implementation is correct here.
    storageDeleteSpy.mockImplementation(async (): Promise<void> => {
      await db.updateTable('tenants').set({ subscription_plan: 'grassroots' }).where('id', '=', ws.tenantId).execute();
    });

    await handlePurgeDowngradedInboxes(db);

    // The first chunk was already deleted before the plan changed — that part is unrecoverable
    // either way, and asserting it here proves the purge really ran rather than being skipped
    // outright, which would make the assertions below vacuous.
    expect(await countRows('emails', ws.tenantId)).toBe(0);
    // Everything the "stopped early" branch must leave alone.
    expect(await countTokens(ws.tenantId)).toBe(2);
    expect(await countRows('email_drafts', ws.tenantId)).toBe(1);
    expect(await scheduleColumn(ws.tenantId)).not.toBeNull();
  });
});
