import { hasSettledPlan } from '@common';
import type { Kysely, Transaction } from 'kysely';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { ForbiddenError } from '../../errors/app-errors';

/**
 * Two gates, applied in a fixed order: remove the demo data first, choose a plan second.
 *
 * `assertNotDemoMode` — the seeded workspace is still in place, so anything that reaches the
 * outside world on the tenant's behalf (sending email, inviting teammates, connecting a mailbox
 * or a Stripe account) is refused, and so is billing itself. A demo workspace already gates as
 * the top tier, so there is nothing to buy while it is in place, and choosing a plan against a
 * workspace full of sample records prices the sample records. Removing the demo data is what
 * produces the clean workspace a plan is chosen for.
 *
 * `assertPlanSelected` — proving you own a phone number, an email address or a domain is *setup*,
 * and it needs a settled plan (free counts, one click): that is the point at which the tenant
 * stops being an anonymous test drive. Because billing is closed during the demo, this can only
 * be satisfied after the demo data is gone, so the message names whichever step is actually
 * outstanding rather than pointing at a page that would refuse.
 *
 * Both are enforced server-side at the mutation entry points; the UI copy is a courtesy, these
 * guards are the contract. Plain `settings.upsert` is deliberately unguarded — its
 * server-managed keys are protected individually.
 */
export const DEMO_MODE_BLOCKED_MESSAGE =
  'This is part of the demo. Remove the demo data to unlock configuration and sending — the demo already includes every feature, so there is nothing to buy first.';

export const DEMO_MODE_INVITES_BLOCKED_MESSAGE =
  'Inviting teammates is locked during the demo. Remove the demo data first, then invite your team.';

export const DEMO_MODE_BILLING_BLOCKED_MESSAGE =
  'Billing is closed while the demo data is in place: demo mode already unlocks every feature, so there is nothing to choose between yet. Remove the demo data first, then pick your plan.';

export const PLAN_REQUIRED_MESSAGE =
  'Choose a plan on the Billing page before verifying a sender. Free counts and takes one click.';

export const PLAN_REQUIRED_IN_DEMO_MESSAGE =
  'Remove the demo data first, then choose a plan on the Billing page — verifying a sender needs a settled plan.';

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
 * Throws FORBIDDEN until the workspace has settled on a plan. A workspace still in demo mode can
 * never satisfy this — billing is closed until the demo data is removed — so the refusal names
 * the demo removal instead of sending the user to a Billing page that would also refuse.
 */
export async function assertPlanSelected(
  db: Kysely<Models> | Transaction<Models>,
  tenant_id: string,
  message: string = PLAN_REQUIRED_MESSAGE,
): Promise<void> {
  const tenant = await db
    .selectFrom('tenants')
    .select(['subscription_status', 'demo_mode_at'])
    .where('id', '=', tenant_id)
    .executeTakeFirst();
  if (!hasSettledPlan(tenant?.subscription_status)) {
    throw new ForbiddenError(tenant?.demo_mode_at != null ? PLAN_REQUIRED_IN_DEMO_MESSAGE : message);
  }
}
