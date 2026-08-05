import { INBOX_PURGE_DELAY_DAYS } from '@common';
import { beforeEach, describe, expect, it } from 'vitest';

import { useTestTransaction } from '../../lib/test-utils/db-test-isolation';
import { getFreshInboxPurgeStatus, inboxPurgeStillDue, syncInboxPurgeSchedule } from './inbox-purge';

/**
 * `tenants.inbox_purge_scheduled_at` is the only thing standing between a downgraded workspace's
 * synced mail and permanent deletion by the nightly `purge_downgraded_inboxes` cron. This spec
 * pins the scheduling rules that decide whether that column is set, left alone, or cleared:
 *
 *  - a plan without the shared inbox schedules the purge INBOX_PURGE_DELAY_DAYS out, once
 *  - a repeat downgrade event must not push an existing deadline further out
 *  - regaining a plan with the inbox clears the deadline outright (nothing is deleted)
 *  - a demo workspace is never scheduled
 *  - a workspace with no mail and no mailbox connection is never scheduled
 *
 * These run inside a rolled-back transaction (`useTestTransaction`), which works here because
 * `syncInboxPurgeSchedule` accepts the handle it is given and opens no transaction of its own.
 * The cron itself cannot be tested that way — see lib/jobs/handlers/inbox-purge.handlers.spec.ts.
 */

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

const DAY_MS = 24 * 60 * 60 * 1000;
const INBOX_FOLDER = '11';

describe('inbox purge scheduling', () => {
  const ctx = useTestTransaction();

  let tenantId: string;
  let userId: string;
  let campaignId: string;

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();

    await ctx.trx
      .insertInto('tenants')
      .values({ id: tenantId, name: `Purge Schedule Tenant ${tenantId}`, subscription_plan: 'free' })
      .execute();
    await ctx.trx
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `member-${userId}@example.com`,
        password: 'not-a-real-hash',
        first_name: 'Purge',
        last_name: 'Member',
        verified: true,
        role: 'user',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await ctx.trx
      .insertInto('campaigns')
      .values({
        id: campaignId,
        tenant_id: tenantId,
        admin_id: userId,
        name: `Purge Schedule Campaign ${campaignId}`,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  });

  const seedEmail = async (): Promise<void> => {
    await ctx.trx
      .insertInto('emails')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: INBOX_FOLDER,
        from_email: 'voter@example.com',
        to_email: `member-${userId}@example.com`,
        subject: 'Synced message',
        preview: `google:${rand()}`,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  };

  const seedGoogleToken = async (): Promise<void> => {
    await ctx.trx
      .insertInto('google_oauth_tokens')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_at: new Date(Date.now() + DAY_MS),
      })
      .execute();
  };

  const seedMsToken = async (): Promise<void> => {
    await ctx.trx
      .insertInto('ms_oauth_tokens')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_at: new Date(Date.now() + DAY_MS),
      })
      .execute();
  };

  const setPlan = async (plan: string): Promise<void> => {
    await ctx.trx.updateTable('tenants').set({ subscription_plan: plan }).where('id', '=', tenantId).execute();
  };

  const setSchedule = async (at: Date | null): Promise<void> => {
    await ctx.trx.updateTable('tenants').set({ inbox_purge_scheduled_at: at }).where('id', '=', tenantId).execute();
  };

  const readSchedule = async (): Promise<Date | null | undefined> => {
    const row = await ctx.trx
      .selectFrom('tenants')
      .select('inbox_purge_scheduled_at')
      .where('id', '=', tenantId)
      .executeTakeFirst();
    return row?.inbox_purge_scheduled_at;
  };

  it('schedules a purge 30 days out when a Free tenant has synced mail', async () => {
    await seedEmail();

    await syncInboxPurgeSchedule(ctx.trx, tenantId);

    const scheduled = await readSchedule();
    expect(scheduled).toBeInstanceOf(Date);
    const expected = Date.now() + INBOX_PURGE_DELAY_DAYS * DAY_MS;
    // Allow a minute of slack for test execution time.
    expect(Math.abs((scheduled as Date).getTime() - expected)).toBeLessThan(60_000);
  });

  it('schedules a purge when there is no mail yet but a Gmail connection exists', async () => {
    await seedGoogleToken();

    await syncInboxPurgeSchedule(ctx.trx, tenantId);

    expect(await readSchedule()).toBeInstanceOf(Date);
  });

  it('schedules a purge when only a Microsoft connection exists', async () => {
    await seedMsToken();

    await syncInboxPurgeSchedule(ctx.trx, tenantId);

    expect(await readSchedule()).toBeInstanceOf(Date);
  });

  it('does not schedule anything for a Free tenant with no mail and no mailbox connection', async () => {
    await syncInboxPurgeSchedule(ctx.trx, tenantId);

    expect(await readSchedule()).toBeNull();
  });

  it('does not push an existing deadline further out on a second downgrade event', async () => {
    await seedEmail();
    const existing = new Date(Date.now() + 2 * DAY_MS);
    await setSchedule(existing);

    await syncInboxPurgeSchedule(ctx.trx, tenantId);

    expect(await readSchedule()).toEqual(existing);
  });

  it('clears the deadline when the tenant regains a plan that includes the inbox', async () => {
    await seedEmail();
    await setSchedule(new Date(Date.now() + 5 * DAY_MS));
    await setPlan('grassroots');

    await syncInboxPurgeSchedule(ctx.trx, tenantId);

    expect(await readSchedule()).toBeNull();
  });

  it('never schedules a purge for a demo workspace, and clears one that was already set', async () => {
    await seedEmail();
    await setSchedule(new Date(Date.now() + 5 * DAY_MS));
    await ctx.trx.updateTable('tenants').set({ demo_mode_at: new Date() }).where('id', '=', tenantId).execute();

    await syncInboxPurgeSchedule(ctx.trx, tenantId);

    expect(await readSchedule()).toBeNull();
  });

  it('reads the tenant status fresh from the database', async () => {
    await setPlan('movement');
    const deadline = new Date(Date.now() + DAY_MS);
    await setSchedule(deadline);

    const status = await getFreshInboxPurgeStatus(ctx.trx, tenantId);

    expect(status?.subscription_plan).toBe('movement');
    expect(status?.inbox_purge_scheduled_at).toEqual(deadline);
    expect(status?.demo_mode_at).toBeNull();
  });

  it('returns nothing for a tenant that no longer exists', async () => {
    expect(await getFreshInboxPurgeStatus(ctx.trx, rand())).toBeUndefined();
  });
});

