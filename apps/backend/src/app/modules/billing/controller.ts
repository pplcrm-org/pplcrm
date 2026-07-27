import { sql } from 'kysely';
import type Stripe from 'stripe';
import {
  BILLING_INTERVALS,
  bracketIndexForSubscribers,
  getPlanDef,
  hasSettledPlan,
  maxQuantity,
  PLANS_BY_KEY,
  PURCHASABLE_PLAN_KEYS,
  type BillingInterval,
  type PlanKey,
  type PurchasablePlanKey,
} from '@common';
import { env } from '../../../env';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../errors/app-errors';
import { TransactionalEmailService } from '../../lib/mail/transactional-mail.service';
import { logger } from '../../logger';
import { TenantsRepo } from '../auth/repositories/tenants.repo';
import { SettingsRepo } from '../settings/repositories/settings.repo';
import { WorkflowsController } from '../workflows/controller';
import { WebhookEventsRepo } from './repositories/webhook-events.repo';
import { getStripe, isMockMode, stripe } from '../../lib/stripe-platform-client';
import { syncSubscriptionQuantity } from './subscription-sync';
import { countEmailableSubscribers, getPlanLimits } from './usage-limits';

/** Stripe price ID configured for each self-serve plan × billing interval (undefined in mock
 * mode / when unset). The annual prices are exactly 10× the monthly unit amounts — see the
 * Stripe ops comment in libs/common/src/lib/billing/plans.ts. */
const PRICE_ID_BY_PLAN: Record<PurchasablePlanKey, Record<BillingInterval, string | undefined>> = {
  grassroots: { month: env.stripePlanGrassrootsPriceId, year: env.stripePlanGrassrootsAnnualPriceId },
  movement: { month: env.stripePlanMovementPriceId, year: env.stripePlanMovementAnnualPriceId },
};

/** Reverse-map a Stripe price ID back to our internal plan key + billing interval. */
function planForPriceId(
  priceId: string | undefined | null,
): { plan: PurchasablePlanKey; interval: BillingInterval } | null {
  if (!priceId) return null;
  for (const plan of PURCHASABLE_PLAN_KEYS) {
    for (const interval of BILLING_INTERVALS) {
      const id = PRICE_ID_BY_PLAN[plan][interval];
      if (id && id === priceId) return { plan, interval };
    }
  }
  return null;
}

/** Narrow a stored `tenants.subscription_interval` value (or any unknown) to a BillingInterval. */
function asBillingInterval(value: unknown): BillingInterval {
  return value === 'year' ? 'year' : 'month';
}

/**
 * The Stripe API version stripe-node v22 targets (2025 "basil" and later) removed
 * `current_period_end` from the top-level Subscription object — it now lives on each
 * subscription item. Read it from the first item, and fall back to null on an unexpected
 * shape rather than throwing, so a webhook can never fail to activate a paid plan over a
 * missing timestamp (previously `new Date(undefined * 1000)` threw and left the tenant on
 * the free tier despite a successful charge).
 */
function subscriptionPeriodEnd(subscription: Stripe.Subscription): string | null {
  const periodEnd = subscription.items.data[0]?.current_period_end;
  return typeof periodEnd === 'number' ? new Date(periodEnd * 1000).toISOString() : null;
}

const tenantsRepo = new TenantsRepo();
const settingsRepo = new SettingsRepo();
const webhookEventsRepo = new WebhookEventsRepo();

/** Dedup flag prefix shared with `usage-limits.ts`'s notify-then-adjust bracket alerts — cleared
 * here once a cycle-boundary downgrade lands, so a future re-growth past the same bracket sends
 * a fresh notice instead of staying suppressed forever. */
const BRACKET_FLAG_PREFIX = 'bracket_';

async function clearBracketFlags(tenantId: string, adminUserId: string): Promise<void> {
  const row = await settingsRepo.getByKey({ tenant_id: tenantId, key: 'billing.limit_alerts_sent' });
  if (!row?.value) return;

  const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
  if (!parsed || typeof parsed !== 'object') return;

  const alertSettings: Record<string, boolean> = { ...parsed };
  let changed = false;
  for (const key of Object.keys(alertSettings)) {
    if (key.startsWith(BRACKET_FLAG_PREFIX) && alertSettings[key]) {
      alertSettings[key] = false;
      changed = true;
    }
  }
  if (!changed) return;

  await settingsRepo.upsertMany({
    tenant_id: tenantId,
    user_id: adminUserId,
    entries: [{ key: 'billing.limit_alerts_sent', value: alertSettings }],
  });
}

