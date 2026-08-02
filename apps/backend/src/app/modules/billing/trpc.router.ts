import { z } from 'zod';
import { BILLING_INTERVALS, maxQuantity, PURCHASABLE_PLAN_KEYS } from '@common';
import { adminOrOwnerProcedure, router } from '../../../trpc';
import { BillingController } from './controller';

const controller = new BillingController();

/** Largest valid Stripe quantity across the purchasable tiers (currently Movement's ladder). */
const MAX_BRACKET_QUANTITY = Math.max(...PURCHASABLE_PLAN_KEYS.map((key) => maxQuantity(key)));

export const BillingRouter = router({
  getDetails: adminOrOwnerProcedure.query(({ ctx }) => controller.getBillingDetails(ctx.auth)),

  /** Live usage snapshot for the billing page: emailable subscribers vs. the tenant's currently
   * billed bracket (subscriber/email caps, monthly price, tier max). See §5 of the pricing
   * overhaul plan. */
  getUsage: adminOrOwnerProcedure.query(({ ctx }) => controller.getUsage(ctx.auth)),

  /** Counts of what stops working on Free (published forms, API keys, active automations), so the
   * billing page can warn before a downgrade rather than after signups quietly stop arriving. */
  getDowngradeImpact: adminOrOwnerProcedure.query(({ ctx }) => controller.getDowngradeImpact(ctx.auth)),

  createCheckout: adminOrOwnerProcedure
    .input(z.object({ plan: z.enum(PURCHASABLE_PLAN_KEYS), interval: z.enum(BILLING_INTERVALS).default('month') }))
    .mutation(({ ctx, input }) => controller.createCheckoutSession(ctx.auth, input.plan, input.interval)),

  /** Change the live subscription in place — plan and/or billing interval. The subscribed path:
   * createCheckout CREATES a subscription, so calling it while one is live would double-bill
   * (and now refuses); this updates the existing subscription with immediate proration. */
  switchPlan: adminOrOwnerProcedure
    .input(z.object({ plan: z.enum(PURCHASABLE_PLAN_KEYS), interval: z.enum(BILLING_INTERVALS).default('month') }))
    .mutation(({ ctx, input }) => controller.switchPlan(ctx.auth, input.plan, input.interval)),

  createPortal: adminOrOwnerProcedure.mutation(({ ctx }) => controller.createPortalSession(ctx.auth)),

  /** In-app period-end cancellation — the educated path: the billing page shows the downgrade
   * education dialog first, then calls this. Mock mode downgrades immediately. */
  cancelSubscription: adminOrOwnerProcedure.mutation(({ ctx }) => controller.cancelSubscription(ctx.auth)),

  /** Undo a scheduled period-end cancellation before it takes effect. */
  resumeSubscription: adminOrOwnerProcedure.mutation(({ ctx }) => controller.resumeSubscription(ctx.auth)),

  /** Choose the Free plan outright. Free is not purchasable, so it has no checkout path — this is
   * the only way a tenant records an active status on it (which is what lets them leave demo
   * mode). Refuses while a paid Stripe subscription is live; that downgrade goes through the
   * portal. */
  selectFree: adminOrOwnerProcedure.mutation(({ ctx }) => controller.selectFreePlan(ctx.auth)),

  /** Webhook-independent reconciliation: pull the live subscription from Stripe and mirror it
   * onto the tenant. Called on return from Checkout/Portal so plan changes apply immediately. */
  syncSubscription: adminOrOwnerProcedure.mutation(({ ctx }) => controller.syncSubscriptionFromStripe(ctx.auth)),

  // Local mock testing mutation endpoints
  activateMockPlan: adminOrOwnerProcedure
    .input(
      z.object({
        plan: z.enum(PURCHASABLE_PLAN_KEYS),
        quantity: z.number().int().min(1).max(MAX_BRACKET_QUANTITY).optional(),
        interval: z.enum(BILLING_INTERVALS).default('month'),
      }),
    )
    .mutation(({ ctx, input }) => controller.activateMockPlan(ctx.auth, input.plan, input.quantity, input.interval)),

  cancelMockPlan: adminOrOwnerProcedure.mutation(({ ctx }) => controller.cancelMockPlan(ctx.auth)),
});
