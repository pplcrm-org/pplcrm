import { env } from '../../../env';
import { BadRequestError, NotFoundError, PreconditionFailedError } from '../../errors/app-errors';
import { getStripe, isMockMode } from '../../lib/stripe-platform-client';
import { getConnectedAccountId } from '../donations/stripe-connect';
import { DonationsController, isAlreadyCancelledInStripe } from '../donations/controller';
import { HouseholdsController } from '../households/controller';
import { WorkflowsController } from '../workflows/controller';
import { BaseRepository } from '../../lib/base.repo';
import { PortalLinksRepo, type MintedPortalLink, type ResolvedPortalLink } from './repositories/portal-links.repo';
import { publicOrgName } from '../../lib/public-tenant';
import { signedFileDownloadUrl } from '../../lib/signed-download';
import { assertPlanFeature } from '../billing/plan-gate';
import { logger } from '../../logger';
import { donorPortalUrl, withParam } from './portal-url';
import type { IAuthKeyPayload } from '@common';

/** What the /g/:token page renders. Everything in here is the donor's OWN data only. */
export interface DonorPortalSummary {
  org_name: string;
  first_name: string | null;
  donations: Array<{
    id: string;
    amount_cents: number;
    date: string;
    method: string;
    status: string;
    refunded_at: string | null;
  }>;
  pledges: Array<{
    id: string;
    monthly_amount_cents: number;
    status: string;
    started_at: string;
    next_billing_date: string | null;
    cancelled_at: string | null;
    can_manage_card: boolean;
  }>;
  receipts: Array<{ id: string; kind: string; number: string | null; year: number | null; pdf_ready: boolean }>;
  address: { street: string; apt: string; city: string; state: string; zip: string; country: string } | null;
  address_shared: boolean;
  subscriptions: Array<{ campaign_id: string; campaign_name: string; status: string }>;
  email_suppressed: boolean;
  volunteer_interest: boolean;
  yard_sign: { status: string } | null;
}

/**
 * The donor self-service portal: everything behind /g/:token. The bearer token resolves the
 * tenant AND the person (PortalLinksRepo.resolveByToken); every query below is then scoped by
 * that resolved tenant_id. Donor-initiated writes are attributed to the workspace's admin user
 * (tenants.admin_id — the same fallback actor the Stripe webhook worker uses), with activity
 * strings that name the portal so the history stays honest about who really acted.
 */
export class DonorPortalController {
  private readonly linksRepo = new PortalLinksRepo();
  private readonly donationsController = new DonationsController();

  private get db() {
    return BaseRepository.dbInstance;
  }

  public resolveToken(token: string): Promise<ResolvedPortalLink | null> {
    return this.linksRepo.resolveByToken(token);
  }

  /** The system actor for donor-initiated writes. */
  private async adminUserId(tenantId: string): Promise<string> {
    const row = await this.db.selectFrom('tenants').select('admin_id').where('id', '=', tenantId).executeTakeFirst();
    if (!row?.admin_id) throw new NotFoundError('Workspace not found.');
    return String(row.admin_id);
  }

  private async logDonorActivity(tenantId: string, personId: string, text: string): Promise<void> {
    try {
      const actor = await this.adminUserId(tenantId);
      await this.db
        .insertInto('user_activity')
        .values({
          tenant_id: tenantId,
          user_id: actor,
          activity: text,
          entity: 'persons',
          entity_id: personId,
          quantity: 1,
          createdby_id: actor,
          updatedby_id: actor,
        })
        .execute();
    } catch (err) {
      logger.error({ err, tenantId, personId }, '[donor-portal] Failed to write activity log entry');
    }
  }

  // ── The summary read ────────────────────────────────────────────────────────

