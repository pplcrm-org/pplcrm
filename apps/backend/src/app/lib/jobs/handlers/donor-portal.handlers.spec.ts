import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { BaseRepository } from '../../base.repo';
import { TransactionalEmailService, type SendMailOptions } from '../../mail/transactional-mail.service';
import { handleNotifyDonorPledgeCancelled, handleSendDonorPortalLink } from './donor-portal.handlers';

/**
 * The two donor-portal background jobs, called directly against real Postgres with the mail
 * service spied out.
 *
 * send-donor-portal-link is the second half of the public "email me my link" endpoint: the
 * route already answered an identical 200, so everything privacy-relevant happens HERE — no
 * match means silence (no send, no minted link), a match gets exactly one 'contact'-audience
 * email carrying a freshly minted link, the deceased are never emailed, and when several
 * people share an address line the one who actually donated wins.
 *
 * notify-donor-pledge-cancelled fans out to active admins/owners, each half (bell / email)
 * behind that user's own preference pair; notifications are opt-out, so no profiles row means
 * both halves fire.
 */

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (BaseRepository as any)._db;

interface Seed {
  tenantId: string;
  userId: string;
  campaignId: string;
  householdId: string;
}

async function createSeed(): Promise<Seed> {
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const householdId = rand();

  await db
    .insertInto('tenants')
    .values({ id: tenantId, name: 'Donor Portal Jobs Tenant', slug: `test-${tenantId}` })
    .execute();
  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `admin-${userId}@example.com`,
      password: 'password',
      first_name: 'Avery',
      last_name: 'Admin',
      role: 'admin',
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
      name: 'Jobs Campaign',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db
    .insertInto('households')
    .values({
      id: householdId,
      tenant_id: tenantId,
      campaign_id: campaignId,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db.updateTable('tenants').set({ admin_id: userId, createdby_id: userId }).where('id', '=', tenantId).execute();

  return { tenantId, userId, campaignId, householdId };
}

async function cleanTenant(tenantId: string): Promise<void> {
  await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
  for (const table of [
    'notifications',
    'donor_portal_links',
    'donations',
    'donation_pledges',
    'profiles',
    'user_activity',
    'background_jobs',
    'persons',
    'households',
    'campaigns',
    'authusers',
  ]) {
    await db.deleteFrom(table).where('tenant_id', '=', tenantId).execute();
  }
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('donor-portal job handlers', () => {
  let seed: Seed;
  let sendMail: MockInstance<(options: SendMailOptions) => Promise<void>>;

  const addPerson = async (values: Record<string, unknown>): Promise<string> => {
    const row = await db
      .insertInto('persons')
      .values({
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        household_id: seed.householdId,
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
        ...values,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return String(row.id);
  };

  const linkRowsFor = async (): Promise<Array<{ person_id: unknown }>> =>
    db.selectFrom('donor_portal_links').select('person_id').where('tenant_id', '=', seed.tenantId).execute();

  beforeEach(async () => {
    vi.restoreAllMocks();
    sendMail = vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined);
    seed = await createSeed();
  });

  afterEach(async () => {
    await cleanTenant(seed.tenantId);
    vi.restoreAllMocks();
  });

  describe('handleSendDonorPortalLink', () => {
    it('sends nothing and mints nothing when no person matches the email', async () => {
      await addPerson({ first_name: 'Someone', email: `someone-${rand()}@example.com` });

      await handleSendDonorPortalLink(
        { type: 'send-donor-portal-link', tenant_id: seed.tenantId, email: `stranger-${rand()}@example.com` },
        db,
      );

      expect(sendMail).not.toHaveBeenCalled();
      expect(await linkRowsFor()).toHaveLength(0);
    });

    it("mints a link and sends exactly one email with audience 'contact' on a match", async () => {
      const email = `match-${rand()}@example.com`;
      const personId = await addPerson({ first_name: 'Dana', email });

      await handleSendDonorPortalLink({ type: 'send-donor-portal-link', tenant_id: seed.tenantId, email }, db);

      const links = await linkRowsFor();
      expect(links).toHaveLength(1);
      expect(String(links[0].person_id)).toBe(personId);
      expect(sendMail).toHaveBeenCalledTimes(1);
      const message = sendMail.mock.calls[0][0] as unknown as Record<string, unknown>;
      expect(message['to']).toBe(email);
      expect(message['audience']).toBe('contact');
      expect(String(message['text'])).toContain('/g/');
    });

    it('never emails a deceased person', async () => {
      const email = `deceased-${rand()}@example.com`;
      await addPerson({ first_name: 'Gone', email, deceased_at: new Date() });

      await handleSendDonorPortalLink({ type: 'send-donor-portal-link', tenant_id: seed.tenantId, email }, db);

      expect(sendMail).not.toHaveBeenCalled();
      expect(await linkRowsFor()).toHaveLength(0);
    });

    it('prefers the candidate who has actually donated when two people share the address', async () => {
      const email = `shared-${rand()}@example.com`;
      // The donor is the OLDER row (created_at desc puts the non-donor first), so only the
      // donation preference — not insertion order — can explain the winner.
      const donorId = await addPerson({
        first_name: 'Giver',
        email,
        created_at: new Date(Date.now() - 60_000),
      });
      await addPerson({ first_name: 'Namesake', email2: email, created_at: new Date(Date.now() - 30_000) });
      await db
        .insertInto('donations')
        .values({
          tenant_id: seed.tenantId,
          campaign_id: seed.campaignId,
          person_id: donorId,
          amount: 5000,
          status: 'succeeded',
        })
        .execute();

      await handleSendDonorPortalLink({ type: 'send-donor-portal-link', tenant_id: seed.tenantId, email }, db);

      const links = await linkRowsFor();
      expect(links).toHaveLength(1);
      expect(String(links[0].person_id)).toBe(donorId);
      expect(sendMail).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleNotifyDonorPledgeCancelled', () => {
    const addPledge = async (personId: string): Promise<string> => {
      const row = await db
        .insertInto('donation_pledges')
        .values({
          tenant_id: seed.tenantId,
          campaign_id: seed.campaignId,
          person_id: personId,
          stripe_subscription_id: `sub_mock_${rand()}`,
          monthly_amount: 2500,
          status: 'cancelled',
          cancelled_at: new Date(),
          createdby_id: seed.userId,
          updatedby_id: seed.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return String(row.id);
    };

    const notificationsFor = async (): Promise<Array<{ user_id: unknown; title: unknown }>> =>
      db.selectFrom('notifications').select(['user_id', 'title']).where('tenant_id', '=', seed.tenantId).execute();

    it('gives an admin with default (on) preferences both the bell and the email', async () => {
      const personId = await addPerson({ first_name: 'Dana', last_name: 'Donor' });
      const pledgeId = await addPledge(personId);

      await handleNotifyDonorPledgeCancelled(
        { type: 'notify-donor-pledge-cancelled', tenant_id: seed.tenantId, pledge_id: pledgeId, source: 'portal' },
        db,
      );

      const bells = await notificationsFor();
      expect(bells).toHaveLength(1);
      expect(String(bells[0].user_id)).toBe(seed.userId);
      expect(bells[0].title).toBe('Monthly pledge cancelled');
      expect(sendMail).toHaveBeenCalledTimes(1);
      const message = sendMail.mock.calls[0][0] as unknown as Record<string, unknown>;
      expect(message['to']).toBe(`admin-${seed.userId}@example.com`);
      expect(String(message['text'])).toContain('Dana Donor');
      expect(String(message['text'])).toContain('$25/month');
    });

    it('sends neither half to an admin who turned both preferences off', async () => {
      await db
        .insertInto('profiles')
        .values({
          tenant_id: seed.tenantId,
          auth_id: seed.userId,
          preferences: JSON.stringify({
            notifications: { donor_pledge_cancelled: false, donor_pledge_cancelled_in_app: false },
          }),
          createdby_id: seed.userId,
          updatedby_id: seed.userId,
        })
        .execute();
      const personId = await addPerson({ first_name: 'Dana' });
      const pledgeId = await addPledge(personId);

      await handleNotifyDonorPledgeCancelled(
        { type: 'notify-donor-pledge-cancelled', tenant_id: seed.tenantId, pledge_id: pledgeId, source: 'portal' },
        db,
      );

      expect(await notificationsFor()).toHaveLength(0);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('notifies nobody when the workspace has no active admin or owner', async () => {
      // Demote the only admin; add a viewer for good measure — neither is on the roster.
      await db.updateTable('authusers').set({ role: 'user' }).where('tenant_id', '=', seed.tenantId).execute();
      await db
        .insertInto('authusers')
        .values({
          id: rand(),
          tenant_id: seed.tenantId,
          email: `viewer-${rand()}@example.com`,
          password: 'password',
          first_name: 'Vera',
          last_name: 'Viewer',
          role: 'viewer',
          verified: true,
          createdby_id: seed.userId,
          updatedby_id: seed.userId,
        })
        .execute();
      const personId = await addPerson({ first_name: 'Dana' });
      const pledgeId = await addPledge(personId);

      await handleNotifyDonorPledgeCancelled(
        { type: 'notify-donor-pledge-cancelled', tenant_id: seed.tenantId, pledge_id: pledgeId, source: 'portal' },
        db,
      );

      expect(await notificationsFor()).toHaveLength(0);
      expect(sendMail).not.toHaveBeenCalled();
    });
  });
});
