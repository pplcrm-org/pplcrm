import { hasSettledPlan } from '@common';
import type { Kysely, Transaction } from 'kysely';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { ForbiddenError } from '../../errors/app-errors';

/**
 * Two different gates, deliberately kept apart.
 *
 * `assertNotDemoMode` — the seeded workspace is still in place, so anything that reaches the
 * outside world on the tenant's behalf (sending email, inviting teammates, connecting a mailbox
 * or a Stripe account) is refused. Demo data leaving the building is the thing being prevented.
 *
 * `assertPlanSelected` — proving you own a phone number, an email address or a domain is *setup*,
 * not outward-facing activity, and the go-live wizard asks for it before the demo data is
 * removed. Gating it on demo mode deadlocked that wizard: the step that unblocks the demo removal
 * was itself blocked by the demo. What actually needs to be true is that the workspace has
 * settled on a plan — free counts, one click — which is also the anti-abuse line that matters,
 * since it is the point at which the tenant stops being an anonymous test drive.
 *
 * Both are enforced server-side at the mutation entry points; the UI copy is a courtesy, these
 * guards are the contract. Plain `settings.upsert` is deliberately unguarded — its
 * server-managed keys are protected individually.
 */
export const DEMO_MODE_BLOCKED_MESSAGE =
  'This is part of the demo. Choose a plan on the Billing page, then exit demo mode to unlock configuration and sending.';

export const DEMO_MODE_INVITES_BLOCKED_MESSAGE =
  'Inviting teammates is locked during the demo. Choose a plan on the Billing page, then exit demo mode to invite your team.';

export const PLAN_REQUIRED_MESSAGE =
  'Choose a plan on the Billing page before verifying a sender. Free counts and takes one click — you do not have to remove the demo data first.';

export async function isDemoMode(db: Kysely<Models> | Transaction<Models>, tenant_id: string): Promise<boolean> {
  const tenant = await db.selectFrom('tenants').select('demo_mode_at').where('id', '=', tenant_id).executeTakeFirst();
  return tenant?.demo_mode_at != null;
}

/** Throws FORBIDDEN when the tenant is still in demo mode. */
export async function assertNotDemoMode(
  db: Kysely<Models> | Transaction<Models>,
  tenant_id: string,
  message: string = DEMO_MODE_BLOCKED_MESSAGE,
): Promise<void> {
  if (await isDemoMode(db, tenant_id)) {
    throw new ForbiddenError(message);
  }
}

/**
 * Throws FORBIDDEN until the workspace has settled on a plan. Independent of demo mode: a tenant
 * mid-demo who has chosen Free may verify their phone, email and domain, which is exactly the
 * order the go-live wizard walks through.
 */
export async function assertPlanSelected(
  db: Kysely<Models> | Transaction<Models>,
  tenant_id: string,
  message: string = PLAN_REQUIRED_MESSAGE,
): Promise<void> {
  const tenant = await db
    .selectFrom('tenants')
    .select('subscription_status')
    .where('id', '=', tenant_id)
    .executeTakeFirst();
  if (!hasSettledPlan(tenant?.subscription_status)) {
    throw new ForbiddenError(message);
  }
}
