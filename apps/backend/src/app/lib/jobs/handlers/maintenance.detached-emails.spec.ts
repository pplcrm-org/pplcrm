import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../../base.repo';
import { StorageService } from '../../storage.service';
import { pruneDetachedEmails } from './maintenance.handlers';

/**
 * Mailbox sync no longer destroys a message that merely left the folder it was synced from — it
 * detaches it, keeping the row and everything the CRM added. Without a sweep those rows would
 * accumulate for the life of the workspace, each one dragging a body blob along.
 *
 * The line this sweep must not cross: it may only remove rows that carry nothing a person wrote or
 * decided. A comment, an assignee, a closed status or a star means the row is kept indefinitely,
 * however old it is.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
const db = (BaseRepository as any)._db;
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

const INBOX = '11';

describe('pruneDetachedEmails', () => {
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let deleteSpy: ReturnType<typeof vi.spyOn>;

  interface SeedOptions {
    detachedAt: Date | null;
    assignedTo?: string | null;
    status?: string;
    isFavourite?: boolean;
    comment?: string;
    bodyStorageKey?: string;
  }

  async function seedEmail(options: SeedOptions): Promise<string> {
    const created = await db
      .insertInto('emails')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: INBOX,
        from_email: 'sender@example.com',
        to_email: `user-${userId}@example.com`,
        subject: 'Synced message',
        preview: `ms:${rand()}`,
        assigned_to: options.assignedTo ?? null,
        is_favourite: options.isFavourite ?? false,
        status: options.status ?? 'open',
        detached_at: options.detachedAt,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const emailId = String(created.id);

    if (options.comment) {
      await db
        .insertInto('email_comments')
        .values({
          tenant_id: tenantId,
          email_id: emailId,
          author_id: userId,
          comment: options.comment,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    }

    if (options.bodyStorageKey) {
      await db
        .insertInto('email_bodies')
        .values({
          tenant_id: tenantId,
          email_id: emailId,
          body_html: null,
          storage_key: options.bodyStorageKey,
          body_text: 'hello',
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    }

    return emailId;
  }

  const emailExists = async (emailId: string): Promise<boolean> =>
    !!(await db
      .selectFrom('emails')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', emailId)
      .executeTakeFirst());

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    deleteSpy = vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);

    await db.insertInto('tenants').values({ id: tenantId, name: 'Detached Mail Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `member-${userId}@example.com`,
        password: 'not-a-real-hash',
        first_name: 'Mail',
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
        name: 'Detached Mail Campaign',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.deleteFrom('emails').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('deletes an aged detached message nobody ever touched, and its body blob', async () => {
    const bodyKey = `emails/bodies/${rand()}.html`;
    const emailId = await seedEmail({ detachedAt: daysAgo(120), bodyStorageKey: bodyKey });

    await pruneDetachedEmails(db);

    expect(await emailExists(emailId)).toBe(false);
    expect(deleteSpy).toHaveBeenCalledWith(bodyKey);
  });

  it('keeps a detached message that is still inside the 90-day window', async () => {
    const emailId = await seedEmail({ detachedAt: daysAgo(30) });

    await pruneDetachedEmails(db);

    expect(await emailExists(emailId)).toBe(true);
  });

  it('never touches a message that is still in the mailbox folder', async () => {
    const emailId = await seedEmail({ detachedAt: null });

    await pruneDetachedEmails(db);

    expect(await emailExists(emailId)).toBe(true);
  });

  it('keeps an aged detached message that someone commented on', async () => {
    const emailId = await seedEmail({ detachedAt: daysAgo(400), comment: 'Called them back on Tuesday' });

    await pruneDetachedEmails(db);

    expect(await emailExists(emailId)).toBe(true);
  });

  it('keeps an aged detached message that is assigned to someone', async () => {
    const emailId = await seedEmail({ detachedAt: daysAgo(400), assignedTo: userId });

    await pruneDetachedEmails(db);

    expect(await emailExists(emailId)).toBe(true);
  });

  it('keeps an aged detached message that was closed, or starred', async () => {
    const closedId = await seedEmail({ detachedAt: daysAgo(400), status: 'closed' });
    const starredId = await seedEmail({ detachedAt: daysAgo(400), isFavourite: true });

    await pruneDetachedEmails(db);

    expect(await emailExists(closedId)).toBe(true);
    expect(await emailExists(starredId)).toBe(true);
  });
});
