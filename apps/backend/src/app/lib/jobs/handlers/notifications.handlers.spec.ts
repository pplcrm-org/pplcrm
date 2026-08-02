import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransactionalEmailService, type SendMailOptions } from '../../mail/transactional-mail.service';
import { TransactionalSendBlockedError } from '../../mail/transactional-send-guard';
import { useTestTransaction } from '../../test-utils/db-test-isolation';
import { handleSendTransactionalEmail, handleSendWebformNotifications } from './notifications.handlers';

const rand = () => String(Math.floor(Math.random() * 100000000) + 1000000);

/**
 * A public form submission produces two emails: a confirmation to the member of the public who
 * submitted it, and an alert to the workspace's own staff.
 *
 * They used to be sent inline, one after the other, with the audience-facing one first. The
 * pre-send anti-abuse gate throws for a suspended or paused workspace and for a workspace over
 * its hourly cap, nothing caught that exception, and the caps differ by audience — so a blocked
 * confirmation stopped the staff alert the gate would have permitted, and the job then retried
 * and dead-lettered. A staff-side failure was just as bad in the other direction: the retry
 * re-sent the confirmation to the member of the public.
 */
describe('web form submission notifications', () => {
  const ctx = useTestTransaction();
  let tenantId: string;
  let ownerId: string;
  let campaignId: string;
  let formId: string;

  const payload = () => ({
    type: 'send-webform-notifications' as const,
    formId,
    tenantId,
    email: 'member-of-the-public@example.com',
    firstName: 'Pat',
    lastName: 'Public',
    notes: 'Please call me',
  });

  const addUser = async (over: {
    id: string;
    email: string;
    role?: string;
    deleted_at?: Date | null;
    deactivated_at?: Date | null;
  }) => {
    await ctx.trx
      .insertInto('authusers')
      .values({
        id: over.id,
        tenant_id: tenantId,
        email: over.email,
        password: 'password',
        first_name: 'Staff',
        last_name: 'Member',
        role: over.role ?? 'user',
        verified: true,
        deleted_at: over.deleted_at ?? null,
        deactivated_at: over.deactivated_at ?? null,
        createdby_id: ownerId,
        updatedby_id: ownerId,
      })
      .execute();
  };

  /** The queued per-message jobs, in insertion order. */
  const queuedMail = async (): Promise<Array<{ to: string; audience: string; subject: string }>> => {
    const rows = await ctx.trx
      .selectFrom('background_jobs')
      .select(['id', 'payload'])
      .where('tenant_id', '=', tenantId)
      .orderBy('id', 'asc')
      .execute();
    return rows
      .map((row) => (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload))
      .filter((p) => p.type === 'send-transactional-email');
  };

  /** web_forms.id is a uuid with a database default, so let Postgres mint it. */
  const addForm = async (creatorId: string): Promise<string> => {
    const row = await ctx.trx
      .insertInto('web_forms')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Volunteer interest',
        status: 'published',
        slug: `form-${rand()}`,
        form_type: 'standard',
        send_confirmation: true,
        send_alert: true,
        createdby_id: creatorId,
        updatedby_id: creatorId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  };

  beforeEach(async () => {
    tenantId = rand();
    ownerId = rand();
    campaignId = rand();

    await ctx.trx.insertInto('tenants').values({ id: tenantId, name: 'Form Tenant' }).execute();
    await ctx.trx
      .insertInto('authusers')
      .values({
        id: ownerId,
        tenant_id: tenantId,
        email: `owner-${ownerId}@example.com`,
        password: 'password',
        first_name: 'Ownie',
        last_name: 'Owner',
        role: 'owner',
        verified: true,
        createdby_id: ownerId,
        updatedby_id: ownerId,
      })
      .execute();
    await ctx.trx
      .insertInto('campaigns')
      .values({
        id: campaignId,
        tenant_id: tenantId,
        admin_id: ownerId,
        name: 'Office',
        kind: 'office',
        createdby_id: ownerId,
        updatedby_id: ownerId,
      })
      .execute();
    formId = await addForm(ownerId);
  });

  it('queues each message as its own job, so neither can suppress or duplicate the other', async () => {
    await handleSendWebformNotifications(payload(), ctx.trx);

    const queued = await queuedMail();
    expect(queued).toHaveLength(2);
    expect(queued.map((m) => m.audience)).toEqual(['contact', 'staff']);
    expect(queued[0]?.to).toBe('member-of-the-public@example.com');
    expect(queued[1]?.to).toBe(`owner-${ownerId}@example.com`);
  });

  it('still delivers the staff alert when the gate blocks the message to the member of the public', async () => {
    await handleSendWebformNotifications(payload(), ctx.trx);
    const queued = await queuedMail();

    const sendMail = vi
      .spyOn(TransactionalEmailService.prototype, 'sendMail')
      .mockImplementation(async (options: SendMailOptions): Promise<void> => {
        if (options.audience === 'contact') {
          throw new TransactionalSendBlockedError('Tenant has sending paused — transactional mail withheld.');
        }
      });

    for (const message of queued) {
      // A blocked message is dropped, not retried: this must not throw, or the worker burns the
      // job's attempts and dead-letters a message that will be blocked next time too.
      await expect(handleSendTransactionalEmail(message as never)).resolves.toBeUndefined();
    }

    expect(sendMail.mock.calls.map((call) => call[0].audience)).toEqual(['contact', 'staff']);
  });

  it('queues nothing at all if the set of messages cannot be written in one go', async () => {
    // Partial queueing is what would let a retry re-send an already-delivered message.
    vi.spyOn(ctx.trx, 'insertInto').mockImplementation((): never => {
      throw new Error('insert failed');
    });

    await expect(handleSendWebformNotifications(payload(), ctx.trx)).rejects.toThrow('insert failed');
  });

  describe('choosing the staff recipient', () => {
    const staffRecipient = async (): Promise<string | undefined> => {
      await handleSendWebformNotifications(payload(), ctx.trx);
      const queued = await queuedMail();
      return queued.find((m) => m.audience === 'staff')?.to;
    };

    it('never picks a user whose account was deleted', async () => {
      // Deleted users keep their row for foreign-key integrity, so an unfiltered query can
      // address a person who left the organisation.
      // A deleted OWNER outranks a live plain user, so only the soft-delete filter can keep the
      // alert away from the departed address.
      const goneId = rand();
      await addUser({ id: goneId, email: `gone-${goneId}@example.com`, role: 'owner', deleted_at: new Date() });
      await ctx.trx
        .updateTable('authusers')
        .set({ deleted_at: new Date() })
        .where('id', '=', ownerId)
        .where('tenant_id', '=', tenantId)
        .execute();
      const liveId = rand();
      await addUser({ id: liveId, email: `live-${liveId}@example.com`, role: 'user' });

      expect(await staffRecipient()).toBe(`live-${liveId}@example.com`);
    });

    it('never picks a deactivated user', async () => {
      // The deactivated account is both the earliest row and the highest-ranked role, so only
      // the deactivated_at filter can steer the alert to the live user.
      await ctx.trx
        .updateTable('authusers')
        .set({ deactivated_at: new Date() })
        .where('id', '=', ownerId)
        .where('tenant_id', '=', tenantId)
        .execute();
      const liveId = rand();
      await addUser({ id: liveId, email: `live-${liveId}@example.com`, role: 'user' });

      expect(await staffRecipient()).toBe(`live-${liveId}@example.com`);
    });

    it('prefers the owner over other roles rather than whichever row the database returns first', async () => {
      // Demote the earliest row so that "first row in the table" and "the owner" are different
      // people. Without an ORDER BY the query is free to return either.
      await ctx.trx
        .updateTable('authusers')
        .set({ role: 'viewer' })
        .where('id', '=', ownerId)
        .where('tenant_id', '=', tenantId)
        .execute();
      const realOwnerId = rand();
      await addUser({ id: realOwnerId, email: `real-owner-${realOwnerId}@example.com`, role: 'owner' });

      expect(await staffRecipient()).toBe(`real-owner-${realOwnerId}@example.com`);
    });
  });
});

describe('handleSendTransactionalEmail', () => {
  const message = {
    type: 'send-transactional-email' as const,
    to: 'someone@example.com',
    subject: 'Hello',
    text: 'Hello',
    html: '<p>Hello</p>',
    tenant_id: '1',
    audience: 'contact' as const,
    notificationSettingsLink: null,
  };

  it('drops a message the anti-abuse gate refuses instead of retrying it', async () => {
    vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockRejectedValue(
      new TransactionalSendBlockedError('Tenant is suspended — transactional mail withheld.'),
    );

    await expect(handleSendTransactionalEmail(message)).resolves.toBeUndefined();
  });

  it('still lets an ordinary delivery failure propagate, so the worker retries it', async () => {
    vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockRejectedValue(new Error('Postmark 503'));

    await expect(handleSendTransactionalEmail(message)).rejects.toThrow('Postmark 503');
  });
});
