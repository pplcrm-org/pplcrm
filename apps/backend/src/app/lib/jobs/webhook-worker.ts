import * as Sentry from '@sentry/node';
import { Client } from 'pg';
import type { Transaction } from 'kysely';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { env } from '../../../env';
import { BillingController } from '../../modules/billing/controller';
import { WebhookEventsRepo } from '../../modules/billing/repositories/webhook-events.repo';
import { DonationsController } from '../../modules/donations/controller';
import { updateCachedAccountStatus } from '../../modules/donations/stripe-connect';
import { sql } from 'kysely';
import { getStripe, isMockMode } from '../stripe-platform-client';
import { logger } from '../../logger';

// A 'processing' webhook event whose lock is older than this is treated as abandoned (its worker
// crashed between claim and completion — OOM, SIGKILL, container replacement mid-deploy). Without a
// reclaim the event wedges in 'processing' forever, so a donor is charged but no donation is ever
// recorded (or a plan is never activated / a refund never reverses) until someone edits the row by hand.
const STALE_EVENT_THRESHOLD_MS = 30 * 60 * 1000;
const STALE_EVENT_RECOVERY_INTERVAL_MS = 5 * 60 * 1000;

export class WebhookEventWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private activeJobsCount = 0;
  private shutdownResolver: (() => void) | null = null;
  private pgClient: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private recoveryInterval: NodeJS.Timeout | null = null;

  private readonly webhookEventsRepo = new WebhookEventsRepo();
  private readonly db = this.webhookEventsRepo.db; // Kysely DB instance

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('Webhook Event Worker started.');
    void this.setupListener();

    // Reclaim events abandoned in 'processing' by a crashed worker, on startup and every 5 minutes.
    this.recoverStaleEvents().catch((err) =>
      logger.error({ err }, 'Failed to recover stale webhook events on startup'),
    );
    this.recoveryInterval = setInterval(() => {
      this.recoverStaleEvents().catch((err) => logger.error({ err }, 'Failed to recover stale webhook events'));
    }, STALE_EVENT_RECOVERY_INTERVAL_MS);

    this.poll();
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }
    if (this.pgClient) {
      try {
        await this.pgClient.end();
      } catch (err) {
        logger.error({ err }, 'Error closing Postgres listener client on shutdown');
      }
      this.pgClient = null;
    }

    if (this.activeJobsCount > 0) {
      logger.info(
        `Webhook Event Worker: Waiting for ${this.activeJobsCount} active events to process before shutting down...`,
      );
      await new Promise<void>((resolve) => {
        this.shutdownResolver = resolve;
      });
    }
    logger.info('Webhook Event Worker stopped.');
  }

  private async setupListener() {
    if (!this.isRunning) return;
    try {
      this.pgClient = new Client(env.db);
      await this.pgClient.connect();

      this.pgClient.on('notification', (msg) => {
        if (msg.channel === 'webhook_events_channel') {
          logger.debug('Webhook Event Worker received notify, waking up...');
          this.wakeUp();
        }
      });

      this.pgClient.on('error', (err) => {
        logger.error({ err }, 'Postgres listener client error');
        this.reconnectListener();
      });

      this.pgClient.on('end', () => {
        logger.warn('Postgres listener connection closed');
        this.reconnectListener();
      });

      await this.pgClient.query('LISTEN webhook_events_channel');
      logger.info('Listening for webhook_events notifications');
    } catch (err) {
      logger.error({ err }, 'Failed to setup Postgres listener');
      this.reconnectListener();
    }
  }

  private reconnectListener() {
    if (this.pgClient) {
      this.pgClient.end().catch(() => {
        /* noop */
      });
      this.pgClient = null;
    }
    if (!this.isRunning) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      void this.setupListener();
    }, 5000);
  }

  private wakeUp() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.poll();
  }

  private poll() {
    if (!this.isRunning) return;
    this.timer = setTimeout(() => {
      void this.runPollCycle();
    }, 0);
  }

  private async runPollCycle(): Promise<void> {
    let processedAnEvent = false;
    try {
      this.activeJobsCount++;
      processedAnEvent = await this.processNextEvent();
    } catch (err) {
      logger.error({ err }, 'Error in webhook event worker poll cycle');
    } finally {
      this.activeJobsCount--;

      // If shutdown was requested and no active jobs remain, resolve the stop() promise
      if (!this.isRunning && this.activeJobsCount === 0 && this.shutdownResolver) {
        this.shutdownResolver();
      } else {
        // Poll again immediately (10ms) if an event was processed to drain the queue quickly,
        // or back off to 30 seconds if no events were found.
        const delay = processedAnEvent ? 10 : 30000;
        this.pollWithDelay(delay);
      }
    }
  }

  private pollWithDelay(ms: number) {
    if (!this.isRunning) return;
    this.timer = setTimeout(() => this.poll(), ms);
  }

  /**
   * `claimEventId` narrows the claim to one specific row — used only by tests, which run in
   * parallel spec files sharing one Postgres queue and must never steal each other's pending rows.
   * Production polling always claims the oldest pending event (no argument).
   */
  private async processNextEvent(claimEventId?: string): Promise<boolean> {
    const workerId = `webhook-worker-${process.pid}-${Math.random().toString(36).slice(2, 9)}`;

    // Try to find and lock a webhook event using SKIP LOCKED
    const eventRecord = await this.db.transaction().execute(async (trx: Transaction<Models>) => {
      let claimQuery = trx
        .selectFrom('webhook_events')
        .selectAll()
        .where('status', '=', 'pending')
        .where('run_at', '<=', new Date())
        .orderBy('id', 'asc')
        .limit(1);
      if (claimEventId !== undefined) {
        claimQuery = claimQuery.where('id', '=', claimEventId);
      }
      const pendingEvent = await claimQuery.forUpdate().skipLocked().executeTakeFirst();

      if (!pendingEvent) return null;

      const updatedEvent = await trx
        .updateTable('webhook_events')
        .set({
          status: 'processing',
          locked_at: new Date(),
          locked_by: workerId,
          attempts: Number(pendingEvent.attempts || 0) + 1,
          updated_at: new Date(),
        })
        .where('id', '=', pendingEvent.id)
        .returningAll()
        .executeTakeFirst();

      return updatedEvent;
    });

    if (!eventRecord) return false;

    logger.info(
      { webhookEventId: eventRecord.id, stripeEventId: eventRecord.stripe_event_id, type: eventRecord.type },
      'Processing webhook event',
    );

    const payload = typeof eventRecord.payload === 'string' ? JSON.parse(eventRecord.payload) : eventRecord.payload;

    try {
      const stripeObj = payload.data?.object;
      const eventType: string = payload.type;

      // Helper to resolve an admin userId for the tenant
      const resolveUserId = async (tenantId: string, metaUserId: string | null): Promise<string> => {
        if (metaUserId) return metaUserId;
        const tenantRow = await this.db
          .selectFrom('tenants')
          .select('admin_id')
          .where('id', '=', tenantId)
          .executeTakeFirst();
        if (!tenantRow?.admin_id) throw new Error(`Tenant ${tenantId} has no admin_id.`);
        return String(tenantRow.admin_id);
      };

      // Stripe Connect events (donations) carry the connected account id; platform-account events
      // (billing) never do. This is the billing/donations discriminator — a Connect event must
      // never fall through to the BillingController.
      const isConnectEvent = typeof payload?.account === 'string' && payload.account.length > 0;
      const isAccountUpdated = eventType === 'account.updated';

      const isOneTimeDonation =
        eventType === 'checkout.session.completed' &&
        stripeObj?.metadata?.personId &&
        stripeObj?.metadata?.isRecurring !== 'true';
      const isRecurringCheckoutComplete =
        eventType === 'checkout.session.completed' &&
        stripeObj?.metadata?.personId &&
        stripeObj?.metadata?.isRecurring === 'true';
      const isInvoicePaid = eventType === 'invoice.payment_succeeded' && stripeObj?.subscription;
      // `customer.subscription.updated/deleted` and `invoice.payment_failed` are emitted for BOTH a
      // donation pledge (on the connected account) AND a tenant's own billing subscription (on the
      // platform account). Only the connected-account variant belongs to the donation branches below.
      // Gate them on isConnectEvent so the platform variant falls through to BillingController — without
      // this, a failed renewal never triggers a payment hold and a Stripe-side cancellation never
      // downgrades the tenant (the billing handlers become unreachable via webhook).
      const isSubscriptionUpdated = isConnectEvent && eventType === 'customer.subscription.updated';
      const isSubscriptionDeleted = isConnectEvent && eventType === 'customer.subscription.deleted';
      const isInvoiceFailed = isConnectEvent && eventType === 'invoice.payment_failed' && stripeObj?.subscription;
      const isChargeRefunded = eventType === 'charge.refunded';
      const isDisputeCreated = eventType === 'charge.dispute.created';
      const isDisputeClosed = eventType === 'charge.dispute.closed';

      if (isAccountUpdated && eventRecord.tenant_id) {
        // Connect onboarding progress: cache details_submitted / charges_enabled — this is what
        // flips the tenant's "charges enabled" gate on after they finish Stripe-hosted onboarding.
        const tenantId = String(eventRecord.tenant_id);
        const userId = await resolveUserId(tenantId, null);
        await updateCachedAccountStatus(tenantId, userId, {
          detailsSubmitted: stripeObj?.details_submitted === true,
          chargesEnabled: stripeObj?.charges_enabled === true,
        });
      } else if (isOneTimeDonation) {
        // Standard one-time donation via checkout.session.completed
        const donationsController = new DonationsController();
        const tenantId = String(stripeObj.metadata.tenantId);
        const personId = String(stripeObj.metadata.personId);
        const amountCents = Number(stripeObj.metadata.amount);
        const province = String(stripeObj.metadata.residencyProvince || '');
        const country = String(stripeObj.metadata.residencyCountry || '');
        const sessionId = String(stripeObj.id);
        const paymentIntentId = stripeObj.payment_intent ? String(stripeObj.payment_intent) : null;
        const createdBy = await resolveUserId(tenantId, stripeObj.metadata.createdBy || null);

        await donationsController.recordSuccessfulDonation(
          tenantId,
          personId,
          amountCents,
          sessionId,
          province,
          country,
          createdBy,
          undefined,
          'card',
          undefined,
          paymentIntentId,
        );
      } else if (isRecurringCheckoutComplete) {
        // Subscription checkout completed — create the pledge record.
        // The first invoice payment is handled separately by invoice.payment_succeeded.
        const donationsController = new DonationsController();
        const tenantId = String(stripeObj.metadata.tenantId);
        const personId = String(stripeObj.metadata.personId);
        const monthlyAmountCents = Number(stripeObj.metadata.monthlyAmount);
        const province = String(stripeObj.metadata.residencyProvince || '');
        const country = String(stripeObj.metadata.residencyCountry || '');
        const createdBy = await resolveUserId(tenantId, stripeObj.metadata.createdBy || null);
        const subscriptionId = String(stripeObj.subscription || '');
        const customerId = stripeObj.customer ? String(stripeObj.customer) : null;

        if (subscriptionId) {
          await donationsController.recordNewPledge(
            tenantId,
            personId,
            monthlyAmountCents,
            subscriptionId,
            customerId,
            province,
            country,
            createdBy,
          );
        }
      } else if (isInvoicePaid) {
        // A subscription invoice was paid — record it as a donation installment.
        const donationsController = new DonationsController();
        const subscriptionId = String(stripeObj.subscription);
        const invoiceId = String(stripeObj.id);
        const amountPaidCents = Number(stripeObj.amount_paid || 0);

        const pledge = await this.db
          .selectFrom('donation_pledges')
          .selectAll()
          .where('stripe_subscription_id', '=', subscriptionId)
          .executeTakeFirst();

        if (pledge && amountPaidCents > 0) {
          // Avoid duplicate recording (invoice id as session id key)
          const alreadyRecorded = await this.db
            .selectFrom('donations')
            .select('id')
            .where('stripe_session_id', '=', invoiceId)
            .executeTakeFirst();

          if (!alreadyRecorded) {
            const createdBy = await resolveUserId(String(pledge.tenant_id), null);
            const invoicePaymentIntentId = stripeObj.payment_intent ? String(stripeObj.payment_intent) : null;
            await donationsController.recordSuccessfulDonation(
              String(pledge.tenant_id),
              String(pledge.person_id),
              amountPaidCents,
              invoiceId,
              pledge.state || '',
              pledge.country || '',
              createdBy,
              String(pledge.id),
              'card',
              undefined,
              invoicePaymentIntentId,
            );
          }
        }
      } else if (isSubscriptionUpdated) {
        // Sync pledge status from Stripe subscription status
        const subscriptionId = String(stripeObj.id);
        const stripeStatus: string = stripeObj.status;
        const statusMap: Record<string, string> = {
          active: 'active',
          past_due: 'past_due',
          canceled: 'cancelled',
          unpaid: 'unpaid',
        };
        const mappedStatus = statusMap[stripeStatus];
        // Stripe's 2025 "basil" API moved `current_period_end` off the Subscription object onto
        // each item; keep the legacy top-level read as a fallback for older event payloads.
        const periodEndUnix = stripeObj.current_period_end ?? stripeObj.items?.data?.[0]?.current_period_end;
        const nextBillingDate = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString().slice(0, 10) : null;

        if (mappedStatus) {
          await this.db
            .updateTable('donation_pledges')
            .set({
              status: mappedStatus,
              next_billing_date: nextBillingDate,
              cancelled_at: mappedStatus === 'cancelled' ? new Date() : null,
              updated_at: new Date(),
            })
            .where('stripe_subscription_id', '=', subscriptionId)
            .execute();
        }
      } else if (isSubscriptionDeleted) {
        const subscriptionId = String(stripeObj.id);
        await this.db
          .updateTable('donation_pledges')
          .set({ status: 'cancelled', cancelled_at: new Date(), updated_at: new Date() })
          .where('stripe_subscription_id', '=', subscriptionId)
          .execute();
      } else if (isInvoiceFailed) {
        const subscriptionId = String(stripeObj.subscription);
        await this.db
          .updateTable('donation_pledges')
          .set({ status: 'past_due', updated_at: new Date() })
          .where('stripe_subscription_id', '=', subscriptionId)
          .execute();
      } else if (isChargeRefunded && eventRecord.tenant_id) {
        // A donation charge was refunded. Only a FULL refund reverses the gift; a partial refund
        // can't be represented on a single-amount donation row, so we log it and leave the record.
        const tenantId = String(eventRecord.tenant_id);
        const amount = Number(stripeObj.amount || 0);
        const amountRefunded = Number(stripeObj.amount_refunded || 0);
        const fullyRefunded = stripeObj.refunded === true || (amount > 0 && amountRefunded >= amount);
        if (fullyRefunded) {
          const donationsController = new DonationsController();
          const userId = await resolveUserId(tenantId, null);
          await donationsController.reverseDonation(tenantId, userId, {
            paymentIntentId: stripeObj.payment_intent ? String(stripeObj.payment_intent) : null,
            invoiceId: stripeObj.invoice ? String(stripeObj.invoice) : null,
            status: 'refunded',
          });

          // Return our platform fee on a fully refunded gift (decided 2026-07-16) — keeping it
          // would leave the campaign out of pocket. Application fees live on the PLATFORM account,
          // so no stripeAccount option. Non-fatal: the donation reversal above must stand even if
          // the fee refund fails (it can be replayed from the Stripe dashboard).
          if (!isMockMode && stripeObj.application_fee) {
            try {
              await getStripe().applicationFees.createRefund(String(stripeObj.application_fee));
            } catch (feeErr) {
              logger.error(
                { err: feeErr, tenantId, applicationFee: String(stripeObj.application_fee) },
                'Application fee refund failed after full donation refund',
              );
            }
          }
        } else {
          logger.warn(
            { tenantId, chargeId: stripeObj.id, amount, amountRefunded },
            'Partial refund received; donation record left unchanged',
          );
        }
      } else if (isDisputeCreated && eventRecord.tenant_id) {
        // Chargeback opened — funds are withheld, so stop counting the gift toward totals.
        const tenantId = String(eventRecord.tenant_id);
        const donationsController = new DonationsController();
        const userId = await resolveUserId(tenantId, null);
        await donationsController.reverseDonation(tenantId, userId, {
          paymentIntentId: stripeObj.payment_intent ? String(stripeObj.payment_intent) : null,
          invoiceId: null,
          status: 'disputed',
        });
      } else if (isDisputeClosed && eventRecord.tenant_id) {
        // Chargeback resolved: 'won' restores the gift; 'lost' makes the reversal permanent.
        const tenantId = String(eventRecord.tenant_id);
        const donationsController = new DonationsController();
        const userId = await resolveUserId(tenantId, null);
        const paymentIntentId = stripeObj.payment_intent ? String(stripeObj.payment_intent) : null;
        if (stripeObj.status === 'won') {
          await donationsController.restoreDisputedDonation(tenantId, userId, { paymentIntentId, invoiceId: null });
        } else if (stripeObj.status === 'lost') {
          await donationsController.reverseDonation(tenantId, userId, {
            paymentIntentId,
            invoiceId: null,
            status: 'refunded',
          });
        }
      } else if (isConnectEvent) {
        // A connected-account event we don't have a handler for. Never hand it to the billing
        // controller — its customer-id lookups only make sense for platform-account events.
        logger.info(
          { eventType, account: payload.account, tenantId: eventRecord.tenant_id },
          'Unhandled Connect webhook event; acknowledged without action',
        );
      } else {
        const billingController = new BillingController();
        await billingController.processWebhookEvent(payload);
      }

      // Mark event as processed/completed
      await this.db
        .updateTable('webhook_events')
        .set({
          status: 'processed',
          locked_at: null,
          locked_by: null,
          processed_at: new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', eventRecord.id)
        .execute();

      logger.info({ webhookEventId: eventRecord.id }, 'Webhook event completed successfully');
    } catch (err) {
      const errorMsg = err instanceof Error && err.message ? err.message : String(err);
      logger.error({ err, webhookEventId: eventRecord.id }, 'Failed to process webhook event');
      // Webhook failures never surface through a request path, so capture them here explicitly
      // (no-op when SENTRY_DSN is unset).
      Sentry.captureException(err, {
        tags: { webhookType: eventRecord.type },
        extra: { webhookEventId: eventRecord.id, attempts: eventRecord.attempts },
      });

      const attempts = Number(eventRecord.attempts || 0);
      const maxAttempts = Number(eventRecord.max_attempts || 3);

      if (attempts < maxAttempts) {
        // Retry with backoff (attempts * 30s delay)
        const delaySeconds = attempts * 30;
        const runAt = new Date(Date.now() + delaySeconds * 1000);
        logger.info(
          { webhookEventId: eventRecord.id, runAt: runAt.toISOString(), attempt: attempts, maxAttempts },
          'Rescheduling webhook event',
        );

        await this.db
          .updateTable('webhook_events')
          .set({
            status: 'pending',
            locked_at: null,
            locked_by: null,
            error: errorMsg,
            run_at: runAt,
            updated_at: new Date(),
          })
          .where('id', '=', eventRecord.id)
          .execute();
      } else {
        logger.error(
          { webhookEventId: eventRecord.id, maxAttempts },
          'Webhook event exceeded maximum attempts, marking as failed',
        );
        await this.db
          .updateTable('webhook_events')
          .set({
            status: 'failed',
            locked_at: null,
            locked_by: null,
            error: errorMsg,
            updated_at: new Date(),
          })
          .where('id', '=', eventRecord.id)
          .execute();
      }
    }

    return true;
  }

  /**
   * Recover webhook events left in 'processing' by a worker that crashed between claim and
   * completion. Mirrors the background-job worker's `recoverStaleJobs`: dead-letter an event that
   * has already been claimed max_attempts times (so a poison event can't re-crash the worker every
   * window), and requeue the rest so they get retried instead of silently lost.
   */
  private async recoverStaleEvents(): Promise<void> {
    try {
      const staleTime = new Date(Date.now() - STALE_EVENT_THRESHOLD_MS);

      await this.db
        .updateTable('webhook_events')
        .set({
          status: 'failed',
          locked_at: null,
          locked_by: null,
          error: 'Webhook event processing timed out after maximum attempts',
          updated_at: new Date(),
        })
        .where('status', '=', 'processing')
        .where('locked_at', '<', staleTime)
        .where(sql<boolean>`attempts >= coalesce(max_attempts, 3)`)
        .execute();

      const requeued = await this.db
        .updateTable('webhook_events')
        .set({
          status: 'pending',
          locked_at: null,
          locked_by: null,
          error: 'Webhook event processing timed out',
          run_at: new Date(),
          updated_at: new Date(),
        })
        .where('status', '=', 'processing')
        .where('locked_at', '<', staleTime)
        .where(sql<boolean>`attempts < coalesce(max_attempts, 3)`)
        .executeTakeFirst();

      if (Number(requeued?.numUpdatedRows ?? 0) > 0) {
        this.wakeUp();
      }
    } catch (err) {
      logger.error({ err }, 'Failed to recover stale webhook events');
    }
  }
}
