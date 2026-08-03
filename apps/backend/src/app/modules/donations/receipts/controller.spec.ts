import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../../../lib/base.repo';
import { DB_TEST_LOCKS, useExclusiveDbLock } from '../../../lib/test-utils/exclusive-db-lock';
import { DonationsController } from '../controller';
import { ReceiptsRepo } from '../repositories/receipts.repo';
import { DonationReceiptsController } from './controller';

// Issue flows commit real transactions against the shared Postgres (the counter's row lock IS
// the thing under test), so this file takes the receipt-counter lock and cleans up per test.
useExclusiveDbLock(DB_TEST_LOCKS.RECEIPT_COUNTERS);

const rand = () => String(Math.floor(Math.random() * 100000000) + 1000000);

async function cleanTenant(db: any, tenantId: string) {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();
  for (const table of [
    'background_jobs',
    'donation_receipt_items',
    'donation_receipts',
    'receipt_counters',
    'receipt_statement_runs',
    'donations',
    'settings',
    'persons',
    'households',
    'campaigns',
    'user_activity',
    'authusers',
  ]) {
    await db.deleteFrom(table).where('tenant_id', '=', tenantId).execute();
  }
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

/** CRA-complete receipts.* settings; individual tests unset keys to exercise the guards. */
async function seedReceiptSettings(db: any, tenantId: string, userId: string, overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    'receipts.regime': 'cra_charity',
    'receipts.mode': 'per_gift',
    'receipts.org_legal_name': 'Test Charity',
    'receipts.org_address': '1 Test Way, Ottawa, ON',
    'receipts.registration_number': '123456789 RR 0001',
    'receipts.place_of_issue': 'Ottawa',
    'receipts.signatory_name': 'Pat Signer',
    'receipts.signature_file_id': '1',
    'receipts.number_prefix': 'T',
    ...overrides,
  };
  await db
    .insertInto('settings')
    .values(
      Object.entries(values)
        .filter(([, v]) => v !== undefined)
        .map(([key, value]) => ({
          tenant_id: tenantId,
          key,
          value: JSON.stringify(value),
          createdby_id: userId,
          updatedby_id: userId,
        })),
    )
    .execute();
}

