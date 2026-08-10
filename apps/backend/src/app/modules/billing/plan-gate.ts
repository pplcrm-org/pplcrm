import type { Kysely, Transaction } from 'kysely';
import { TRPCError } from '@trpc/server';

import { GATED_FEATURES, PLANS_BY_KEY, effectivePlanKey, planAllowsFeature, type GatedFeature } from '@common';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { ForbiddenError } from '../../errors/app-errors';
import { BaseRepository } from '../../lib/base.repo';
import { middleware } from '../../../trpc';

/**
 * Server-side enforcement of the FEATURE_MATRIX plan split (GATED_FEATURES in
 * libs/common/src/lib/billing/plans.ts). The matrix data alone is only marketing copy — this
 * gate is the contract: tenants below a feature's minimum plan cannot mutate through the
 * feature's module. Reads intentionally stay open so a downgraded tenant can still see (and
 * export) data it created while entitled — disclosure over suppression.
 *
 * Demo mode: a workspace whose seeded demo data is still in place gates as the top self-serve
 * tier (`effectivePlanKey` — 2026-08-10 operator decision), so the test drive covers every
 * feature. That never opens an outward path: sending newsletters, inviting teammates, mailbox
 * connect and Stripe Connect are refused by the demo guard (modules/demo/demo-guard.ts),
 * audience-facing transactional mail by the transactional send guard, and drip-automation
 * processing by the drip worker's own demo check.
 */
export function planGateMessage(feature: GatedFeature): string {
  const { label, minPlan } = GATED_FEATURES[feature];
  return `${label} requires the ${PLANS_BY_KEY[minPlan].name} plan or higher. Upgrade on the Billing page to unlock it.`;
}

/** Throws FORBIDDEN when the tenant's plan does not include the gated feature (demo mode gates
 * as `DEMO_MODE_EFFECTIVE_PLAN`, so demo workspaces pass for every feature). */
export async function assertPlanFeature(
  db: Kysely<Models> | Transaction<Models>,
  tenant_id: string,
  feature: GatedFeature,
): Promise<void> {
  const tenant = await db
    .selectFrom('tenants')
    .select(['subscription_plan', 'demo_mode_at'])
    .where('id', '=', tenant_id)
    .executeTakeFirst();
  if (!planAllowsFeature(effectivePlanKey(tenant?.subscription_plan, tenant?.demo_mode_at), feature)) {
    throw new ForbiddenError(planGateMessage(feature));
  }
}

/**
 * tRPC middleware form of the gate for use on `authProcedure` (after `isAuthed`). Only
 * mutations are blocked — see the module doc above for why reads pass.
 */
export function planFeatureGate(feature: GatedFeature) {
  return middleware(async (opts) => {
    if (opts.type === 'mutation') {
      const tenantId = opts.ctx.auth?.tenant_id;
      if (!tenantId) throw new TRPCError({ code: 'UNAUTHORIZED' });
      await assertPlanFeature(BaseRepository.dbInstance, tenantId, feature);
    }
    return opts.next();
  });
}

/**
 * The shared-inbox gate deviates from `planFeatureGate` in one direction, by decision
 * (2026-08-01): it blocks READS as well as mutations — a downgraded workspace loses inbox
 * access on day 0 (its synced mail is then purged 30 days later; see billing/inbox-purge).
 * Its original second deviation — exempting demo mode, because the seeded demo inbox is part
 * of the free test drive and contains no synced customer mail — became the general rule for
 * every gate on 2026-08-10 and now arrives via `effectivePlanKey`. Reads-stay-open still
 * applies to every other gated feature; do not copy this shape without the same operator
 * decision behind it.
 */
export async function assertInboxAccess(db: Kysely<Models> | Transaction<Models>, tenant_id: string): Promise<void> {
  const tenant = await db
    .selectFrom('tenants')
    .select(['subscription_plan', 'demo_mode_at'])
    .where('id', '=', tenant_id)
    .executeTakeFirst();
  if (!planAllowsFeature(effectivePlanKey(tenant?.subscription_plan, tenant?.demo_mode_at), 'inbox')) {
    throw new ForbiddenError(planGateMessage('inbox'));
  }
}

/** tRPC middleware form of `assertInboxAccess`, for rebinding the emails router's procedures. */
export function inboxAccessGate() {
  return middleware(async (opts) => {
    const tenantId = opts.ctx.auth?.tenant_id;
    if (!tenantId) throw new TRPCError({ code: 'UNAUTHORIZED' });
    await assertInboxAccess(BaseRepository.dbInstance, tenantId);
    return opts.next();
  });
}