describe('inboxPurgeStillDue', () => {
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 60 * 60 * 1000);

  it('is true only for a non-demo, inbox-less plan whose deadline has passed', () => {
    expect(inboxPurgeStillDue({ subscription_plan: 'free', demo_mode_at: null, inbox_purge_scheduled_at: past })).toBe(
      true,
    );
  });

  it('is false for every plan that includes the inbox, even with a deadline in the past', () => {
    for (const plan of ['grassroots', 'movement', 'enterprise']) {
      expect(inboxPurgeStillDue({ subscription_plan: plan, demo_mode_at: null, inbox_purge_scheduled_at: past })).toBe(
        false,
      );
    }
  });

  it('is false for a demo workspace', () => {
    expect(
      inboxPurgeStillDue({ subscription_plan: 'free', demo_mode_at: new Date(), inbox_purge_scheduled_at: past }),
    ).toBe(false);
  });

  it('is false when no deadline is set', () => {
    expect(inboxPurgeStillDue({ subscription_plan: 'free', demo_mode_at: null, inbox_purge_scheduled_at: null })).toBe(
      false,
    );
  });

  it('is false while the deadline is still in the future', () => {
    expect(
      inboxPurgeStillDue({ subscription_plan: 'free', demo_mode_at: null, inbox_purge_scheduled_at: future }),
    ).toBe(false);
  });

  it('fails closed for an unknown or missing plan value', () => {
    expect(
      inboxPurgeStillDue({ subscription_plan: 'not-a-plan', demo_mode_at: null, inbox_purge_scheduled_at: past }),
    ).toBe(true);
  });
});
