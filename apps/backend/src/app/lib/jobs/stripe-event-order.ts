import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { logger } from '../../logger';

/**
 * Staleness guard for Stripe subscription events.
 *
 * Stripe delivers webhooks at-least-once and retries failures, so an OLDER
 * `customer.subscription.*` event can arrive (or be re-attempted) AFTER a newer one for the same
 * subscription was already processed. Events are claimed in insertion order and applied
 * unconditionally, so without this check the stale event would overwrite current subscription
 * state (pledge status / tenant plan) with an out-of-date snapshot.
 *
 * Every Stripe event payload carries a top-level `created` (unix seconds) and the full payload is
 * stored as jsonb on `webhook_events`, so ordering can be decided from data we already have — no
 * schema change. An event is stale when a row with `status = 'processed'`, the same
 * `customer.subscription.*` family, and the same `data.object.id` exists with a strictly greater
 * `created`.
 *
 * This intentionally covers only same-subscription-object ordering. It does NOT order across
 * object types (e.g. an `invoice.payment_failed` vs a `customer.subscription.updated` for the
 * same subscription) — those carry different object ids and different state, and cross-type
 * ordering has no correct answer from `created` alone.
 */
export async function isStaleStripeSubscriptionEvent(
  db: Kysely<Models>,
  opts: {
    /** Stripe event id (`evt_...`) — only used for the skip log line. */
    stripeEventId: string;
    /** The Stripe subscription id (`data.object.id`) this event describes. */
    subscriptionId: string;
    /** This event's top-level `created` timestamp (unix seconds). */
    createdUnix: number;
    /**
     * Tenant owning the webhook row, when the ingest path resolved one (Connect events).
     * Platform billing events have no tenant on the row, so `null` skips the filter — safe
     * because Stripe subscription ids are unique and the type/object-id match already pins
     * the exact subscription object.
     */
    tenantId: string | null;
  },
): Promise<boolean> {
  // Without a usable `created` we cannot judge order — apply the event as before.
  if (!Number.isFinite(opts.createdUnix) || opts.createdUnix <= 0) return false;

  let query = db
    .selectFrom('webhook_events')
    .select('id')
    .where('status', '=', 'processed')
    .where('type', 'like', 'customer.subscription.%')
    .where(sql<boolean>`payload -> 'data' -> 'object' ->> 'id' = ${opts.subscriptionId}`)
    .where(sql<boolean>`(payload ->> 'created')::bigint > ${opts.createdUnix}`)
    .limit(1);
  if (opts.tenantId !== null) {
    query = query.where('tenant_id', '=', opts.tenantId);
  }
  const newerProcessed = await query.executeTakeFirst();

  if (!newerProcessed) return false;

  logger.info(
    { stripeEventId: opts.stripeEventId, subscriptionId: opts.subscriptionId, createdUnix: opts.createdUnix },
    'Skipping stale Stripe subscription event: a newer event for this subscription was already processed',
  );
  return true;
}