async function createSeed(db: any) {
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const householdId = rand();
  const personId = rand();

  await db.insertInto('tenants').values({ id: tenantId, name: 'Receipts Test Tenant' }).execute();
  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `receipts-${userId}@example.com`,
      password: 'password',
      first_name: 'Test',
      last_name: 'Admin',
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
  await db
    .insertInto('households')
    .values({
      id: householdId,
      tenant_id: tenantId,
      campaign_id: campaignId,
      street_num: '12',
      street1: 'Maple Ave',
      city: 'Ottawa',
      state: 'ON',
      zip: 'K1A 0A1',
      country: 'Canada',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db
    .updateTable('tenants')
    .set({ admin_id: userId, createdby_id: userId, placeholder_household_id: householdId })
    .where('id', '=', tenantId)
    .execute();
  await db
    .insertInto('persons')
    .values({
      id: personId,
      tenant_id: tenantId,
      campaign_id: campaignId,
      household_id: householdId,
      first_name: 'Dana',
      last_name: 'Donor',
      email: 'dana@example.com',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  return { tenantId, userId, campaignId, householdId, personId };
}

async function insertDonation(
  db: any,
  seed: { tenantId: string; campaignId: string; personId: string },
  amountCents: number,
  extras: Record<string, unknown> = {},
): Promise<string> {
  const row = await db
    .insertInto('donations')
    .values({
      tenant_id: seed.tenantId,
      campaign_id: seed.campaignId,
      person_id: seed.personId,
      amount: amountCents,
      status: 'succeeded',
      method: 'cash',
      first_name: 'Dana',
      last_name: 'Donor',
      email: 'dana@example.com',
      street: '12 Maple Ave',
      city: 'Ottawa',
      state: 'ON',
      zip: 'K1A 0A1',
      country: 'Canada',
      ...extras,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return String(row.id);
}

describe('DonationReceiptsController', () => {
  const controller = new DonationReceiptsController();
  const db = (BaseRepository as any)._db;
  let seed: Awaited<ReturnType<typeof createSeed>>;
  const auth = () => ({ tenant_id: seed.tenantId, user_id: seed.userId });

  beforeEach(async () => {
    seed = await createSeed(db);
    await seedReceiptSettings(db, seed.tenantId, seed.userId);
  });

  afterEach(async () => {
    await cleanTenant(db, seed.tenantId);
  });

  it('issues numbered receipts sequentially and refuses a second live receipt for the same gift', async () => {
    const d1 = await insertDonation(db, seed, 10000);
    const d2 = await insertDonation(db, seed, 5000);

    const r1 = await controller.issueReceipt(auth(), d1, {});
    const r2 = await controller.issueReceipt(auth(), d2, {});
    expect(r1.serial).toBe(1);
    expect(r2.serial).toBe(2);
    expect(r1.receipt_number).toMatch(/^T-\d{4}-00001$/);
    expect(r1.eligible_cents).toBe(10000);
    expect(r1.donor_address_line1).toBe('12 Maple Ave');

    await expect(controller.issueReceipt(auth(), d1, {})).rejects.toThrow(/already has a receipt/);
  });

  it('reuses a rolled-back serial — the sequence stays gap-free', async () => {
    const d1 = await insertDonation(db, seed, 10000);
    await controller.issueReceipt(auth(), d1, {});
    // Second issue on the same gift takes serial 2 inside its transaction, then rolls back.
    await expect(controller.issueReceipt(auth(), d1, {})).rejects.toThrow();
    const d2 = await insertDonation(db, seed, 2000);
    const r = await controller.issueReceipt(auth(), d2, {});
    expect(r.serial).toBe(2);
  });

  it('cancel keeps the receipt (with reason) and reissue prints/records both serials', async () => {
    const d1 = await insertDonation(db, seed, 10000);
    const original = await controller.issueReceipt(auth(), d1, {});

    const cancelled = await controller.cancelReceipt(auth(), original.id, 'Wrong donor address');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelled_reason).toBe('Wrong donor address');

    const successor = await controller.reissueReceipt(auth(), original.id);
    expect(successor.replaces_receipt_id).toBe(original.id);
    expect(successor.serial).toBe(2);
    expect(successor.status).toBe('issued');

    // Cancelling an already-cancelled receipt conflicts rather than double-writing.
    await expect(controller.cancelReceipt(auth(), original.id, 'again')).rejects.toThrow(/already cancelled/);
  });

  it('replacing a still-issued receipt requires a reason and cancels the predecessor', async () => {
    const d1 = await insertDonation(db, seed, 10000);
    const original = await controller.issueReceipt(auth(), d1, {});

    await expect(controller.reissueReceipt(auth(), original.id)).rejects.toThrow(/reason/i);

    const successor = await controller.reissueReceipt(auth(), original.id, 'Donor name misspelled');
    expect(successor.replaces_receipt_id).toBe(original.id);
    const predecessor = await db
      .selectFrom('donation_receipts')
      .select(['status', 'cancelled_reason'])
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', original.id)
      .executeTakeFirstOrThrow();
    expect(predecessor.status).toBe('cancelled');
    expect(predecessor.cancelled_reason).toBe('Donor name misspelled');
  });

  it('blocks issuance when settings are incomplete, Quebec, or an Ontario candidate campaign', async () => {
    const d1 = await insertDonation(db, seed, 10000);

    await db
      .deleteFrom('settings')
      .where('tenant_id', '=', seed.tenantId)
      .where('key', '=', 'receipts.regime')
      .execute();
    await expect(controller.issueReceipt(auth(), d1, {})).rejects.toThrow(/regime/i);

    await db.deleteFrom('settings').where('tenant_id', '=', seed.tenantId).where('key', 'like', 'receipts.%').execute();
    await seedReceiptSettings(db, seed.tenantId, seed.userId, {
      'receipts.regime': 'political_qc',
    });
    await expect(controller.issueReceipt(auth(), d1, {})).rejects.toThrow(/Élections Québec/);

    await db.deleteFrom('settings').where('tenant_id', '=', seed.tenantId).where('key', 'like', 'receipts.%').execute();
    await seedReceiptSettings(db, seed.tenantId, seed.userId, {
      'receipts.regime': 'political_on',
      'receipts.agent_name': 'CFO Person',
    });
    await db.updateTable('campaigns').set({ kind: 'election' }).where('id', '=', seed.campaignId).execute();
    await expect(controller.issueReceipt(auth(), d1, {})).rejects.toThrow(/Elections Ontario/);
  });

  /**
   * `receipts.electoral_district` is ONE value for the whole workspace, so a workspace running two
   * campaigns in two seats can only store one of them. The gift's own campaign knows its seat, so
   * `campaigns.seat_name` is what the receipt freezes; the workspace setting stays as the fallback.
   *
   * British Columbia is the regime that exercises this: it is the only one that asks for an
   * electoral district, and it asks only for candidate gifts — which are exactly the gifts that
   * have a campaign in hand. So the workspace setting is left empty here on purpose, and issuance
   * has to succeed on the campaign's answer alone.
   */
  it('freezes the campaign seat as the electoral district, falling back to the workspace setting', async () => {
    await db.deleteFrom('settings').where('tenant_id', '=', seed.tenantId).where('key', 'like', 'receipts.%').execute();
    await seedReceiptSettings(db, seed.tenantId, seed.userId, {
      'receipts.regime': 'political_bc',
      'receipts.agent_name': 'Financial Agent',
      'receipts.polling_day': '2026-10-17',
      'receipts.electoral_district': undefined, // deliberately unset: the campaign must answer
    });
    await db
      .updateTable('campaigns')
      .set({ kind: 'election', jurisdiction: 'ca_provincial', office_region: 'BC', seat_name: 'Vancouver-Point Grey' })
      .where('id', '=', seed.campaignId)
      .execute();

    const d1 = await insertDonation(db, seed, 10000);
    const fromCampaign = await controller.issueReceipt(auth(), d1, {});
    const snapshot = await db
      .selectFrom('donation_receipts')
      .select('issuer_snapshot')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', fromCampaign.id)
      .executeTakeFirstOrThrow();
    expect(snapshot.issuer_snapshot.electoral_district).toBe('Vancouver-Point Grey');

    // Same regime, a campaign with no seat of its own: the workspace setting is used instead.
    await db.updateTable('campaigns').set({ seat_name: null }).where('id', '=', seed.campaignId).execute();
    await db
      .insertInto('settings')
      .values({
        tenant_id: seed.tenantId,
        key: 'receipts.electoral_district',
        value: JSON.stringify('Burnaby North'),
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .execute();

    const d2 = await insertDonation(db, seed, 5000);
    const fromWorkspace = await controller.issueReceipt(auth(), d2, {});
    const fallbackSnapshot = await db
      .selectFrom('donation_receipts')
      .select('issuer_snapshot')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', fromWorkspace.id)
      .executeTakeFirstOrThrow();
    expect(fallbackSnapshot.issuer_snapshot.electoral_district).toBe('Burnaby North');

    // The first receipt was frozen at issue time and is untouched by any of the above.
    const firstAgain = await db
      .selectFrom('donation_receipts')
      .select('issuer_snapshot')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', fromCampaign.id)
      .executeTakeFirstOrThrow();
    expect(firstAgain.issuer_snapshot.electoral_district).toBe('Vancouver-Point Grey');
  });

  /**
   * A facsimile signature is prescribed by every printing regime, but whether to print one is the
   * issuing organization's decision, not ours. The product reports the empty field and issues the
   * receipt anyway, with the signatory's printed name in place of the image.
   */
  it('issues without a signature image, reporting it as advice rather than blocking', async () => {
    await db
      .deleteFrom('settings')
      .where('tenant_id', '=', seed.tenantId)
      .where('key', '=', 'receipts.signature_file_id')
      .execute();

    const status = await controller.getReceiptSettingsStatus(seed.tenantId);
    expect(status.complete).toBe(true);
    expect(status.missing).toHaveLength(0);
    expect(status.advisory).toEqual(['signature image']);
    expect(status.advisoryMessage).toMatch(/still issue/i);

    const donationId = await insertDonation(db, seed, 10000);
    const receipt = await controller.issueReceipt(auth(), donationId, {});
    expect(receipt.receipt_number).toBeTruthy();
  });

  it('holds a legacy gift with no address anywhere as "needs donor address"', async () => {
    // Strip both address sources: the donation snapshot and the household.
    const d1 = await insertDonation(db, seed, 10000, { street: null, city: null, zip: null });
    await db
      .updateTable('households')
      .set({ street_num: null, street1: null, city: null })
      .where('id', '=', seed.householdId)
      .execute();
    await expect(controller.issueReceipt(auth(), d1, {})).rejects.toThrow(/mailing address/);
  });

  it('refuses a refunded gift and validates the advantage', async () => {
    const refunded = await insertDonation(db, seed, 10000, { status: 'refunded' });
    await expect(controller.issueReceipt(auth(), refunded, {})).rejects.toThrow(/refunded or disputed/);

    const d1 = await insertDonation(db, seed, 10000);
    await expect(controller.issueReceipt(auth(), d1, { advantageCents: 10000 })).rejects.toThrow(/advantage/i);
    const r = await controller.issueReceipt(auth(), d1, { advantageCents: 2500, advantageDescription: 'Dinner' });
    expect(r.eligible_cents).toBe(7500);
  });

  it('cumulative receipts gather only un-receipted succeeded gifts', async () => {
    const d1 = await insertDonation(db, seed, 10000);
    const d2 = await insertDonation(db, seed, 5000);
    await insertDonation(db, seed, 7000, { status: 'refunded' });
    await controller.issueReceipt(auth(), d1, {});

    const year = new Date().getFullYear();
    const cumulative = await controller.issueCumulativeReceipt(auth(), seed.personId, year, {});
    expect(cumulative.kind).toBe('cumulative');
    expect(cumulative.amount_cents).toBe(5000); // only d2 — d1 receipted, d3 refunded

    const items = await db
      .selectFrom('donation_receipt_items')
      .select('donation_id')
      .where('tenant_id', '=', seed.tenantId)
      .where('receipt_id', '=', cumulative.id)
      .execute();
    expect(items.map((i: { donation_id: string }) => String(i.donation_id))).toEqual([d2]);

    await expect(controller.issueCumulativeReceipt(auth(), seed.personId, year, {})).rejects.toThrow(/already covered/);
  });

  it('reverseDonation cancels a per-gift receipt; a won chargeback does not auto-reissue', async () => {
    const paymentIntentId = `pi_test_${seed.tenantId}`;
    const d1 = await insertDonation(db, seed, 10000, { stripe_payment_intent_id: paymentIntentId });
    const receipt = await controller.issueReceipt(auth(), d1, {});

    const donations = new DonationsController();
    await donations.reverseDonation(seed.tenantId, seed.userId, {
      paymentIntentId,
      invoiceId: null,
      status: 'disputed',
    });
    const afterReverse = await db
      .selectFrom('donation_receipts')
      .select(['status', 'cancelled_reason'])
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', receipt.id)
      .executeTakeFirstOrThrow();
    expect(afterReverse.status).toBe('cancelled');
    expect(afterReverse.cancelled_reason).toContain('disputed');

    await donations.restoreDisputedDonation(seed.tenantId, seed.userId, { paymentIntentId, invoiceId: null });
    const afterRestore = await db
      .selectFrom('donation_receipts')
      .select('status')
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', receipt.id)
      .executeTakeFirstOrThrow();
    expect(afterRestore.status).toBe('cancelled'); // serial burned; reissue is a human decision
  });

  it('reverseDonation flags a cumulative receipt for reissue instead of silently shrinking it', async () => {
    const paymentIntentId = `pi_cumul_${seed.tenantId}`;
    await insertDonation(db, seed, 10000);
    await insertDonation(db, seed, 5000, { stripe_payment_intent_id: paymentIntentId });
    const cumulative = await controller.issueCumulativeReceipt(auth(), seed.personId, new Date().getFullYear(), {});
    expect(cumulative.amount_cents).toBe(15000);

    await new DonationsController().reverseDonation(seed.tenantId, seed.userId, {
      paymentIntentId,
      invoiceId: null,
      status: 'refunded',
    });
    const flagged = await db
      .selectFrom('donation_receipts')
      .select(['status', 'reissue_required'])
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', cumulative.id)
      .executeTakeFirstOrThrow();
    expect(flagged.status).toBe('cancelled');
    expect(flagged.reissue_required).toBe(true);

    // Reissue rebuilds from the surviving gift only.
    const successor = await controller.reissueReceipt(auth(), cumulative.id);
    expect(successor.amount_cents).toBe(10000);
    expect(successor.replaces_receipt_id).toBe(cumulative.id);
  });

  it('generateStatementForDonor is idempotent per donor-year and statements carry no serial', async () => {
    await insertDonation(db, seed, 10000);
    const year = new Date().getFullYear();

    const statement = await controller.generateStatementForDonor(seed.tenantId, seed.personId, year, seed.userId);
    expect(statement).not.toBeNull();
    expect(statement?.kind).toBe('statement');
    expect(statement?.serial).toBeNull();
    expect(statement?.receipt_number).toBeNull();

    const again = await controller.generateStatementForDonor(seed.tenantId, seed.personId, year, seed.userId);
    expect(again).toBeNull(); // unique live statement per donor-year

    const status = await controller.getReceiptSettingsStatus(seed.tenantId);
    expect(status.complete).toBe(true);
  });

  // ── Acknowledgements ────────────────────────────────────────────────────────

  /**
   * The point of the whole acknowledgement path: a workspace with NOTHING configured still thanks
   * its donors. This deletes every receipts.* setting first, which is the state a municipal campaign
   * or a United States committee is in permanently.
   */
  it('acknowledges a gift in a workspace with no receipting settings at all', async () => {
    await db.deleteFrom('settings').where('tenant_id', '=', seed.tenantId).where('key', 'like', 'receipts.%').execute();
    const donationId = await insertDonation(db, seed, 4200);

    const { receipt } = await controller.issueAcknowledgement(seed.tenantId, donationId, seed.userId);
    expect(receipt?.kind).toBe('acknowledgement');
    expect(receipt?.regime).toBeNull();
    expect(receipt?.receipt_number).toMatch(/^A-\d{4}-00001$/);
    expect(receipt?.amount_cents).toBe(4200);
    expect(receipt?.eligible_cents).toBe(4200);

    // The render+email job is written in the same transaction as the acknowledgement.
    const jobs = await db
      .selectFrom('background_jobs')
      .select('payload')
      .where('tenant_id', '=', seed.tenantId)
      .execute();
    expect(jobs.some((j: { payload: unknown }) => JSON.stringify(j.payload).includes('render-receipt-pdf'))).toBe(true);
  });

  /** Issued once per gift; the job may run twice and must not produce two documents. */
  it('acknowledges a gift only once', async () => {
    const donationId = await insertDonation(db, seed, 1000);
    const first = await controller.issueAcknowledgement(seed.tenantId, donationId, seed.userId);
    const second = await controller.issueAcknowledgement(seed.tenantId, donationId, seed.userId);
    expect(second.receipt?.id).toBe(first.receipt?.id);
  });

  /** An acknowledgement needs no mailing address; a tax receipt for the same gift still does. */
  it('acknowledges a donor with no address on file, where a tax receipt is refused', async () => {
    // Both address sources stripped: the donation's own snapshot and the donor's household.
    const donationId = await insertDonation(db, seed, 9000, {
      street: null,
      city: null,
      state: null,
      zip: null,
      country: null,
    });
    await db
      .updateTable('households')
      .set({ street_num: null, street1: null, city: null })
      .where('id', '=', seed.householdId)
      .execute();

    const { receipt } = await controller.issueAcknowledgement(seed.tenantId, donationId, seed.userId);
    expect(receipt).not.toBeNull();
    expect(receipt?.donor_address_line1).toBeNull();
    await expect(controller.issueReceipt(auth(), donationId, {})).rejects.toThrow(/no mailing address/);
  });

  /**
   * Acknowledgement numbering must not disturb the official run — an auditor reconciling a year
   * expects the tax-receipt serials to be 1, 2, 3 with nothing missing between them.
   */
  it('numbers acknowledgements from a separate counter, leaving tax-receipt serials untouched', async () => {
    const d1 = await insertDonation(db, seed, 10000);
    const d2 = await insertDonation(db, seed, 20000);
    await controller.issueAcknowledgement(seed.tenantId, d1, seed.userId);
    await controller.issueAcknowledgement(seed.tenantId, d2, seed.userId);

    const r1 = await controller.issueReceipt(auth(), d1, {});
    const r2 = await controller.issueReceipt(auth(), d2, {});
    expect(r1.serial).toBe(1);
    expect(r2.serial).toBe(2);

    const counters = await db
      .selectFrom('receipt_counters')
      .select(['kind', 'n'])
      .where('tenant_id', '=', seed.tenantId)
      .orderBy('kind', 'asc')
      .execute();
    expect(counters).toEqual([
      { kind: 'acknowledgement', n: 2 },
      { kind: 'official', n: 2 },
    ]);
  });

  /**
   * The backfill's two requirements: it finds the gifts nothing has acknowledged, and it does not
   * mail anyone. A donor receiving a receipt for a gift from four months ago would be worse than
   * the gap being filled, so the stored render job must carry email:false.
   */
  it('backfills an old gift without emailing the donor', async () => {
    const donationId = await insertDonation(db, seed, 7700);
    const repo = new ReceiptsRepo();

    const pending = await repo.listUnacknowledgedDonations(seed.tenantId, null, 100);
    expect(pending.map((g) => String(g.id))).toEqual([donationId]);

    const { receipt } = await controller.issueAcknowledgement(seed.tenantId, donationId, seed.userId, {
      email: false,
    });
    expect(receipt).not.toBeNull();

    const jobs = await db
      .selectFrom('background_jobs')
      .select('payload')
      .where('tenant_id', '=', seed.tenantId)
      .execute();
    const renderJobs = jobs
      .map((j: { payload: unknown }) => j.payload as { type?: string; email?: boolean })
      .filter((p) => p.type === 'render-receipt-pdf');
    expect(renderJobs).toHaveLength(1);
    expect(renderJobs[0].email).toBe(false);

    // Acknowledged now, so a second sweep has nothing left to do.
    expect(await repo.listUnacknowledgedDonations(seed.tenantId, null, 100)).toHaveLength(0);
  });

  /** A gift that already carries an acknowledgement is still un-receipted for tax purposes. */
  it('does not let an acknowledgement count as tax-receipt coverage', async () => {
    const donationId = await insertDonation(db, seed, 12000);
    await controller.issueAcknowledgement(seed.tenantId, donationId, seed.userId);

    const cumulative = await controller.issueCumulativeReceipt(auth(), seed.personId, new Date().getFullYear(), {});
    expect(cumulative.amount_cents).toBe(12000);
  });

  it('cancels the acknowledgement when the gift is refunded', async () => {
    const paymentIntentId = `pi_ack_${seed.tenantId}`;
    const donationId = await insertDonation(db, seed, 3000, { stripe_payment_intent_id: paymentIntentId });
    const { receipt } = await controller.issueAcknowledgement(seed.tenantId, donationId, seed.userId);

    await new DonationsController().reverseDonation(seed.tenantId, seed.userId, {
      paymentIntentId,
      invoiceId: null,
      status: 'refunded',
    });
    const after = await db
      .selectFrom('donation_receipts')
      .select(['status', 'cancelled_reason', 'reissue_required'])
      .where('tenant_id', '=', seed.tenantId)
      .where('id', '=', receipt?.id)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe('cancelled');
    expect(after.reissue_required).toBe(false);
    expect(after.cancelled_reason).toContain('refunded');
  });

  // ── Year-end run ────────────────────────────────────────────────────────────

  /**
   * The per-donor choice the year-end batch makes. Both donors are in one fully configured
   * workspace; only the second lacks a mailing address, and only that one falls back to a summary.
   * A workspace-level decision would give them both the same document, which is the bug this guards.
   */
  it('gives an addressed donor a tax receipt and an unaddressed one a summary, in the same run', async () => {
    const year = new Date().getFullYear();
    await insertDonation(db, seed, 15000);

    // persons.household_id is NOT NULL, so "no address" means a household with no street or city.
    const otherHouseholdId = rand();
    const otherPersonId = rand();
    await db
      .insertInto('households')
      .values({
        id: otherHouseholdId,
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .execute();
    await db
      .insertInto('persons')
      .values({
        id: otherPersonId,
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        household_id: otherHouseholdId,
        first_name: 'Nomail',
        last_name: 'Address',
        email: 'nomail@example.com',
        createdby_id: seed.userId,
        updatedby_id: seed.userId,
      })
      .execute();
    await db
      .insertInto('donations')
      .values({
        tenant_id: seed.tenantId,
        campaign_id: seed.campaignId,
        person_id: otherPersonId,
        amount: 2500,
        status: 'succeeded',
        method: 'cash',
        first_name: 'Nomail',
        last_name: 'Address',
        email: 'nomail@example.com',
      })
      .execute();

    const issuance = await controller.cumulativeIssuanceSettings(seed.tenantId);
    expect(issuance).not.toBeNull();

    const addressed = await controller.generateYearEndDocumentForDonor(
      seed.tenantId,
      seed.personId,
      year,
      seed.userId,
      issuance,
    );
    const unaddressed = await controller.generateYearEndDocumentForDonor(
      seed.tenantId,
      otherPersonId,
      year,
      seed.userId,
      issuance,
    );

    expect(addressed?.kind).toBe('cumulative');
    expect(addressed?.receipt_number).toMatch(/^T-\d{4}-\d{5}$/);
    expect(unaddressed?.kind).toBe('statement');
    expect(unaddressed?.serial).toBeNull();
  });

  /** No regime configured is a normal state, and those donors must still get their summary. */
  it('sends summaries from a workspace with no receipting regime', async () => {
    await db.deleteFrom('settings').where('tenant_id', '=', seed.tenantId).where('key', 'like', 'receipts.%').execute();
    await insertDonation(db, seed, 6000);
    const year = new Date().getFullYear();

    expect(await controller.cumulativeIssuanceSettings(seed.tenantId)).toBeNull();
    const doc = await controller.generateYearEndDocumentForDonor(seed.tenantId, seed.personId, year, seed.userId, null);
    expect(doc?.kind).toBe('statement');
    expect(doc?.regime).toBeNull();
  });
});