  public async getSummary(link: ResolvedPortalLink): Promise<DonorPortalSummary> {
    const { tenant_id, person_id } = link;

    const person = await this.db
      .selectFrom('persons')
      .select(['id', 'first_name', 'email', 'household_id', 'volunteer_status'])
      .where('tenant_id', '=', tenant_id)
      .where('id', '=', person_id)
      .executeTakeFirst();
    if (!person) throw new NotFoundError('Not found.');

    const [orgName, donations, pledges, receipts] = await Promise.all([
      publicOrgName(tenant_id),
      this.db
        .selectFrom('donations')
        .select(['id', 'amount', 'method', 'status', 'created_at', 'refunded_at'])
        .where('tenant_id', '=', tenant_id)
        .where('person_id', '=', person_id)
        .orderBy('created_at', 'desc')
        .execute(),
      this.db
        .selectFrom('donation_pledges')
        .select([
          'id',
          'monthly_amount',
          'status',
          'started_at',
          'next_billing_date',
          'cancelled_at',
          'stripe_customer_id',
          'stripe_subscription_id',
        ])
        .where('tenant_id', '=', tenant_id)
        .where('person_id', '=', person_id)
        .orderBy('created_at', 'desc')
        .execute(),
      // Donors see current documents only — a cancelled receipt is a staff-ledger fact.
      this.db
        .selectFrom('donation_receipts')
        .select(['id', 'kind', 'receipt_number', 'year', 'coverage_year', 'file_id'])
        .where('tenant_id', '=', tenant_id)
        .where('person_id', '=', person_id)
        .where('status', '=', 'issued')
        .orderBy('issued_at', 'desc')
        .execute(),
    ]);

    // Address: the person's household, unless it is the workspace's placeholder ("no real
    // address"). address_shared tells the page the address belongs to more than one person,
    // so the form can say an edit moves only this donor to a new household.
    const tenantRow = await this.db
      .selectFrom('tenants')
      .select(['placeholder_household_id'])
      .where('id', '=', tenant_id)
      .executeTakeFirst();
    const placeholderId = tenantRow?.placeholder_household_id ? String(tenantRow.placeholder_household_id) : null;
    let address: DonorPortalSummary['address'] = null;
    let addressShared = false;
    const householdId = person.household_id ? String(person.household_id) : null;
    if (householdId && householdId !== placeholderId) {
      const hh = await this.db
        .selectFrom('households')
        .select(['street_num', 'street1', 'apt', 'city', 'state', 'zip', 'country'])
        .where('tenant_id', '=', tenant_id)
        .where('id', '=', householdId)
        .executeTakeFirst();
      if (hh) {
        address = {
          street: [hh.street_num, hh.street1].filter(Boolean).join(' '),
          apt: hh.apt ?? '',
          city: hh.city ?? '',
          state: hh.state ?? '',
          zip: hh.zip ?? '',
          country: hh.country ?? '',
        };
        const members = await this.db
          .selectFrom('persons')
          .select(({ fn }) => [fn.countAll<string>().as('n')])
          .where('tenant_id', '=', tenant_id)
          .where('household_id', '=', householdId)
          .executeTakeFirst();
        addressShared = Number(members?.n ?? 0) > 1;
      }
    }

    const subscriptions = await this.db
      .selectFrom('campaign_subscriptions')
      .innerJoin('campaigns', 'campaigns.id', 'campaign_subscriptions.campaign_id')
      .select([
        'campaign_subscriptions.campaign_id',
        'campaigns.name as campaign_name',
        'campaign_subscriptions.status',
      ])
      .where('campaign_subscriptions.tenant_id', '=', tenant_id)
      .where('campaign_subscriptions.person_id', '=', person_id)
      .execute();

    const suppressed = person.email
      ? await this.db
          .selectFrom('email_suppressions')
          .select('id')
          .where('tenant_id', '=', tenant_id)
          .where('email', '=', String(person.email).toLowerCase())
          .executeTakeFirst()
      : undefined;

    const yardSign =
      householdId && householdId !== placeholderId
        ? await this.db
            .selectFrom('delivery_requests')
            .select(['status'])
            .where('tenant_id', '=', tenant_id)
            .where('household_id', '=', householdId)
            .where('status', 'in', ['new', 'approved', 'delivered'])
            .orderBy('created_at', 'desc')
            .executeTakeFirst()
        : undefined;

    return {
      org_name: orgName,
      first_name: person.first_name ?? null,
      donations: donations.map((d) => ({
        id: String(d.id),
        amount_cents: Number(d.amount),
        date: new Date(d.created_at as unknown as string).toISOString(),
        method: String(d.method),
        status: String(d.status),
        refunded_at: d.refunded_at ? new Date(d.refunded_at as unknown as string).toISOString() : null,
      })),
      pledges: pledges.map((p) => ({
        id: String(p.id),
        monthly_amount_cents: Number(p.monthly_amount),
        status: String(p.status),
        started_at: new Date(p.started_at as unknown as string).toISOString(),
        next_billing_date: p.next_billing_date ? String(p.next_billing_date) : null,
        cancelled_at: p.cancelled_at ? new Date(p.cancelled_at as unknown as string).toISOString() : null,
        can_manage_card:
          !!p.stripe_customer_id &&
          !!p.stripe_subscription_id &&
          !String(p.stripe_subscription_id).startsWith('sub_mock_'),
      })),
      receipts: receipts.map((r) => ({
        id: String(r.id),
        kind: String(r.kind),
        number: r.receipt_number ? String(r.receipt_number) : null,
        year: r.coverage_year != null ? Number(r.coverage_year) : r.year != null ? Number(r.year) : null,
        pdf_ready: r.file_id != null,
      })),
      address,
      address_shared: addressShared,
      subscriptions: subscriptions.map((s) => ({
        campaign_id: String(s.campaign_id),
        campaign_name: String(s.campaign_name),
        status: String(s.status),
      })),
      email_suppressed: !!suppressed,
      volunteer_interest: person.volunteer_status != null,
      yard_sign: yardSign ? { status: String(yardSign.status) } : null,
    };
  }

