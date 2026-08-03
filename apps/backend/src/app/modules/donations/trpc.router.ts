import { z } from 'zod';
import { authProcedure as baseAuthProcedure, router } from '../../../trpc';
import { getAllOptions } from '../../../../../../libs/common/src';
import {
  RecordDonationObj,
  stripeConnectCountrySchema,
} from '../../../../../../libs/common/src/lib/schemas/donations.schema';
import { planFeatureGate } from '../billing/plan-gate';
import { DonationsController } from './controller';
import { createDashboardLoginLink, disconnect, getConnectStatus, startOnboarding } from './stripe-connect';

const controller = new DonationsController();

// FEATURE_MATRIX plan gate: donations are Grassroots-and-up; mutations below are blocked on Free.
const authProcedure = baseAuthProcedure.use(planFeatureGate('donations'));

export const DonationsRouter = router({
  // ── One-time donations ──────────────────────────────────────────────────────

  /** Server-side page of the ledger for the donations grid — search, filters, sort, count. */
  getAll: authProcedure
    .input(getAllOptions)
    .query(({ ctx, input }) => controller.getAllWithCounts(ctx.auth.tenant_id, input)),

  /** Header-tile aggregates (totals, month deltas, thanked count, active pledges). */
  getLedgerSummary: authProcedure
    .input(z.object({ scope: z.enum(['all', 'one-time']) }).optional())
    .query(({ ctx, input }) => controller.getDonationsLedgerSummary(ctx.auth.tenant_id, input?.scope ?? 'all')),

  /** Record an offline gift (Fig. 15 "Record donation" dialog) — cash, check, or bank transfer,
   * not run through the public Stripe checkout. */
  recordDonation: authProcedure
    .input(RecordDonationObj)
    .mutation(({ ctx, input }) =>
      controller.recordManualDonation(
        ctx.auth,
        input.personId,
        input.amountCents,
        input.method,
        input.campaign_id,
        input.address,
      ),
    ),

  getPersonDonationHistory: authProcedure
    .input(z.string())
    .query(({ ctx, input }) => controller.getPersonDonationsList(ctx.auth.tenant_id, input)),

  /** One gift + receipt state, for the /donations/:id detail page. */
  getDonation: authProcedure
    .input(z.string())
    .query(({ ctx, input }) => controller.getDonationDetail(ctx.auth.tenant_id, input)),

  getDonationStats: authProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => controller.getDonationStats(ctx.auth.tenant_id, input)),

  checkEligibility: authProcedure
    .input(
      z.object({
        personId: z.string(),
        amountCents: z.number(),
        address: z.object({
          country: z.string().optional(),
          state: z.string().optional(),
        }),
        isRecurring: z.boolean().optional(),
        remainingMonths: z.number().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      controller.checkEligibility(ctx.auth.tenant_id, input.personId, input.amountCents, input.address, {
        isRecurring: input.isRecurring,
        remainingMonths: input.remainingMonths,
      }),
    ),

  createCheckout: authProcedure
    .input(
      z.object({
        personId: z.string(),
        amountCents: z.number(),
        address: z.object({
          country: z.string().optional(),
          state: z.string().optional(),
        }),
      }),
    )
    .mutation(({ ctx, input }) =>
      controller.createCheckoutSession(ctx.auth, input.personId, input.amountCents, input.address),
    ),

  /** Country + residency-acknowledged flag + Connect readiness for the donation UI disclaimer. */
  getResidencyContext: authProcedure.query(({ ctx }) => controller.getResidencyContext(ctx.auth.tenant_id)),

  confirmDonation: authProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ ctx, input }) => controller.confirmDonation(ctx.auth.tenant_id, ctx.auth.user_id, input.sessionId)),

  confirmMockDonation: authProcedure
    .input(
      z.object({
        personId: z.string(),
        amountCents: z.number(),
        sessionId: z.string(),
        province: z.string(),
        country: z.string(),
      }),
    )
    .mutation(({ ctx, input }) =>
      controller.confirmMockDonation(
        ctx.auth.tenant_id,
        ctx.auth.user_id,
        input.personId,
        input.amountCents,
        input.sessionId,
        input.province,
        input.country,
      ),
    ),

  // ── Recurring pledges ───────────────────────────────────────────────────────

  createRecurringCheckout: authProcedure
    .input(
      z.object({
        personId: z.string(),
        monthlyAmountCents: z.number(),
        address: z.object({
          country: z.string().optional(),
          state: z.string().optional(),
        }),
      }),
    )
    .mutation(({ ctx, input }) =>
      controller.createRecurringCheckoutSession(ctx.auth, input.personId, input.monthlyAmountCents, input.address),
    ),

  confirmMockPledge: authProcedure
    .input(
      z.object({
        personId: z.string(),
        monthlyAmountCents: z.number(),
        mockSubId: z.string(),
        province: z.string(),
        country: z.string(),
      }),
    )
    .mutation(({ ctx, input }) =>
      controller.confirmMockPledge(
        ctx.auth.tenant_id,
        ctx.auth.user_id,
        input.personId,
        input.monthlyAmountCents,
        input.mockSubId,
        input.province,
        input.country,
      ),
    ),

  listPledges: authProcedure.query(({ ctx }) => controller.getTenantPledgesList(ctx.auth.tenant_id)),

  getPersonPledges: authProcedure
    .input(z.string())
    .query(({ ctx, input }) => controller.getPersonPledges(ctx.auth.tenant_id, input)),

  cancelPledge: authProcedure
    .input(z.object({ pledgeId: z.string() }))
    .mutation(({ ctx, input }) => controller.cancelPledge(ctx.auth.tenant_id, input.pledgeId, ctx.auth.user_id)),

  // ── Donation periods ────────────────────────────────────────────────────────

  getDonationPeriods: authProcedure.query(({ ctx }) => controller.getDonationPeriods(ctx.auth.tenant_id)),

  createDonationPeriod: authProcedure
    .input(
      z.object({
        name: z.string().min(1),
        start_date: z.string(),
        end_date: z.string().nullable().optional(),
        limit_amount: z.number().int().positive(),
        // Campaigns §15 — contribution-limit windows are per campaign; defaults to the office.
        campaign_id: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) => controller.createDonationPeriod(ctx.auth.tenant_id, ctx.auth.user_id, input)),

  updateDonationPeriod: authProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        start_date: z.string().optional(),
        end_date: z.string().nullable().optional(),
        limit_amount: z.number().int().positive().optional(),
        is_active: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const { id, ...payload } = input;
      return controller.updateDonationPeriod(ctx.auth.tenant_id, ctx.auth.user_id, id, payload);
    }),

  deleteDonationPeriod: authProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => controller.deleteDonationPeriod(ctx.auth.tenant_id, input.id)),

  // ── Stripe Connect (hosted onboarding; no tenant-held secrets) ────────────────

  getStripeConnectStatus: authProcedure.query(({ ctx }) => getConnectStatus(ctx.auth.tenant_id, ctx.auth.user_id)),

  startStripeOnboarding: authProcedure
    .input(z.object({ country: stripeConnectCountrySchema }))
    .mutation(({ ctx, input }) => startOnboarding(ctx.auth.tenant_id, ctx.auth.user_id, input.country)),

  createStripeLoginLink: authProcedure.mutation(({ ctx }) => createDashboardLoginLink(ctx.auth.tenant_id)),

  disconnectStripe: authProcedure.mutation(async ({ ctx }) => {
    await disconnect(ctx.auth.tenant_id);
    return { success: true };
  }),
});