/** The subset of `tenants` columns the webhook/reconciliation paths read — `getOneBy` selects
 * every column (no subset requested), so narrowing to just these is honest, not a type lie; see
 * pplcrm-any-exceptions §2. */
interface TenantBillingRow {
  id: string;
  admin_id: string | null;
  subscription_plan: string | null;
  subscription_status: string | null;
  subscription_quantity: number | null;
  subscription_interval: BillingInterval;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

function asTenantBillingRow(row: unknown): TenantBillingRow | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const r = row as Record<string, unknown>;
  if (typeof r['id'] !== 'string') return undefined;
  return {
    id: r['id'],
    admin_id: typeof r['admin_id'] === 'string' ? r['admin_id'] : null,
    subscription_plan: typeof r['subscription_plan'] === 'string' ? r['subscription_plan'] : null,
    subscription_status: typeof r['subscription_status'] === 'string' ? r['subscription_status'] : null,
    subscription_quantity: typeof r['subscription_quantity'] === 'number' ? r['subscription_quantity'] : null,
    subscription_interval: asBillingInterval(r['subscription_interval']),
    stripe_customer_id: typeof r['stripe_customer_id'] === 'string' ? r['stripe_customer_id'] : null,
    stripe_subscription_id: typeof r['stripe_subscription_id'] === 'string' ? r['stripe_subscription_id'] : null,
  };
}

/**
 * Cycle-boundary downgrade reconciliation (base plan §4): notify-then-adjust only ever moves the
 * billed quantity *up* mid-cycle (see `usage-limits.checkTenantUsage`) — a shrink in emailable
 * subscribers is applied here instead, on `invoice.paid`, which proves we've just crossed a
 * billing-cycle boundary. No-ops for free/enterprise (no Stripe quantity to reconcile).
 */
async function reconcileDowngradeOnInvoicePaid(dbTenant: TenantBillingRow): Promise<void> {
  const plan = getPlanDef(dbTenant.subscription_plan) ?? PLANS_BY_KEY.free;
  if (!plan.purchasable) return;

  const billedQuantity = dbTenant.subscription_quantity ?? 1;
  const subscribers = await countEmailableSubscribers(dbTenant.id, tenantsRepo.db);
  const targetQuantity = bracketIndexForSubscribers(plan.key, subscribers);

  if (targetQuantity !== null && targetQuantity < billedQuantity) {
    await syncSubscriptionQuantity(dbTenant.id, targetQuantity);
    await clearBracketFlags(dbTenant.id, dbTenant.admin_id ?? dbTenant.id);
  }
}

export class BillingController {
  constructor() {
    if (isMockMode) {
      logger.info('[BillingController] Running in Mock Mode (no Stripe secret key provided)');
    }
  }

  private getFrontendUrl(): string {
    return env.appUrl.replace(/\/+$/, '');
  }

  /**
   * What would actually stop working if this workspace moved to Free — counts, not opinions.
   *
   * The billing page uses this to warn before a downgrade, because the Free-plan consequences are
   * invisible from inside the app: a published form keeps looking published while its submissions
   * are refused, and an API key keeps being displayed while it no longer resolves. A campaign
   * would otherwise discover it from a drop in signups days later.
   *
   * Only counts things that STOP FUNCTIONING, not everything that becomes read-only. Losing the
   * ability to edit a list is an inconvenience you find out about the moment you try; a form that
   * silently stops collecting names is not.
   */
  public async getDowngradeImpact(auth: { tenant_id: string }): Promise<{
    activeAutomations: number;
    apiKeys: number;
    publishedForms: number;
  }> {
    const db = tenantsRepo.db;
    const countOf = async (rows: Promise<{ n: string | number | bigint } | undefined>): Promise<number> =>
      Number((await rows)?.n ?? 0);

    const [publishedForms, apiKeys, activeAutomations] = await Promise.all([
      countOf(
        db
          .selectFrom('web_forms')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('tenant_id', '=', auth.tenant_id)
          .where('status', '=', 'published')
          .executeTakeFirst(),
      ),
      countOf(
        db
          .selectFrom('workspace_api_keys')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('tenant_id', '=', auth.tenant_id)
          .executeTakeFirst(),
      ),
      countOf(
        db
          .selectFrom('workflows')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('tenant_id', '=', auth.tenant_id)
          .where('status', '=', 'active')
          .executeTakeFirst(),
      ),
    ]);

    return { activeAutomations, apiKeys, publishedForms };
  }