  /** Fire-and-forget usage stamp — telemetry for the staff panel, never on the request path. */
  public touchLastUsed(link: ResolvedPortalLink): void {
    void this.linksRepo.touchLastUsed({ id: link.id, tenant_id: link.tenant_id }).catch((err) => {
      logger.warn({ err }, '[donor-portal] touchLastUsed failed');
    });
  }

  // ── Receipt download ────────────────────────────────────────────────────────

  public async receiptDownload(
    link: ResolvedPortalLink,
    receiptId: string,
  ): Promise<{ url: string } | { status: 'not_ready' } | null> {
    const receipt = await this.db
      .selectFrom('donation_receipts')
      .select(['id', 'person_id', 'file_id', 'status'])
      .where('tenant_id', '=', link.tenant_id)
      .where('id', '=', receiptId)
      .executeTakeFirst();
    // Another person's receipt id is indistinguishable from a missing one — uniform null → 404.
    if (!receipt || String(receipt.person_id) !== link.person_id || receipt.status !== 'issued') return null;
    if (!receipt.file_id) return { status: 'not_ready' };
    return { url: signedFileDownloadUrl(String(receipt.file_id), link.tenant_id) };
  }

  // ── Pledge management ───────────────────────────────────────────────────────

  private async ownedPledge(link: ResolvedPortalLink, pledgeId: string) {
    const pledge = await this.db
      .selectFrom('donation_pledges')
      .selectAll()
      .where('tenant_id', '=', link.tenant_id)
      .where('id', '=', pledgeId)
      .executeTakeFirst();
    if (!pledge || String(pledge.person_id ?? '') !== link.person_id) return null;
    return pledge;
  }

