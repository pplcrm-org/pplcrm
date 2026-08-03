import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { DonationsController } from './controller';

async function cleanTenant(db: any, tenantId: string, _personId: string) {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();
  await db.deleteFrom('donations').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('donation_pledges').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

async function createTestSeed(db: any) {
  const rand = () => String(Math.floor(Math.random() * 100000000) + 1000000);
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const householdId = rand();
  const personId = rand();

  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      name: 'Test Tenant Donations',
    })
    .execute();

  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `test-${userId}@example.com`,
      password: 'password',
      first_name: 'Test',
      last_name: 'User',
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
      name: 'Test Campaign',
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

  await db
    .updateTable('tenants')
    .set({ admin_id: userId, createdby_id: userId, placeholder_household_id: householdId })
    .where('id', '=', tenantId)
    .execute();

  // Create a person
  await db
    .insertInto('persons' as any)
    .values({
      id: personId,
      tenant_id: tenantId,
      campaign_id: campaignId,
      household_id: householdId,
      first_name: 'John',
      last_name: 'Doe',
      email: 'john.doe@example.com',
      createdby_id: userId,
      updatedby_id: userId,
    } as any)
    .execute();

  return { tenantId, userId, campaignId, householdId, personId };
}

describe('DonationsController Unit & Integration', () => {
  const controller = new DonationsController();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let personId: string;
  let campaignId: string;

  beforeEach(async () => {
    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    campaignId = seed.campaignId;
    personId = seed.personId;
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId, personId);
  });

  describe('Tax Credit Calculation', () => {
    it('should return 0 when no tiers are provided', () => {
      const credit = controller.calculateTaxCredit(10000, 0, []);
      expect(credit).toBe(0);
    });

    it('should calculate correct credit with progressive tiers', () => {
      const tiers = [
        { limit: 500, rate: 0.75 },
        { limit: 1000, rate: 0.5 },
        { limit: 2000, rate: 0.4 },
      ];

      // Test 1: $500 donation under $500 tier
      const credit1 = controller.calculateTaxCredit(50000, 0, tiers);
      expect(credit1).toBe(37500); // 500 * 0.75 = 375

      // Test 2: $100 donation when cumulative is already $500
      const credit2 = controller.calculateTaxCredit(10000, 50000, tiers);
      expect(credit2).toBe(5000); // 100 * 0.50 = 50

      // Test 3: $1000 donation starting at $250 cumulative
      // - Next $250 goes to Tier 1 ($250-$500) -> 250 * 0.75 = 187.5
      // - Next $500 goes to Tier 2 ($500-$1000) -> 500 * 0.50 = 250.0
      // - Remaining $250 goes to Tier 3 ($1000-$2000) -> 250 * 0.40 = 100.0
      // - Total: 187.5 + 250 + 100 = 537.5 -> rounded to 538
      const credit3 = controller.calculateTaxCredit(100000, 25000, tiers);
      expect(credit3).toBe(53750); // in cents, so 537.5 * 100 = 53750
    });
  });

  describe('Eligibility Check', () => {
    it('should block donation if it exceeds the annual limit', async () => {
      // Set limit in settings
      await db
        .insertInto('settings')
        .values({
          tenant_id: tenantId,
          key: 'donations.limit',
          value: JSON.stringify(1500) as any, // $1500 limit
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();

      // Record a prior successful donation of $1000
      await db
        .insertInto('donations')
        .values({
          tenant_id: tenantId,
          campaign_id: campaignId,
          person_id: personId,
          amount: 100000,
          status: 'succeeded',
        })
        .execute();

      // Attempt $600 donation -> cumulative would be 1600 > 1500 limit
      const check = await controller.checkEligibility(tenantId, personId, 60000, {});
      expect(check.eligible).toBe(false);
      expect(check.reason).toContain('exceeds the maximum limit of');
    });

    it('should block donation if residency restrictions are violated', async () => {
      // Restrict residency to CA and province ON
      await db
        .insertInto('settings')
        .values([
          {
            tenant_id: tenantId,
            key: 'donations.restrict_residency',
            value: JSON.stringify(true) as any,
            createdby_id: userId,
            updatedby_id: userId,
          },
          {
            tenant_id: tenantId,
            key: 'donations.allowed_countries',
            value: JSON.stringify('CA') as any,
            createdby_id: userId,
            updatedby_id: userId,
          },
          {
            tenant_id: tenantId,
            key: 'donations.allowed_regions',
            value: JSON.stringify('ON') as any,
            createdby_id: userId,
            updatedby_id: userId,
          },
        ])
        .execute();

      // Non-matching state: QC
      const check1 = await controller.checkEligibility(tenantId, personId, 10000, { country: 'CA', state: 'QC' });
      expect(check1.eligible).toBe(false);
      expect(check1.reason).toContain('allowed provinces/states: ON');

      // Matching state: ON
      const check2 = await controller.checkEligibility(tenantId, personId, 10000, { country: 'CA', state: 'ON' });
      expect(check2.eligible).toBe(true);
    });
  });

  describe('Donations ledger (getAll + summary)', () => {
    /** One pledge + three gifts: a plain one-time gift, a monthly installment, and a refund. */
    async function seedLedger(): Promise<void> {
      const pledge = await db
        .insertInto('donation_pledges')
        .values({
          tenant_id: tenantId,
          campaign_id: campaignId,
          person_id: personId,
          stripe_subscription_id: `sub_${tenantId}`,
          monthly_amount: 2500,
          status: 'active',
          createdby_id: userId,
          updatedby_id: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await db
        .insertInto('donations')
        .values([
          {
            tenant_id: tenantId,
            campaign_id: campaignId,
            person_id: personId,
            amount: 50000,
            status: 'succeeded',
            method: 'card',
          },
          {
            tenant_id: tenantId,
            campaign_id: campaignId,
            person_id: personId,
            pledge_id: pledge.id,
            amount: 2500,
            status: 'succeeded',
            method: 'card',
          },
          {
            tenant_id: tenantId,
            campaign_id: campaignId,
            person_id: personId,
            amount: 99900,
            status: 'refunded',
            method: 'card',
          },
        ])
        .execute();
    }

    it('pages succeeded gifts with a total count and joined donor details', async () => {
      await seedLedger();

      const page = await controller.getAllWithCounts(tenantId, { startRow: 0, endRow: 1 });
      expect(page.count).toBe(2); // the refunded gift is not in the ledger
      expect(page.rows).toHaveLength(1); // one page of one row, not everything
      expect(String(page.rows[0]['person_first_name'])).toBe('John');
      expect(page.rows[0]['receipt_status']).toBe('none');
    });

    it('excludes pledge installments when the one-time scope filter is set', async () => {
      await seedLedger();

      const oneTime = await controller.getAllWithCounts(tenantId, {
        startRow: 0,
        endRow: 50,
        filterModel: { donation_scope: { value: 'one-time' } },
      });
      expect(oneTime.count).toBe(1);
      expect(oneTime.rows[0]['pledge_id']).toBeNull();
    });

    it('searches by donor name server-side', async () => {
      await seedLedger();

      const hit = await controller.getAllWithCounts(tenantId, { startRow: 0, endRow: 50, searchStr: 'john' });
      expect(hit.count).toBe(2);

      const miss = await controller.getAllWithCounts(tenantId, { startRow: 0, endRow: 50, searchStr: 'nobody' });
      expect(miss.count).toBe(0);
    });

    it('computes the header tiles in SQL, scoped like the tabs', async () => {
      await seedLedger();

      const all = await controller.getDonationsLedgerSummary(tenantId, 'all');
      expect(all.totalCents).toBe(52500);
      expect(all.totalCount).toBe(2);
      expect(all.thisMonthCents).toBe(52500); // both gifts were just created
      expect(all.activePledgeCount).toBe(1);
      expect(all.acknowledgedThisMonth).toBe(0); // no receipts issued in this seed

      const oneTime = await controller.getDonationsLedgerSummary(tenantId, 'one-time');
      expect(oneTime.totalCents).toBe(50000);
      expect(oneTime.totalCount).toBe(1);
    });
  });

  describe('Refunds & chargebacks', () => {
    const year = new Date().getFullYear();

    async function seedSucceededDonation(paymentIntentId: string, amount = 50000): Promise<string> {
      const row = await db
        .insertInto('donations')
        .values({
          tenant_id: tenantId,
          campaign_id: campaignId,
          person_id: personId,
          amount,
          status: 'succeeded',
          stripe_payment_intent_id: paymentIntentId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return String(row.id);
    }

    async function statusOf(id: string): Promise<{ status: string; refunded_at: Date | null }> {
      const row = await db
        .selectFrom('donations')
        .select(['status', 'refunded_at'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      return { status: String(row.status), refunded_at: row.refunded_at };
    }

    it('reverses a refunded donation and drops it from cumulative totals', async () => {
      const id = await seedSucceededDonation('pi_refund_1');
      expect(await controller.getPersonCumulativeDonations(tenantId, personId, year)).toBe(50000);

      const reversed = await controller.reverseDonation(tenantId, userId, {
        paymentIntentId: 'pi_refund_1',
        invoiceId: null,
        status: 'refunded',
      });
      expect(reversed).toBe(true);

      const after = await statusOf(id);
      expect(after.status).toBe('refunded');
      expect(after.refunded_at).not.toBeNull();
      // Cumulative totals count only 'succeeded', so the reversed gift no longer counts.
      expect(await controller.getPersonCumulativeDonations(tenantId, personId, year)).toBe(0);
    });

    it('is idempotent on a repeated refund webhook', async () => {
      const id = await seedSucceededDonation('pi_refund_2');
      await controller.reverseDonation(tenantId, userId, {
        paymentIntentId: 'pi_refund_2',
        invoiceId: null,
        status: 'refunded',
      });
      const first = await statusOf(id);
      const again = await controller.reverseDonation(tenantId, userId, {
        paymentIntentId: 'pi_refund_2',
        invoiceId: null,
        status: 'refunded',
      });
      expect(again).toBe(true);
      const second = await statusOf(id);
      expect(second.status).toBe('refunded');
      expect(second.refunded_at?.getTime()).toBe(first.refunded_at?.getTime());
    });

    it('returns false when no donation matches the reversal', async () => {
      const matched = await controller.reverseDonation(tenantId, userId, {
        paymentIntentId: 'pi_does_not_exist',
        invoiceId: null,
        status: 'refunded',
      });
      expect(matched).toBe(false);
    });

    it('correlates a subscription refund by invoice id', async () => {
      // Recurring installments are keyed by invoice id in stripe_session_id, not payment intent.
      await db
        .insertInto('donations')
        .values({
          tenant_id: tenantId,
          campaign_id: campaignId,
          person_id: personId,
          amount: 2500,
          status: 'succeeded',
          stripe_session_id: 'in_invoice_1',
        })
        .execute();

      const reversed = await controller.reverseDonation(tenantId, userId, {
        paymentIntentId: null,
        invoiceId: 'in_invoice_1',
        status: 'refunded',
      });
      expect(reversed).toBe(true);
    });

    it('excludes a disputed donation from totals, then restores it when the dispute is won', async () => {
      const id = await seedSucceededDonation('pi_dispute_1');
      await controller.reverseDonation(tenantId, userId, {
        paymentIntentId: 'pi_dispute_1',
        invoiceId: null,
        status: 'disputed',
      });
      expect((await statusOf(id)).status).toBe('disputed');
      expect(await controller.getPersonCumulativeDonations(tenantId, personId, year)).toBe(0);

      const restored = await controller.restoreDisputedDonation(tenantId, userId, {
        paymentIntentId: 'pi_dispute_1',
        invoiceId: null,
      });
      expect(restored).toBe(true);
      const after = await statusOf(id);
      expect(after.status).toBe('succeeded');
      expect(after.refunded_at).toBeNull();
      expect(await controller.getPersonCumulativeDonations(tenantId, personId, year)).toBe(50000);
    });

    it('does not restore a genuine refund (only disputed rows)', async () => {
      const id = await seedSucceededDonation('pi_refund_3');
      await controller.reverseDonation(tenantId, userId, {
        paymentIntentId: 'pi_refund_3',
        invoiceId: null,
        status: 'refunded',
      });
      const restored = await controller.restoreDisputedDonation(tenantId, userId, {
        paymentIntentId: 'pi_refund_3',
        invoiceId: null,
      });
      expect(restored).toBe(true); // idempotent no-op
      expect((await statusOf(id)).status).toBe('refunded');
    });
  });
});
