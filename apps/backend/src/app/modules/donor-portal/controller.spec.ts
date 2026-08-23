import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BadRequestError, PreconditionFailedError } from '../../errors/app-errors';
import { BaseRepository } from '../../lib/base.repo';
import { DonorPortalController } from './controller';
import type { ResolvedPortalLink } from './repositories/portal-links.repo';

/**
 * Integration spec for the donor portal controller against real Postgres. Every method takes a
 * ResolvedPortalLink ({id, tenant_id, person_id}) — the route resolves the bearer token before
 * calling in, so these tests hand the controller an already-resolved link and assert what it
 * reads and writes. Seeds are the full FK chain (tenant → admin → campaign → households →
 * person) with tenants.admin_id set, because donor-initiated writes are attributed to the
 * workspace admin.
 *
 * Stripe: the test env has no key, so isMockMode is true, and every pledge here either has a
 * sub_mock_ subscription id or none at all — no Stripe call can happen on any path.
 */

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (BaseRepository as any)._db;

interface Seed {
  tenantId: string;
  userId: string;
  campaignId: string;
  placeholderHouseholdId: string;
  householdId: string;
  personId: string;
  personEmail: string;
}

async function createSeed(): Promise<Seed> {
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const placeholderHouseholdId = rand();
  const householdId = rand();
  const personEmail = `donor-${tenantId}@example.com`;

  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      name: 'Donor Portal Tenant',
      slug: `test-${tenantId}`,
      // Movement so the yard-sign path is open by default; the plan-skip test downgrades.
      subscription_plan: 'movement',
    })
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
      name: 'Portal Campaign',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db
    .insertInto('households')
    .values({
      id: placeholderHouseholdId,
      tenant_id: tenantId,
      campaign_id: campaignId,
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
      street1: '12 Maple St',
      city: 'Testville',
      state: 'ON',
      zip: 'K1A 0A1',
      country: 'Canada',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db
    .updateTable('tenants')
    .set({ admin_id: userId, createdby_id: userId, placeholder_household_id: placeholderHouseholdId })
    .where('id', '=', tenantId)
    .execute();
  await db
    .insertInto('settings')
    .values({
      tenant_id: tenantId,
      key: 'current_campaign',
      value: JSON.stringify({ id: Number(campaignId) }),
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  const person = await db
    .insertInto('persons')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      household_id: householdId,
      first_name: 'Dana',
      last_name: 'Donor',
      email: personEmail,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return {
    tenantId,
    userId,
    campaignId,
    placeholderHouseholdId,
    householdId,
    personId: String(person.id),
    personEmail,
  };
}

async function cleanTenant(tenantId: string): Promise<void> {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();
  for (const table of [
    'background_jobs',
    'user_activity',
    'delivery_requests',
    'campaign_subscriptions',
    'email_suppressions',
    'donation_receipt_items',
    'donation_receipts',
    'donations',
    'donation_pledges',
    'donor_portal_links',
    'persons',
    'households',
    'settings',
    'campaigns',
    'authusers',
  ]) {
    await db.deleteFrom(table).where('tenant_id', '=', tenantId).execute();
  }
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePayload(payload: unknown): Record<string, any> {
  return typeof payload === 'string' ? JSON.parse(payload) : ((payload ?? {}) as Record<string, unknown>);
}

async function notifyJobsFor(tenantId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', tenantId).execute();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => parsePayload(r.payload)).filter((p: any) => p.type === 'notify-donor-pledge-cancelled');
}

describe('DonorPortalController (integration)', () => {
  const controller = new DonorPortalController();
  let seed: Seed;
  let link: ResolvedPortalLink;

  const addPledge = async (
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; subscriptionId: string }> => {
    const subscriptionId = `sub_mock_${rand()}`;
    const row = await db
      .insertInto('donation_pledges')
      .values({
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        person_id: seed.personId,
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: `cus_${rand()}`,
        monthly_amount: 2500,
        status: 'active',
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
        ...overrides,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: String(row.id), subscriptionId: String(row.stripe_subscription_id ?? subscriptionId) };
  };

  beforeEach(async () => {
    seed = await createSeed();
    // The controller only reads tenant_id/person_id off the link (id is telemetry-only),
    // so a fabricated link row id is fine here — the route spec covers token resolution.
    link = { id: '0', tenant_id: seed.tenantId, person_id: seed.personId };
  });

  afterEach(async () => {
    await cleanTenant(seed.tenantId);
  });

  // ── getSummary ──────────────────────────────────────────────────────────────

  it('getSummary shows refunded gifts with their refunded_at and intact ones without', async () => {
    await db
      .insertInto('donations')
      .values({
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        person_id: seed.personId,
        amount: 5000,
        status: 'succeeded',
      })
      .execute();
    const refundedAt = new Date('2026-03-01T12:00:00Z');
    await db
      .insertInto('donations')
      .values({
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        person_id: seed.personId,
        amount: 2000,
        status: 'refunded',
        refunded_at: refundedAt,
      })
      .execute();

    const summary = await controller.getSummary(link);

    expect(summary.org_name).toBe('Donor Portal Tenant');
    expect(summary.first_name).toBe('Dana');
    expect(summary.donations).toHaveLength(2);
    const refunded = summary.donations.find((d) => d.status === 'refunded');
    const intact = summary.donations.find((d) => d.status === 'succeeded');
    expect(refunded?.refunded_at).toBe(refundedAt.toISOString());
    expect(refunded?.amount_cents).toBe(2000);
    expect(intact?.refunded_at).toBeNull();
    expect(summary.address).toEqual({
      street: '12 Maple St',
      apt: '',
      city: 'Testville',
      state: 'ON',
      zip: 'K1A 0A1',
      country: 'Canada',
    });
    expect(summary.address_shared).toBe(false);
  });

  it('getSummary lists only issued receipts — a cancelled receipt is a staff-ledger fact', async () => {
    const year = new Date().getFullYear();
    const addReceipt = async (serial: number, overrides: Record<string, unknown> = {}): Promise<string> => {
      const row = await db
        .insertInto('donation_receipts')
        .values({
          tenant_id: seed.tenantId,
          kind: 'per_gift',
          regime: 'cra_charity',
          year,
          serial,
          receipt_number: `T-${year}-${String(serial).padStart(5, '0')}`,
          status: 'issued',
          person_id: seed.personId,
          donor_name: 'Dana Donor',
          amount_cents: 5000,
          advantage_cents: 0,
          eligible_cents: 5000,
          issuer_snapshot: JSON.stringify({}),
          createdby_id: seed.userId,
          updatedby_id: seed.userId,
          ...overrides,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return String(row.id);
    };
    const issuedId = await addReceipt(1);
    await addReceipt(2, { status: 'cancelled', cancelled_reason: 'test cancel', cancelled_at: new Date() });

    const summary = await controller.getSummary(link);

    expect(summary.receipts).toHaveLength(1);
    expect(summary.receipts[0].id).toBe(issuedId);
    expect(summary.receipts[0].pdf_ready).toBe(false); // file_id is null — PDF not rendered yet
  });

  it('getSummary computes can_manage_card: true only with a customer id and a real (non-mock) subscription', async () => {
    const manageable = await addPledge({ stripe_subscription_id: `sub_live_${rand()}` });
    const mock = await addPledge(); // sub_mock_ prefix
    const noCustomer = await addPledge({ stripe_subscription_id: `sub_live_${rand()}`, stripe_customer_id: null });

    const summary = await controller.getSummary(link);

    const byId = new Map(summary.pledges.map((p) => [p.id, p]));
    expect(byId.get(manageable.id)?.can_manage_card).toBe(true);
    expect(byId.get(mock.id)?.can_manage_card).toBe(false);
    expect(byId.get(noCustomer.id)?.can_manage_card).toBe(false);
  });

  // ── receiptDownload ─────────────────────────────────────────────────────────

  it("receiptDownload refuses another person's receipt with the uniform null", async () => {
    const other = await db
      .insertInto('persons')
      .values({
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        household_id: seed.householdId,
        first_name: 'Other',
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const receipt = await db
      .insertInto('donation_receipts')
      .values({
        tenant_id: seed.tenantId,
        kind: 'per_gift',
        regime: 'cra_charity',
        year: new Date().getFullYear(),
        serial: 7,
        receipt_number: `O-${rand()}`,
        status: 'issued',
        person_id: String(other.id),
        donor_name: 'Other Donor',
        amount_cents: 1000,
        advantage_cents: 0,
        eligible_cents: 1000,
        issuer_snapshot: JSON.stringify({}),
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    expect(await controller.receiptDownload(link, String(receipt.id))).toBeNull();
  });

  it('receiptDownload answers not_ready for an own issued receipt whose PDF has not rendered', async () => {
    const receipt = await db
      .insertInto('donation_receipts')
      .values({
        tenant_id: seed.tenantId,
        kind: 'per_gift',
        regime: 'cra_charity',
        year: new Date().getFullYear(),
        serial: 8,
        receipt_number: `R-${rand()}`,
        status: 'issued',
        person_id: seed.personId,
        donor_name: 'Dana Donor',
        amount_cents: 1000,
        advantage_cents: 0,
        eligible_cents: 1000,
        issuer_snapshot: JSON.stringify({}),
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    expect(await controller.receiptDownload(link, String(receipt.id))).toEqual({ status: 'not_ready' });
  });

  // ── cancelPledge ────────────────────────────────────────────────────────────

  it('cancelPledge cancels a mock-mode pledge, stamps cancelled_at, and enqueues exactly one notify job', async () => {
    const pledge = await addPledge();

    const result = await controller.cancelPledge(link, pledge.id);

    expect(result).toEqual({ status: 'cancelled' });
    const row = await db
      .selectFrom('donation_pledges')
      .select(['status', 'cancelled_at'])
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', pledge.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('cancelled');
    expect(row.cancelled_at).not.toBeNull();

    const jobs = await notifyJobsFor(seed.tenantId);
    expect(jobs).toHaveLength(1);
    expect(String(jobs[0]['pledge_id'])).toBe(pledge.id);
    expect(jobs[0]['source']).toBe('portal');
  });

  it('cancelPledge is idempotent — a second cancel answers cancelled without a second notify job', async () => {
    const pledge = await addPledge();
    await controller.cancelPledge(link, pledge.id);

    const again = await controller.cancelPledge(link, pledge.id);

    expect(again).toEqual({ status: 'cancelled' });
    expect(await notifyJobsFor(seed.tenantId)).toHaveLength(1);
  });

  it("cancelPledge refuses another person's pledge with the uniform null", async () => {
    const other = await db
      .insertInto('persons')
      .values({
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        household_id: seed.householdId,
        first_name: 'Other',
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const pledge = await addPledge({ person_id: String(other.id) });

    expect(await controller.cancelPledge(link, pledge.id)).toBeNull();
    expect(await notifyJobsFor(seed.tenantId)).toHaveLength(0);
  });

  it('cancelPledge is deliberately ungated by plan — it works on a free-plan workspace', async () => {
    await db.updateTable('tenants').set({ subscription_plan: 'free' }).where('id', '=', seed.tenantId).execute();
    const pledge = await addPledge({ stripe_subscription_id: null, stripe_customer_id: null });

    const result = await controller.cancelPledge(link, pledge.id);

    expect(result).toEqual({ status: 'cancelled' });
    const row = await db
      .selectFrom('donation_pledges')
      .select('status')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', pledge.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('cancelled');
  });

  // ── changePledgeAmount ──────────────────────────────────────────────────────

  it('changePledgeAmount refuses a pledge that is no longer active', async () => {
    const pledge = await addPledge({ status: 'cancelled' });

    await expect(controller.changePledgeAmount(link, pledge.id, 3000)).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('changePledgeAmount refuses out-of-bounds amounts before touching anything', async () => {
    const pledge = await addPledge();

    await expect(controller.changePledgeAmount(link, pledge.id, 99)).rejects.toBeInstanceOf(BadRequestError);
    await expect(controller.changePledgeAmount(link, pledge.id, 10_000_001)).rejects.toBeInstanceOf(BadRequestError);
    await expect(controller.changePledgeAmount(link, pledge.id, 2500.5)).rejects.toBeInstanceOf(BadRequestError);

    const row = await db
      .selectFrom('donation_pledges')
      .select('monthly_amount')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', pledge.id)
      .executeTakeFirstOrThrow();
    expect(Number(row.monthly_amount)).toBe(2500);
  });

  it('changePledgeAmount updates monthly_amount on a mock pledge', async () => {
    const pledge = await addPledge();

    const result = await controller.changePledgeAmount(link, pledge.id, 2000);

    expect(result).toEqual({ status: 'ok', monthly_amount_cents: 2000 });
    const row = await db
      .selectFrom('donation_pledges')
      .select('monthly_amount')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', pledge.id)
      .executeTakeFirstOrThrow();
    expect(Number(row.monthly_amount)).toBe(2000);
  });

  // ── updateAddress ───────────────────────────────────────────────────────────

  const donorHouseholdId = async (): Promise<string> => {
    const row = await db
      .selectFrom('persons')
      .select('household_id')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', seed.personId)
      .executeTakeFirstOrThrow();
    return String(row.household_id);
  };

  it('updateAddress moves a placeholder-household person onto a NEW real household', async () => {
    await db
      .updateTable('persons')
      .set({ household_id: seed.placeholderHouseholdId })
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', seed.personId)
      .execute();

    const result = await controller.updateAddress(link, {
      street: '77 Fresh Ave',
      city: 'Testville',
      state: 'ON',
      zip: 'K2B 1B1',
      country: 'Canada',
    });

    expect(result).toEqual({ status: 'ok' });
    const newHouseholdId = await donorHouseholdId();
    expect(newHouseholdId).not.toBe(seed.placeholderHouseholdId);
    const hh = await db
      .selectFrom('households')
      .select(['street1', 'city'])
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', newHouseholdId)
      .executeTakeFirstOrThrow();
    expect(hh.street1).toBe('77 Fresh Ave');
    expect(hh.city).toBe('Testville');
  });

  it('updateAddress moves ONLY the donor off a shared household, leaving the housemate untouched', async () => {
    const housemate = await db
      .insertInto('persons')
      .values({
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        household_id: seed.householdId,
        first_name: 'Housemate',
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await controller.updateAddress(link, {
      street: '99 Solo Exit St',
      city: 'Testville',
      state: 'ON',
      zip: 'K3C 2C2',
      country: 'Canada',
    });

    const newHouseholdId = await donorHouseholdId();
    expect(newHouseholdId).not.toBe(seed.householdId);
    const mate = await db
      .selectFrom('persons')
      .select('household_id')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', String(housemate.id))
      .executeTakeFirstOrThrow();
    expect(String(mate.household_id)).toBe(seed.householdId);
    const shared = await db
      .selectFrom('households')
      .select('street1')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', seed.householdId)
      .executeTakeFirstOrThrow();
    expect(shared.street1).toBe('12 Maple St'); // the shared address was never rewritten
  });

  it('updateAddress updates a sole-member household in place and enqueues geocoding', async () => {
    const result = await controller.updateAddress(link, {
      street: '31 Solo Way',
      city: 'Testville',
      state: 'ON',
      zip: 'K4D 3D3',
      country: 'Canada',
    });

    expect(result).toEqual({ status: 'ok' });
    expect(await donorHouseholdId()).toBe(seed.householdId);
    const hh = await db
      .selectFrom('households')
      .select(['street1', 'zip'])
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', seed.householdId)
      .executeTakeFirstOrThrow();
    expect(hh.street1).toBe('31 Solo Way');
    expect(hh.zip).toBe('K4D 3D3');

    const jobs = await db.selectFrom('background_jobs').selectAll().where('tenant_id', '=', seed.tenantId).execute();
    const geocode = jobs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((j: any) => parsePayload(j.payload))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((p: any) => p.type === 'geocode_household' && String(p.household_id) === seed.householdId);
    expect(geocode).toHaveLength(1);
  });

  it('updateAddress is a no-op on an identical payload — the household row is not touched', async () => {
    const before = await db
      .selectFrom('households')
      .select('updated_at')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', seed.householdId)
      .executeTakeFirstOrThrow();

    const result = await controller.updateAddress(link, {
      street: '12 Maple St',
      apt: '',
      city: 'Testville',
      state: 'ON',
      zip: 'K1A 0A1',
      country: 'Canada',
    });

    expect(result).toEqual({ status: 'ok' });
    const after = await db
      .selectFrom('households')
      .select('updated_at')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', seed.householdId)
      .executeTakeFirstOrThrow();
    expect(new Date(after.updated_at).getTime()).toBe(new Date(before.updated_at).getTime());
  });

  // ── setSubscription ─────────────────────────────────────────────────────────

  const addSubscription = async (overrides: Record<string, unknown> = {}): Promise<void> => {
    await db
      .insertInto('campaign_subscriptions')
      .values({
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        person_id: seed.personId,
        email: seed.personEmail,
        status: 'subscribed',
        consent_source: 'form',
        consent_at: new Date(),
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
        ...overrides,
      })
      .execute();
  };

  const subscriptionRow = async () =>
    db
      .selectFrom('campaign_subscriptions')
      .selectAll()
      .where('tenant_id', '=', seed.tenantId)
      .where('campaign_id', '=', seed.campaignId)
      .where('person_id', '=', seed.personId)
      .executeTakeFirstOrThrow();

  it('setSubscription unsubscribe flips an existing subscribed row and stamps unsubscribed_at', async () => {
    await addSubscription();

    const result = await controller.setSubscription(link, seed.campaignId, 'unsubscribed');

    expect(result).toEqual({ status: 'unsubscribed' });
    const row = await subscriptionRow();
    expect(row.status).toBe('unsubscribed');
    expect(row.unsubscribed_at).not.toBeNull();
  });

  it("setSubscription resubscribe writes consent_source 'donor_portal' with a fresh consent_at", async () => {
    await addSubscription({ status: 'unsubscribed', consent_at: null, unsubscribed_at: new Date() });

    const result = await controller.setSubscription(link, seed.campaignId, 'subscribed');

    expect(result).toEqual({ status: 'subscribed' });
    const row = await subscriptionRow();
    expect(row.status).toBe('subscribed');
    expect(row.consent_source).toBe('donor_portal');
    expect(row.consent_at).not.toBeNull();
    expect(row.unsubscribed_at).toBeNull();
  });

  it('setSubscription never creates a first-time subscription — no existing row answers null', async () => {
    expect(await controller.setSubscription(link, seed.campaignId, 'subscribed')).toBeNull();
    const rows = await db
      .selectFrom('campaign_subscriptions')
      .select('id')
      .where('tenant_id', '=', seed.tenantId)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('setSubscription resubscribe never deletes an email_suppressions row', async () => {
    await addSubscription({ status: 'unsubscribed', unsubscribed_at: new Date() });
    await db
      .insertInto('email_suppressions')
      .values({ tenant_id: seed.tenantId, email: seed.personEmail.toLowerCase(), reason: 'hard_bounce' })
      .execute();

    await controller.setSubscription(link, seed.campaignId, 'subscribed');

    const suppressions = await db
      .selectFrom('email_suppressions')
      .select('id')
      .where('tenant_id', '=', seed.tenantId)
      .where('email', '=', seed.personEmail.toLowerCase())
      .execute();
    expect(suppressions).toHaveLength(1);
  });

  // ── expressVolunteerInterest ────────────────────────────────────────────────

  it('expressVolunteerInterest fills an empty volunteer_status with prospective', async () => {
    const result = await controller.expressVolunteerInterest(link);

    expect(result).toEqual({ volunteer_interest: true });
    const row = await db
      .selectFrom('persons')
      .select('volunteer_status')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', seed.personId)
      .executeTakeFirstOrThrow();
    expect(row.volunteer_status).toBe('prospective');
  });

  it('expressVolunteerInterest never downgrades an existing volunteer status', async () => {
    await db
      .updateTable('persons')
      .set({ volunteer_status: 'active' })
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', seed.personId)
      .execute();

    await controller.expressVolunteerInterest(link);

    const row = await db
      .selectFrom('persons')
      .select('volunteer_status')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', seed.personId)
      .executeTakeFirstOrThrow();
    expect(row.volunteer_status).toBe('active');
  });

  // ── requestYardSign ─────────────────────────────────────────────────────────

  it("requestYardSign creates a NEW-status 'donor_portal' request for the donor's household", async () => {
    const result = await controller.requestYardSign(link);

    expect(result).toEqual({ status: 'requested' });
    const request = await db
      .selectFrom('delivery_requests')
      .selectAll()
      .where('tenant_id', '=', seed.tenantId)
      .executeTakeFirstOrThrow();
    expect(request.source).toBe('donor_portal');
    expect(request.status).toBe('new');
    expect(String(request.household_id)).toBe(seed.householdId);
    expect(String(request.person_id)).toBe(seed.personId);
    expect(String(request.campaign_id)).toBe(seed.campaignId);
  });

  it('requestYardSign answers already_open instead of duplicating an open request', async () => {
    await controller.requestYardSign(link);

    const again = await controller.requestYardSign(link);

    expect(again).toEqual({ status: 'already_open' });
    const rows = await db.selectFrom('delivery_requests').select('id').where('tenant_id', '=', seed.tenantId).execute();
    expect(rows).toHaveLength(1);
  });

  it('requestYardSign is unavailable for a placeholder-household person — no door to deliver to', async () => {
    await db
      .updateTable('persons')
      .set({ household_id: seed.placeholderHouseholdId })
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', seed.personId)
      .execute();

    expect(await controller.requestYardSign(link)).toEqual({ status: 'unavailable' });
    const rows = await db.selectFrom('delivery_requests').select('id').where('tenant_id', '=', seed.tenantId).execute();
    expect(rows).toHaveLength(0);
  });

  it('requestYardSign is silently unavailable on a plan without deliveries — no row is written', async () => {
    await db.updateTable('tenants').set({ subscription_plan: 'free' }).where('id', '=', seed.tenantId).execute();

    expect(await controller.requestYardSign(link)).toEqual({ status: 'unavailable' });
    const rows = await db.selectFrom('delivery_requests').select('id').where('tenant_id', '=', seed.tenantId).execute();
    expect(rows).toHaveLength(0);
  });
});