  /**
   * Donor-initiated cancel. Same ordering rule as the staff cancel (DonationsController.
   * cancelPledge): Stripe stops charging FIRST, the row is marked cancelled second — saying
   * "cancelled" while the card is still billed monthly is the worst outcome. Deliberately
   * ungated by plan: a downgraded workspace must never trap a donor in a subscription.
   */
  public async cancelPledge(link: ResolvedPortalLink, pledgeId: string): Promise<{ status: 'cancelled' } | null> {
    const pledge = await this.ownedPledge(link, pledgeId);
    if (!pledge) return null;
    if (pledge.status === 'cancelled') return { status: 'cancelled' }; // idempotent on refresh

    if (pledge.stripe_subscription_id && !pledge.stripe_subscription_id.startsWith('sub_mock_') && !isMockMode) {
      const accountId = await getConnectedAccountId(link.tenant_id);
      if (!accountId) {
        throw new PreconditionFailedError(
          'This monthly gift could not be stopped automatically. Please contact the organization directly.',
        );
      }
      try {
        await getStripe().subscriptions.cancel(pledge.stripe_subscription_id, {}, { stripeAccount: accountId });
      } catch (err) {
        if (!isAlreadyCancelledInStripe(err)) {
          logger.error({ err }, '[donor-portal] Stripe subscription cancel failed');
          throw new PreconditionFailedError(
            'The payment provider did not confirm the cancellation. Try again in a minute.',
            undefined,
            { cause: err },
          );
        }
      }
    }

    const actor = await this.adminUserId(link.tenant_id);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('donation_pledges')
        .set({ status: 'cancelled', cancelled_at: new Date(), updatedby_id: actor, updated_at: new Date() })
        .where('tenant_id', '=', link.tenant_id)
        .where('id', '=', pledgeId)
        .execute();
      // Transactional outbox: the staff notification exists only if the cancel committed.
      await trx
        .insertInto('background_jobs')
        .values({
          tenant_id: link.tenant_id,
          queue: 'default',
          status: 'pending',
          payload: JSON.stringify({
            type: 'notify-donor-pledge-cancelled',
            tenant_id: link.tenant_id,
            pledge_id: pledgeId,
            source: 'portal',
          }),
          run_at: new Date(),
          max_attempts: 3,
        })
        .execute();
    });
    await this.logDonorActivity(
      link.tenant_id,
      link.person_id,
      `Donor cancelled their $${Number(pledge.monthly_amount) / 100}/month gift via the donor portal`,
    );
    return { status: 'cancelled' };
  }

  /** Change the monthly amount on the live Stripe subscription; DB write only after Stripe. */
  public async changePledgeAmount(
    link: ResolvedPortalLink,
    pledgeId: string,
    monthlyAmountCents: number,
  ): Promise<{ status: 'ok'; monthly_amount_cents: number } | null> {
    if (!Number.isInteger(monthlyAmountCents) || monthlyAmountCents < 100 || monthlyAmountCents > 100_000_00) {
      throw new BadRequestError('Enter an amount between $1 and $100,000.');
    }
    const pledge = await this.ownedPledge(link, pledgeId);
    if (!pledge) return null;
    if (pledge.status !== 'active' && pledge.status !== 'past_due') {
      throw new PreconditionFailedError('This monthly gift is no longer active, so its amount cannot change.');
    }

    // Contribution-limit + residency gate, exactly as a new recurring gift would be checked.
    if (monthlyAmountCents > Number(pledge.monthly_amount)) {
      const eligibility = await this.donationsController.checkEligibility(
        link.tenant_id,
        link.person_id,
        monthlyAmountCents - Number(pledge.monthly_amount),
        { state: pledge.state ?? undefined, country: pledge.country ?? undefined },
        { isRecurring: true, remainingMonths: 12 },
      );
      if (!eligibility.eligible) throw new BadRequestError(eligibility.reason);
    }

    if (pledge.stripe_subscription_id && !pledge.stripe_subscription_id.startsWith('sub_mock_') && !isMockMode) {
      const accountId = await getConnectedAccountId(link.tenant_id);
      if (!accountId) {
        throw new PreconditionFailedError('The payment provider is not connected; the amount cannot change right now.');
      }
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(pledge.stripe_subscription_id, {}, { stripeAccount: accountId });
      const item = sub.items?.data?.[0];
      const currency = item?.price?.currency ?? 'cad';
      if (!item) throw new PreconditionFailedError('The subscription could not be loaded from the payment provider.');
      // Subscription-item price_data requires the existing product id; checkout's inline
      // price_data created one, so a live pledge always has it.
      const productId = typeof item.price?.product === 'string' ? item.price.product : item.price?.product?.id;
      if (!productId) {
        throw new PreconditionFailedError('The subscription could not be loaded from the payment provider.');
      }
      await stripe.subscriptions.update(
        pledge.stripe_subscription_id,
        {
          items: [
            {
              id: item.id,
              price_data: {
                currency,
                product: productId,
                unit_amount: monthlyAmountCents,
                recurring: { interval: 'month' },
              },
              quantity: 1,
            },
          ],
          proration_behavior: 'none',
          // Subscription-level fee survives an items update, but re-sending it keeps the
          // platform fee explicit and immune to drift — same value checkout set.
          ...(env.donationsPlatformFeePercent > 0 ? { application_fee_percent: env.donationsPlatformFeePercent } : {}),
        },
        { stripeAccount: accountId },
      );
    }

    const actor = await this.adminUserId(link.tenant_id);
    await this.db
      .updateTable('donation_pledges')
      .set({ monthly_amount: monthlyAmountCents, updatedby_id: actor, updated_at: new Date() })
      .where('tenant_id', '=', link.tenant_id)
      .where('id', '=', pledgeId)
      .execute();
    await this.logDonorActivity(
      link.tenant_id,
      link.person_id,
      `Donor changed their monthly gift from $${Number(pledge.monthly_amount) / 100} to $${monthlyAmountCents / 100} via the donor portal`,
    );
    return { status: 'ok', monthly_amount_cents: monthlyAmountCents };
  }

  /** Stripe-hosted card update: Checkout in setup mode on the connected account. `rawToken` is
   *  the donor's own bearer token, needed to build the return URL back to their page. */
  public async startCardUpdate(
    link: ResolvedPortalLink,
    pledgeId: string,
    rawToken: string,
  ): Promise<{ url: string } | null> {
    const pledge = await this.ownedPledge(link, pledgeId);
    if (!pledge) return null;
    if (!pledge.stripe_customer_id || !pledge.stripe_subscription_id) {
      throw new PreconditionFailedError('This monthly gift is not billed by card, so there is no card to update.');
    }
    const tenant = await this.db
      .selectFrom('tenants')
      .select('slug')
      .where('id', '=', link.tenant_id)
      .executeTakeFirst();
    const portalUrl = donorPortalUrl(String(tenant?.slug ?? ''), rawToken);

    if (isMockMode || pledge.stripe_subscription_id.startsWith('sub_mock_')) {
      return { url: withParam(portalUrl, 'card_session_id', `cs_mock_setup_${pledgeId}`) };
    }
    const accountId = await getConnectedAccountId(link.tenant_id);
    if (!accountId) {
      throw new PreconditionFailedError('The payment provider is not connected; the card cannot be updated right now.');
    }
    const session = await getStripe().checkout.sessions.create(
      {
        mode: 'setup',
        customer: pledge.stripe_customer_id,
        payment_method_types: ['card'],
        metadata: { tenantId: link.tenant_id, pledgeId, purpose: 'donor_portal_card_update' },
        success_url: withParam(portalUrl, 'card_session_id', '{CHECKOUT_SESSION_ID}'),
        cancel_url: portalUrl,
      },
      { stripeAccount: accountId },
    );
    if (!session.url) throw new PreconditionFailedError('The payment provider did not return a page to open.');
    return { url: session.url };
  }

  /**
   * Confirm the setup session and point the subscription (and future invoices) at the new card.
   * The return URL carries only the session id, so the pledge is derived from the session's own
   * metadata — and then verified to belong to the token's person before anything is written.
   */
  public async confirmCardUpdate(link: ResolvedPortalLink, sessionId: string): Promise<{ status: 'ok' } | null> {
    if (isMockMode || sessionId.startsWith('cs_mock_setup_')) {
      const mockPledgeId = sessionId.replace(/^cs_mock_setup_/, '');
      const mockPledge = mockPledgeId ? await this.ownedPledge(link, mockPledgeId) : null;
      return mockPledge || isMockMode ? { status: 'ok' } : null;
    }

    const accountId = await getConnectedAccountId(link.tenant_id);
    if (!accountId) throw new PreconditionFailedError('The payment provider is not connected.');
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: accountId });
    const pledgeId = session.metadata?.['pledgeId'];
    if (
      session.mode !== 'setup' ||
      session.status !== 'complete' ||
      session.metadata?.['tenantId'] !== link.tenant_id ||
      !pledgeId
    ) {
      throw new BadRequestError('This card update could not be verified.');
    }
    const pledge = await this.ownedPledge(link, pledgeId);
    if (!pledge) return null;
    if (!pledge.stripe_customer_id || !pledge.stripe_subscription_id) return null;
    const setupIntentId = typeof session.setup_intent === 'string' ? session.setup_intent : session.setup_intent?.id;
    if (!setupIntentId) throw new BadRequestError('This card update could not be verified.');
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId, {}, { stripeAccount: accountId });
    const paymentMethod =
      typeof setupIntent.payment_method === 'string' ? setupIntent.payment_method : setupIntent.payment_method?.id;
    if (!paymentMethod) throw new BadRequestError('This card update could not be verified.');

    // Idempotent: re-confirming sets the same payment method again.
    await stripe.subscriptions.update(
      pledge.stripe_subscription_id,
      { default_payment_method: paymentMethod },
      { stripeAccount: accountId },
    );
    await stripe.customers.update(
      pledge.stripe_customer_id,
      { invoice_settings: { default_payment_method: paymentMethod } },
      { stripeAccount: accountId },
    );
    await this.logDonorActivity(
      link.tenant_id,
      link.person_id,
      'Donor updated the card behind their monthly gift via the donor portal',
    );
    return { status: 'ok' };
  }

  // ── Mailing address ─────────────────────────────────────────────────────────

  /**
   * Three-branch address write (the safest shape the house rules imply):
   *  - placeholder household → create a real household and move the person onto it;
   *  - household shared with other people → create a new household, move ONLY this person
   *    (a donor must never rewrite an address other contacts share);
   *  - sole member of a real household → update it in place (the households controller
   *    re-fingerprints and enqueues geocoding itself).
   */
  public async updateAddress(
    link: ResolvedPortalLink,
    input: { street: string; apt?: string; city: string; state: string; zip: string; country: string },
  ): Promise<{ status: 'ok' }> {
    const street = input.street.trim();
    const city = input.city.trim();
    const state = input.state.trim();
    const zip = input.zip.trim();
    const country = input.country.trim();
    const apt = (input.apt ?? '').trim();
    if (!street || !city || !country) throw new BadRequestError('Street, city and country are required.');

    const person = await this.db
      .selectFrom('persons')
      .select(['id', 'household_id'])
      .where('tenant_id', '=', link.tenant_id)
      .where('id', '=', link.person_id)
      .executeTakeFirst();
    if (!person) throw new NotFoundError('Not found.');

    const tenantRow = await this.db
      .selectFrom('tenants')
      .select(['placeholder_household_id'])
      .where('id', '=', link.tenant_id)
      .executeTakeFirst();
    const placeholderId = tenantRow?.placeholder_household_id ? String(tenantRow.placeholder_household_id) : null;
    const householdId = person.household_id ? String(person.household_id) : null;

    // No-op on an identical payload — safe on refresh, and no geocode job churn.
    if (householdId && householdId !== placeholderId) {
      const current = await this.db
        .selectFrom('households')
        .select(['street_num', 'street1', 'apt', 'city', 'state', 'zip', 'country'])
        .where('tenant_id', '=', link.tenant_id)
        .where('id', '=', householdId)
        .executeTakeFirst();
      if (current) {
        const currentStreet = [current.street_num, current.street1].filter(Boolean).join(' ');
        const same =
          currentStreet === street &&
          (current.apt ?? '') === apt &&
          (current.city ?? '') === city &&
          (current.state ?? '') === state &&
          (current.zip ?? '') === zip &&
          (current.country ?? '') === country;
        if (same) return { status: 'ok' };
      }
    }

    const actor = await this.adminUserId(link.tenant_id);
    const householdsController = new HouseholdsController();
    const auth: IAuthKeyPayload = { tenant_id: link.tenant_id, user_id: actor, session_id: 'donor-portal' };
    // The whole street line lands in street1 — the same shape the public web-form path writes;
    // fingerprintFull normalizes both spellings to one key.
    const payload = { street1: street, apt: apt || null, city, state, zip, country };

    let soleMember = false;
    if (householdId && householdId !== placeholderId) {
      const members = await this.db
        .selectFrom('persons')
        .select(({ fn }) => [fn.countAll<string>().as('n')])
        .where('tenant_id', '=', link.tenant_id)
        .where('household_id', '=', householdId)
        .executeTakeFirst();
      soleMember = Number(members?.n ?? 0) === 1;
    }

    if (soleMember && householdId) {
      await householdsController.update({
        tenant_id: link.tenant_id,
        id: householdId,
        row: { ...payload, street_num: null, updatedby_id: actor } as never,
      });
    } else {
      // addHousehold dedupes by address fingerprint, so "moving in with an existing
      // household" naturally reuses that household's row.
      const created = (await householdsController.addHousehold(payload as never, auth)) as { id?: unknown };
      const newId = created?.id ? String(created.id) : null;
      if (!newId) throw new BadRequestError('The address could not be saved.');
      await this.db
        .updateTable('persons')
        .set({ household_id: newId, updatedby_id: actor, updated_at: new Date() })
        .where('tenant_id', '=', link.tenant_id)
        .where('id', '=', link.person_id)
        .execute();
    }
    await this.logDonorActivity(
      link.tenant_id,
      link.person_id,
      'Donor updated their mailing address via the donor portal',
    );
    return { status: 'ok' };
  }

  // ── Email preferences ───────────────────────────────────────────────────────

  public async setSubscription(
    link: ResolvedPortalLink,
    campaignId: string,
    status: 'subscribed' | 'unsubscribed',
  ): Promise<{ status: string } | null> {
    const existing = await this.db
      .selectFrom('campaign_subscriptions')
      .select(['id', 'status'])
      .where('tenant_id', '=', link.tenant_id)
      .where('campaign_id', '=', campaignId)
      .where('person_id', '=', link.person_id)
      .executeTakeFirst();
    // The portal only toggles rows that exist — it never creates a first-time subscription
    // (consent to a campaign the donor never opted into is not the portal's to give).
    if (!existing) return null;

    if (status === 'unsubscribed') {
      const result = await this.db
        .updateTable('campaign_subscriptions')
        .set({ status: 'unsubscribed', unsubscribed_at: new Date() })
        .where('tenant_id', '=', link.tenant_id)
        .where('campaign_id', '=', campaignId)
        .where('person_id', '=', link.person_id)
        .where('status', '!=', 'unsubscribed')
        .executeTakeFirst();
      if (Number(result.numUpdatedRows) > 0) {
        // Best-effort: the consent write above must never fail because enrollment failed.
        try {
          await new WorkflowsController().triggerSubscriptionChanged(link.tenant_id, link.person_id, 'unsubscribed');
        } catch (err) {
          logger.error({ err }, '[donor-portal] Could not trigger unsubscribe automations');
        }
      }
    } else {
      await this.db
        .updateTable('campaign_subscriptions')
        .set({
          status: 'subscribed',
          consent_source: 'donor_portal',
          consent_at: new Date(),
          unsubscribed_at: null,
        })
        .where('tenant_id', '=', link.tenant_id)
        .where('campaign_id', '=', campaignId)
        .where('person_id', '=', link.person_id)
        .execute();
    }
    await this.logDonorActivity(
      link.tenant_id,
      link.person_id,
      status === 'subscribed'
        ? 'Donor resubscribed to a newsletter via the donor portal'
        : 'Donor unsubscribed from a newsletter via the donor portal',
    );
    return { status };
  }

  // ── Cross-sell ──────────────────────────────────────────────────────────────

  /** Never downgrades an existing volunteer status — only fills an empty one. */
  public async expressVolunteerInterest(link: ResolvedPortalLink): Promise<{ volunteer_interest: true }> {
    const result = await this.db
      .updateTable('persons')
      .set({ volunteer_status: 'prospective', updated_at: new Date() })
      .where('tenant_id', '=', link.tenant_id)
      .where('id', '=', link.person_id)
      .where('volunteer_status', 'is', null)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) > 0) {
      await this.logDonorActivity(link.tenant_id, link.person_id, 'Donor volunteered via the donor portal');
    }
    return { volunteer_interest: true };
  }

  /** Mirror of the web-form yard-sign intake: silent plan skip, open-request dedupe. */
  public async requestYardSign(
    link: ResolvedPortalLink,
  ): Promise<{ status: 'requested' | 'already_open' | 'unavailable' }> {
    const person = await this.db
      .selectFrom('persons')
      .select(['household_id'])
      .where('tenant_id', '=', link.tenant_id)
      .where('id', '=', link.person_id)
      .executeTakeFirst();
    const tenantRow = await this.db
      .selectFrom('tenants')
      .select(['placeholder_household_id'])
      .where('id', '=', link.tenant_id)
      .executeTakeFirst();
    const householdId = person?.household_id ? String(person.household_id) : null;
    const placeholderId = tenantRow?.placeholder_household_id ? String(tenantRow.placeholder_household_id) : null;
    if (!householdId || householdId === placeholderId) return { status: 'unavailable' };

    const actor = await this.adminUserId(link.tenant_id);
    const status = await this.db
      .transaction()
      .execute(async (trx): Promise<'requested' | 'already_open' | 'unavailable'> => {
        try {
          await assertPlanFeature(trx, link.tenant_id, 'deliveries');
        } catch {
          return 'unavailable';
        }
        const open = await trx
          .selectFrom('delivery_requests')
          .select(['id'])
          .where('tenant_id', '=', link.tenant_id)
          .where('household_id', '=', householdId)
          .where('status', 'in', ['new', 'approved'])
          .executeTakeFirst();
        if (open) return 'already_open';
        const settingRow = await trx
          .selectFrom('settings')
          .select('value')
          .where('tenant_id', '=', link.tenant_id)
          .where('key', '=', 'current_campaign')
          .executeTakeFirst();
        const rawCampaign = settingRow?.value;
        const campaignId =
          typeof rawCampaign === 'string' || typeof rawCampaign === 'number'
            ? String(rawCampaign)
            : rawCampaign && typeof rawCampaign === 'object' && 'id' in (rawCampaign as Record<string, unknown>)
              ? String((rawCampaign as Record<string, unknown>)['id'])
              : null;
        if (!campaignId) return 'unavailable';
        await trx
          .insertInto('delivery_requests')
          .values({
            tenant_id: link.tenant_id,
            campaign_id: campaignId,
            household_id: householdId,
            person_id: link.person_id,
            web_form_id: null,
            source: 'donor_portal',
            status: 'new',
            createdby_id: actor,
            updatedby_id: actor,
          })
          .onConflict((oc) => oc.doNothing())
          .execute();
        return 'requested';
      });
    if (status === 'requested') {
      await this.logDonorActivity(link.tenant_id, link.person_id, 'Donor requested a yard sign via the donor portal');
    }
    return { status };
  }

  /**
   * The self-request path: the route answers an identical 200 for every address; the person
   * lookup (and the send, when someone matches) happens only inside the background job.
   */
  public async enqueueRequestLink(tenantId: string, email: string): Promise<void> {
    await this.db
      .insertInto('background_jobs')
      .values({
        tenant_id: tenantId,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({ type: 'send-donor-portal-link', tenant_id: tenantId, email }),
        run_at: new Date(),
        max_attempts: 3,
      })
      .execute();
  }

  // ── Link lifecycle (staff + system) ─────────────────────────────────────────

  public mintLink(tenantId: string, personId: string, createdById?: string | null): Promise<MintedPortalLink> {
    return this.linksRepo.mint({ tenant_id: tenantId, person_id: personId, createdby_id: createdById ?? null });
  }

  public revokeLinks(tenantId: string, personId: string): Promise<number> {
    return this.linksRepo.revokeAllForPerson({ tenant_id: tenantId, person_id: personId });
  }

  public linkStatus(tenantId: string, personId: string) {
    return this.linksRepo.statusForPerson({ tenant_id: tenantId, person_id: personId });
  }
}