  public async getBillingDetails(auth: { tenant_id: string }) {
    const tenant = (await tenantsRepo.getOneBy('id', {
      tenant_id: auth.tenant_id,
      value: auth.tenant_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic-read result collapses to {}; see pplcrm-any-exceptions
    })) as any;

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    return {
      plan: tenant.subscription_plan || 'free',
      status: tenant.subscription_status || 'inactive',
      interval: asBillingInterval(tenant.subscription_interval),
      endsAt: tenant.subscription_ends_at ? new Date(tenant.subscription_ends_at) : null,
      stripeCustomerId: tenant.stripe_customer_id || null,
      stripeSubscriptionId: tenant.stripe_subscription_id || null,
      hasActiveSubscription: hasSettledPlan(tenant.subscription_status),
      isMockMode,
    };
  }

  /** Live usage snapshot for the billing page: emailable-subscriber count against the tenant's
   * currently billed bracket. Enterprise (no pricing ladder) reports Infinity caps / $0 price —
   * the frontend special-cases 'enterprise' to not render the bracket clause. */
  public async getUsage(auth: { tenant_id: string }): Promise<{
    subscribers: number;
    billedQuantity: number;
    subscriberCap: number;
    emailCap: number;
    monthlyPrice: number;
    interval: BillingInterval;
    tierMax: number;
  }> {
    const tenant = asTenantBillingRow(
      await tenantsRepo.getOneBy('id', {
        tenant_id: auth.tenant_id,
        value: auth.tenant_id,
      }),
    );
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const plan = getPlanDef(tenant.subscription_plan) ?? PLANS_BY_KEY.free;
    const billedQuantity = tenant.subscription_quantity ?? 1;
    const subscribers = await countEmailableSubscribers(auth.tenant_id, tenantsRepo.db);
    const limits = getPlanLimits(plan.key, billedQuantity);

    return {
      subscribers,
      billedQuantity,
      subscriberCap: limits.subscribers,
      emailCap: limits.emails,
      monthlyPrice: plan.pricing ? (plan.pricing.brackets[billedQuantity - 1]?.price ?? 0) : 0,
      interval: tenant.subscription_interval,
      tierMax: plan.pricing ? maxQuantity(plan.key) : Number.POSITIVE_INFINITY,
    };
  }

  public async createCheckoutSession(
    auth: { tenant_id: string; user_id: string },
    plan: PurchasablePlanKey,
    interval: BillingInterval = 'month',
  ) {
    const tenant = (await tenantsRepo.getOneBy('id', {
      tenant_id: auth.tenant_id,
      value: auth.tenant_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic-read result collapses to {}; see pplcrm-any-exceptions
    })) as any;

    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const frontendUrl = this.getFrontendUrl();

    const subscribers = await countEmailableSubscribers(auth.tenant_id, tenantsRepo.db);
    const quantity = bracketIndexForSubscribers(plan, subscribers);
    if (quantity === null) {
      throw new BadRequestError('Your list is too large for this tier — contact us so we can find a plan that fits.');
    }

    if (isMockMode) {
      // In Mock Mode, direct them to a simulated callback
      const mockSuccessUrl = `${frontendUrl}/workspace/billing?mock_checkout_success=true&plan=${plan}&qty=${quantity}&interval=${interval}`;
      return { url: mockSuccessUrl };
    }

    // Live Stripe Mode
    let stripeCustomerId = tenant.stripe_customer_id as string | undefined;
    if (!stripeCustomerId) {
      const customer = await getStripe().customers.create({
        email: (tenant.email as string) || undefined,
        name: tenant.name as string,
        metadata: {
          tenantId: auth.tenant_id,
        },
      });
      stripeCustomerId = customer.id;

      // Update tenant in DB with customer ID
      await tenantsRepo.update({
        tenant_id: auth.tenant_id,
        id: auth.tenant_id,
        row: { stripe_customer_id: stripeCustomerId },
      });
    }

    // Determine Stripe Price ID
    const priceId = PRICE_ID_BY_PLAN[plan][interval];

    if (!priceId) {
      throw new Error(`Stripe Price ID is not configured for plan: ${plan} (${interval})`);
    }

    // Stripe Tax: `customer_update.address: 'auto'` saves the checkout billing address onto the
    // Customer (we always pass an existing `customer`, so Checkout needs explicit permission to
    // write it back) — renewal invoices reuse it as the tax location. `name: 'auto'` is required
    // by Stripe for tax_id_collection with an existing customer. Tax is only charged in
    // jurisdictions with an active registration in the Dashboard; elsewhere it computes to zero.
    const session = await getStripe().checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity,
        },
      ],
      mode: 'subscription',
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      customer_update: { address: 'auto', name: 'auto' },
      tax_id_collection: { enabled: true },
      success_url: `${frontendUrl}/workspace/billing?checkout_success=true`,
      cancel_url: `${frontendUrl}/workspace/billing`,
      subscription_data: {
        metadata: {
          tenantId: auth.tenant_id,
        },
      },
      metadata: {
        tenantId: auth.tenant_id,
      },
    });

    return { url: session.url };
  }

  public async createPortalSession(auth: { tenant_id: string }) {
    const tenant = (await tenantsRepo.getOneBy('id', {
      tenant_id: auth.tenant_id,
      value: auth.tenant_id,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic-read result collapses to {}; see pplcrm-any-exceptions
    })) as any;

    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const frontendUrl = this.getFrontendUrl();

    if (isMockMode) {
      return { url: `${frontendUrl}/workspace/billing?mock_portal_success=true` };
    }

    const stripeCustomerId = tenant.stripe_customer_id;
    if (!stripeCustomerId) {
      throw new Error('No active billing history found. Please subscribe to a plan first.');
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: stripeCustomerId,
      // `portal_return` tells the billing page to pull the live subscription state from Stripe
      // (syncSubscriptionFromStripe) — a plan switched in the Portal is reflected immediately
      // instead of waiting on webhook delivery.
      return_url: `${frontendUrl}/workspace/billing?portal_return=true`,
    });

    return { url: session.url };
  }

  /**
   * Mirror the tenant's live Stripe subscription onto the `tenants` row — the same write
   * `customer.subscription.updated` performs, minus the notification email (the webhook stays
   * the authoritative sender, so a later-delivered event never duplicates it).
   *
   * Called by the billing page when the user returns from Checkout (`checkout_success`) or the
   * Billing Portal (`portal_return`), so a plan change takes effect immediately even when
   * webhook delivery is delayed or not configured for the active Stripe mode (e.g. sandbox keys
   * without a sandbox webhook endpoint). No-ops in mock mode and for tenants with no Stripe
   * customer.
   */
  public async syncSubscriptionFromStripe(auth: { tenant_id: string }): Promise<{ synced: boolean; plan: string }> {
    const tenant = asTenantBillingRow(
      await tenantsRepo.getOneBy('id', {
        tenant_id: auth.tenant_id,
        value: auth.tenant_id,
      }),
    );
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    const currentPlan = tenant.subscription_plan ?? 'free';
    if (isMockMode || !tenant.stripe_customer_id) {
      return { synced: false, plan: currentPlan };
    }

    const subscriptions = await getStripe().subscriptions.list({
      customer: tenant.stripe_customer_id,
      status: 'all',
      limit: 10,
    });
    const live = subscriptions.data.find((s) => ['active', 'trialing', 'past_due'].includes(s.status));

    if (!live) {
      // Nothing billable on the customer. Only mirror a cancellation if we previously stored a
      // subscription — a tenant that never subscribed stays untouched.
      if (!tenant.stripe_subscription_id) {
        return { synced: false, plan: currentPlan };
      }
      await tenantsRepo.update({
        tenant_id: tenant.id,
        id: tenant.id,
        row: {
          subscription_status: 'canceled',
          subscription_plan: 'free',
          subscription_ends_at: new Date().toISOString(),
          subscription_quantity: 1,
          subscription_interval: 'month',
        },
      });
      logger.info(`[syncSubscriptionFromStripe] No live subscription — tenant ${tenant.id} set to free`);
      return { synced: true, plan: 'free' };
    }

    const item = live.items.data[0];
    const priceMatch = planForPriceId(item?.price.id);
    if (item && !priceMatch) {
      logger.warn(
        `[syncSubscriptionFromStripe] Price ${item.price.id} matches no configured STRIPE_PLAN_*_PRICE_ID — ` +
          `tenant ${tenant.id} keeps plan '${currentPlan}'. Check that the env price IDs belong to the active Stripe mode.`,
      );
    }
    const planName: string = priceMatch?.plan ?? currentPlan;
    const interval: BillingInterval = priceMatch?.interval ?? tenant.subscription_interval;

    await tenantsRepo.update({
      tenant_id: tenant.id,
      id: tenant.id,
      row: {
        stripe_subscription_id: live.id,
        subscription_plan: planName,
        subscription_status: live.status,
        subscription_ends_at: subscriptionPeriodEnd(live),
        subscription_quantity: item?.quantity ?? 1,
        subscription_interval: interval,
      },
    });
    logger.info(`[syncSubscriptionFromStripe] Tenant ${tenant.id} synced to plan '${planName}' (${live.status})`);
    return { synced: true, plan: planName };
  }

  public async handleWebhook(payload: string, signature: string) {
    if (isMockMode || !stripe || !env.stripeWebhookSecret) {
      logger.info('[BillingController] Webhook received, but ignored due to mock mode or missing secret');
      return;
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(payload, signature, env.stripeWebhookSecret);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Webhook signature verification failed: ${errMsg}`);
      throw new Error(`Webhook Error: ${errMsg}`);
    }

    logger.info(`Persisting webhook event: ${event.id} (${event.type})`);

    // Persist event for background worker processing.
    // Handles idempotency: duplicate events will trigger unique constraint
    // violation on `stripe_event_id` and be ignored, returning 200 OK.
    await webhookEventsRepo.db
      .insertInto('webhook_events')
      .values({
        stripe_event_id: event.id,
        type: event.type,
        payload: JSON.stringify(event),
        status: 'pending',
      })
      .onConflict((oc) => oc.column('stripe_event_id').doNothing())
      .execute();
  }

  public async processWebhookEvent(event: Stripe.Event) {
    logger.info(`Processing webhook event: ${event.id} (${event.type})`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.metadata?.['tenantId'];
        const subscriptionId = session.subscription as string;
        const customerId = session.customer as string;

        if (tenantId && subscriptionId) {
          const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
          const item = subscription.items.data[0];
          const priceMatch = planForPriceId(item?.price.id);
          const planName: PlanKey = priceMatch?.plan ?? 'free';
          const interval: BillingInterval = priceMatch?.interval ?? 'month';
          const quantity = item?.quantity ?? 1;

          await tenantsRepo.update({
            tenant_id: tenantId,
            id: tenantId,
            row: {
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              subscription_plan: planName,
              subscription_status: subscription.status,
              subscription_ends_at: subscriptionPeriodEnd(subscription),
              subscription_quantity: quantity,
              subscription_interval: interval,
            },
          });
          logger.info(`Plan activated successfully for Tenant ID: ${tenantId}`);
          try {
            await this.handleSubscriptionChange(tenantId, planName, quantity, false, interval);
          } catch (mailErr) {
            logger.error({ err: mailErr }, 'Failed to send subscription changed email on checkout.session.completed');
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.id;
        const customerId = subscription.customer as string;

        // Search Kysely database for the tenant with matching customer id
        const dbTenant = (await tenantsRepo.getOneBy('stripe_customer_id', {
          tenant_id: '1',
          value: customerId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic-read result collapses to {}; see pplcrm-any-exceptions
        })) as any;

        if (dbTenant) {
          const item = subscription.items.data[0];
          const priceMatch = planForPriceId(item?.price.id);
          const planName: string = priceMatch?.plan ?? dbTenant.subscription_plan;
          const interval: BillingInterval = priceMatch?.interval ?? asBillingInterval(dbTenant.subscription_interval);
          const quantity = item?.quantity ?? 1;

          await tenantsRepo.update({
            tenant_id: dbTenant.id,
            id: dbTenant.id,
            row: {
              stripe_subscription_id: subscriptionId,
              subscription_plan: planName,
              subscription_status: subscription.status,
              subscription_ends_at: subscriptionPeriodEnd(subscription),
              subscription_quantity: quantity,
              subscription_interval: interval,
            },
          });
          logger.info(`Subscription updated for Tenant ID: ${dbTenant.id}`);
          try {
            await this.handleSubscriptionChange(dbTenant.id, planName, quantity, false, interval);
          } catch (mailErr) {
            logger.error(
              { err: mailErr },
              'Failed to send subscription changed email on customer.subscription.updated',
            );
          }
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const dbTenant = (await tenantsRepo.getOneBy('stripe_customer_id', {
          tenant_id: '1',
          value: customerId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic-read result collapses to {}; see pplcrm-any-exceptions
        })) as any;

        if (dbTenant) {
          await tenantsRepo.update({
            tenant_id: dbTenant.id,
            id: dbTenant.id,
            row: {
              subscription_status: 'canceled',
              subscription_plan: 'free',
              subscription_ends_at: new Date().toISOString(),
              subscription_quantity: 1,
              subscription_interval: 'month',
            },
          });
          logger.info(`Subscription canceled for Tenant ID: ${dbTenant.id}`);
          try {
            await this.handleSubscriptionChange(dbTenant.id, 'free', 1);
          } catch (mailErr) {
            logger.error(
              { err: mailErr },
              'Failed to send subscription cancellation email on customer.subscription.deleted',
            );
          }
        }
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const dbTenant = asTenantBillingRow(
          await tenantsRepo.getOneBy('stripe_customer_id', {
            tenant_id: '1',
            value: customerId,
          }),
        );

        if (dbTenant) {
          try {
            await reconcileDowngradeOnInvoicePaid(dbTenant);
          } catch (err) {
            logger.error({ err }, 'Failed to reconcile bracket downgrade on invoice.paid');
          }

          const admin = await tenantsRepo.db
            .selectFrom('authusers')
            .select(['email', 'first_name'])
            .where('id', '=', dbTenant.admin_id)
            .executeTakeFirst();

          if (admin && admin.email) {
            // Find person matching admin email
            const person = await tenantsRepo.db
              .selectFrom('persons')
              .select('id')
              .where('tenant_id', '=', dbTenant.id)
              .where(sql`lower(email)`, '=', admin.email.toLowerCase())
              .executeTakeFirst();
            if (person) {
              try {
                const workflowsController = new WorkflowsController();
                await workflowsController.triggerWorkflow(dbTenant.id, String(person.id), 'payment_event', event.type);
              } catch (err) {
                logger.error({ err }, 'Failed to trigger billing workflow on invoice.paid');
              }
            }

            const mailService = new TransactionalEmailService();
            const amountPaid = invoice.amount_paid / 100;
            const pdfUrl = invoice.hosted_invoice_url || '';

            // Tax total: on the basil-era API versions stripe-node v22 targets, the invoice tax
            // total lives in the `total_taxes` array (the legacy top-level `invoice.tax` is gone).
            // Omitted when absent or zero so a receipt can never fail over a tax field.
            const totalTax = Array.isArray(invoice.total_taxes)
              ? invoice.total_taxes.reduce((sum, tax) => sum + (tax?.amount || 0), 0)
              : 0;
            const taxLineText = totalTax > 0 ? `\n- Tax: $${(totalTax / 100).toFixed(2)}` : '';
            const taxLineHtml = totalTax > 0 ? `<li><strong>Tax</strong>: $${(totalTax / 100).toFixed(2)}</li>` : '';

            // Build charges summary
            let summaryOfCharges = '';
            let summaryOfChargesHtml = '';
            if (invoice.lines && Array.isArray(invoice.lines.data)) {
              summaryOfCharges =
                '\nSummary of Charges:\n' +
                invoice.lines.data
                  .map((line) => {
                    const lineAmt = (line.amount || 0) / 100;
                    return `- ${line.description || 'Subscription item'}: $${lineAmt.toFixed(2)}${line.quantity ? ` (Qty: ${line.quantity})` : ''}`;
                  })
                  .join('\n') +
                taxLineText;

              summaryOfChargesHtml =
                '<div class="panel"><p><strong>Summary of charges:</strong></p><ul>' +
                invoice.lines.data
                  .map((line) => {
                    const lineAmt = (line.amount || 0) / 100;
                    return `<li><strong>${line.description || 'Subscription item'}</strong>: $${lineAmt.toFixed(2)}${line.quantity ? ` (Qty: ${line.quantity})` : ''}</li>`;
                  })
                  .join('') +
                taxLineHtml +
                '</ul></div>';
            }

            await mailService.sendMail({
              to: admin.email,
              subject: `Receipt for your pplCRM subscription`,
              text: `Hi ${admin.first_name || 'there'},\n\nThis is a receipt confirming your subscription payment of $${amountPaid.toFixed(2)} was processed.\n\n${summaryOfCharges}\n\nView invoice: ${pdfUrl}`,
              html: `<h2>Payment received</h2>
<p>Hi ${admin.first_name || 'there'},</p>
<p>This is a receipt confirming your subscription payment of <strong>$${amountPaid.toFixed(2)}</strong> was processed.</p>${summaryOfChargesHtml}
<div class="btn-container">
  <a href="${pdfUrl}" class="btn">View invoice</a>
</div>`,
            });
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        const dbTenant = (await tenantsRepo.getOneBy('stripe_customer_id', {
          tenant_id: '1',
          value: customerId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic-read result collapses to {}; see pplcrm-any-exceptions
        })) as any;

        if (dbTenant) {
          const admin = await tenantsRepo.db
            .selectFrom('authusers')
            .select(['email', 'first_name'])
            .where('id', '=', dbTenant.admin_id)
            .executeTakeFirst();

          if (admin && admin.email) {
            // Find person matching admin email
            const person = await tenantsRepo.db
              .selectFrom('persons')
              .select('id')
              .where('tenant_id', '=', dbTenant.id)
              .where(sql`lower(email)`, '=', admin.email.toLowerCase())
              .executeTakeFirst();
            if (person) {
              try {
                const workflowsController = new WorkflowsController();
                await workflowsController.triggerWorkflow(dbTenant.id, String(person.id), 'payment_event', event.type);
              } catch (err) {
                logger.error({ err }, 'Failed to trigger billing workflow on invoice.payment_failed');
              }
            }

            const mailService = new TransactionalEmailService();
            const billingPageUrl = `${env.appUrl}/workspace/billing`;
            const amountDue = (invoice.amount_due || 0) / 100;
            await mailService.sendMail({
              to: admin.email,
              subject: `Action needed: your pplCRM subscription payment failed`,
              text: `Hi ${admin.first_name || 'there'},\n\nWe were unable to process the subscription payment of $${amountDue.toFixed(2)} for your organization.\n\nPlease update your payment card to prevent suspension of your organization's account.\n\nUpdate billing information here: ${billingPageUrl}`,
              html: `<h2>Payment failed</h2>
<p>Hi ${admin.first_name || 'there'},</p>
<p>We were unable to process the subscription payment of <strong>$${amountDue.toFixed(2)}</strong> for your organization.</p>
<p>Please update your payment card to prevent suspension of your organization's account.</p>
<div class="btn-container">
  <a href="${billingPageUrl}" class="btn">Update payment method</a>
</div>`,
            });
          }
        }
        break;
      }
    }
  }

  /**
   * Deliberately choose the Free plan — the third option beside the two purchasable tiers.
   *
   * Free is not purchasable, so it can never come back from Stripe: `createCheckout` rejects it
   * at the Zod boundary and every other write of `subscription_status` in this file mirrors a
   * live Stripe subscription. Without this path a free tenant sits at
   * `subscription_status = NULL` forever, which is what strands them in demo mode (the exit gate
   * requires an active or trialing status). Choosing Free is a real decision, so it records one.
   *
   * It writes no Stripe fields and never creates a customer, so `syncSubscriptionFromStripe`
   * (which returns early without a `stripe_customer_id`) can't later clobber the status.
   */
  public async selectFreePlan(auth: { tenant_id: string }): Promise<{ success: boolean; plan: PlanKey }> {
    const tenant = asTenantBillingRow(
      await tenantsRepo.getOneBy('id', { tenant_id: auth.tenant_id, value: auth.tenant_id }),
    );
    if (!tenant) {
      throw new NotFoundError('Tenant not found');
    }

    // Downgrading away from a paid tier is a billing operation, not a preference: it has to go
    // through Stripe so the subscription is actually canceled and proration is handled. Flipping
    // the columns here would leave the tenant paying for a plan the app says they don't have.
    const hasLiveSubscription =
      !!tenant.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(tenant.subscription_status ?? '');
    if (hasLiveSubscription) {
      throw new ForbiddenError(
        'You have a paid subscription. Cancel it under Manage subscription first, then you will move to the Free plan.',
      );
    }

    if (tenant.subscription_plan === 'free' && tenant.subscription_status === 'active') {
      return { success: true, plan: 'free' };
    }

    await tenantsRepo.update({
      tenant_id: auth.tenant_id,
      id: auth.tenant_id,
      row: {
        subscription_plan: 'free',
        subscription_status: 'active',
        subscription_quantity: 1,
        subscription_interval: 'month',
        // Free never lapses, so there is no renewal or end date to show.
        subscription_ends_at: null,
      },
    });
    logger.info(`[selectFreePlan] Tenant ${auth.tenant_id} chose the Free plan`);

    return { success: true, plan: 'free' };
  }

  public async activateMockPlan(
    auth: { tenant_id: string },
    plan: PurchasablePlanKey,
    quantity = 1,
    interval: BillingInterval = 'month',
  ) {
    if (!isMockMode) {
      throw new Error('This helper is only available in local Mock Mode');
    }

    const expiry = new Date();
    if (interval === 'year') {
      expiry.setFullYear(expiry.getFullYear() + 1); // 1 year from now
    } else {
      expiry.setMonth(expiry.getMonth() + 1); // 1 month from now
    }
    const clampedQuantity = Math.min(Math.max(Math.trunc(quantity) || 1, 1), maxQuantity(plan));

    await tenantsRepo.update({
      tenant_id: auth.tenant_id,
      id: auth.tenant_id,
      row: {
        stripe_customer_id: 'cus_mock_' + Math.random().toString(36).substring(7),
        stripe_subscription_id: 'sub_mock_' + Math.random().toString(36).substring(7),
        subscription_plan: plan,
        subscription_status: 'active',
        subscription_ends_at: expiry.toISOString(),
        subscription_quantity: clampedQuantity,
        subscription_interval: interval,
      },
    });

    try {
      await this.handleSubscriptionChange(auth.tenant_id, plan, clampedQuantity, true, interval);
    } catch (mailErr) {
      logger.error({ err: mailErr }, 'Failed to send mock subscription update email');
    }

    return { success: true, plan };
  }

  public async cancelMockPlan(auth: { tenant_id: string }) {
    if (!isMockMode) {
      throw new Error('This helper is only available in local Mock Mode');
    }

    await tenantsRepo.update({
      tenant_id: auth.tenant_id,
      id: auth.tenant_id,
      row: {
        stripe_subscription_id: null,
        subscription_plan: 'free',
        subscription_status: 'inactive',
        subscription_ends_at: null,
        subscription_quantity: 1,
        subscription_interval: 'month',
      },
    });

    try {
      await this.handleSubscriptionChange(auth.tenant_id, 'free', 1, true);
    } catch (mailErr) {
      logger.error({ err: mailErr }, 'Failed to send mock subscription cancellation email');
    }

    return { success: true };
  }

  private async handleSubscriptionChange(
    tenantId: string,
    planName: string,
    quantity: number,
    isMock = false,
    interval: BillingInterval = 'month',
  ): Promise<void> {
    const tenant = (await tenantsRepo.getOneBy('id', {
      tenant_id: tenantId,
      value: tenantId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic-read result collapses to {}; see pplcrm-any-exceptions
    })) as any;

    if (!tenant) return;

    // 1. Reset limit alert settings
    await tenantsRepo.db
      .deleteFrom('settings')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'billing.limit_alerts_sent')
      .execute();

    // 2. Fetch admin user (Organization Owner)
    if (!tenant.admin_id) return;
    const admin = await tenantsRepo.db
      .selectFrom('authusers')
      .select(['email', 'first_name'])
      .where('id', '=', String(tenant.admin_id))
      .executeTakeFirst();

    if (admin && admin.email) {
      const planLimits = getPlanLimits(planName, quantity, interval);
      const billingPageUrl = `${env.appUrl}/workspace/billing`;
      const mockPrefix = isMock ? '[MOCK] ' : '';
      const fmt = (n: number): string => (Number.isFinite(n) ? n.toLocaleString() : 'Unlimited');

      const mailService = new TransactionalEmailService();
      const planLabel = planName.charAt(0).toUpperCase() + planName.slice(1);
      await mailService.sendMail({
        to: admin.email,
        subject: `${mockPrefix}Welcome to the ${planLabel} plan`,
        text: `Hi ${admin.first_name || 'there'},\n\n${mockPrefix}Your subscription has been updated.\n\nNew plan: ${planLabel}\nPrice: ${planLimits.price}\n\nPlan limits:\n- Email subscribers: ${fmt(planLimits.subscribers)}\n- User seats: ${fmt(planLimits.seats)}\n- Monthly emails: ${fmt(planLimits.emails)} outbound emails\n\nManage your billing here: ${billingPageUrl}`,
        html: `<h2>Subscription updated</h2>
<p>Hi ${admin.first_name || 'there'},</p>
<p>${mockPrefix}Your subscription has been updated. Welcome to the <strong>${planLabel}</strong> plan.</p>
<div class="panel">
<p><strong>Price:</strong> ${planLimits.price}</p>
<ul>
  <li><strong>Email subscribers:</strong> up to ${fmt(planLimits.subscribers)}</li>
  <li><strong>User seats:</strong> up to ${fmt(planLimits.seats)}</li>
  <li><strong>Monthly emails:</strong> up to ${fmt(planLimits.emails)} outbound emails</li>
</ul>
</div>
<div class="btn-container">
  <a href="${billingPageUrl}" class="btn">Manage billing</a>
</div>`,
      });
    }
  }
}
