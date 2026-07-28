import type { Kysely } from 'kysely';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { BaseRepository } from '../../lib/base.repo';
import { logger } from '../../logger';
import { assertSafeOutboundUrl, resolveSafeOutboundHost } from '../../lib/outbound-url-guard';

export type ZapierEventType =
  | 'person_created'
  | 'person_updated'
  | 'person_deleted'
  | 'person_tag_added'
  | 'person_tag_removed';

function pickPersonFields(p: Record<string, unknown>): Record<string, unknown> {
  if (!p) return {};
  return {
    id: p['id'] ? String(p['id']) : null,
    first_name: p['first_name'] ?? null,
    last_name: p['last_name'] ?? null,
    email: p['email'] ?? null,
    email2: p['email2'] ?? null,
    mobile: p['mobile'] ?? null,
    home_phone: p['home_phone'] ?? null,
    linkedin: p['linkedin'] ?? null,
    twitter: p['twitter'] ?? null,
    facebook: p['facebook'] ?? null,
    instagram: p['instagram'] ?? null,
    notes: p['notes'] ?? null,
    created_at: p['created_at'] ?? null,
    updated_at: p['updated_at'] ?? null,
  };
}

export { pickPersonFields };

export async function queueZapierTrigger(
  db: Kysely<Models>,
  tenant_id: string,
  event_type: ZapierEventType,
  data: Record<string, unknown>,
): Promise<void> {
  const sub = await db
    .selectFrom('zapier_subscriptions')
    .select('id')
    .where('tenant_id', '=', tenant_id)
    .where('event_type', '=', event_type)
    .executeTakeFirst();

  if (!sub) return;

  await db
    .insertInto('background_jobs')
    .values({
      tenant_id,
      queue: 'default',
      status: 'pending',
      payload: JSON.stringify({ type: 'zapier_trigger', tenant_id, event_type, data }),
      run_at: new Date(),
      max_attempts: 5,
    })
    .execute();
}

export class ZapierService {
  private get db() {
    return BaseRepository.dbInstance;
  }

  async getSubscriptions(tenant_id: string) {
    return this.db
      .selectFrom('zapier_subscriptions')
      .select(['id', 'event_type', 'webhook_url', 'created_at', 'updated_at'])
      .where('tenant_id', '=', tenant_id)
      .execute();
  }

  async subscribe(tenant_id: string, event_type: ZapierEventType, webhook_url: string): Promise<void> {
    // SSRF (H1): the backend POSTs to this URL from inside the Azure network, so a
    // tenant could otherwise aim it at the cloud metadata endpoint or a loopback port.
    // Rejected here for a clear error; re-checked at request time against DNS rebinding.
    assertSafeOutboundUrl(webhook_url);
    await this.db
      .insertInto('zapier_subscriptions')
      .values({ tenant_id, event_type, webhook_url })
      .onConflict((oc) => oc.columns(['tenant_id', 'event_type']).doUpdateSet({ webhook_url, updated_at: new Date() }))
      .execute();
  }

  async unsubscribe(tenant_id: string, event_type: ZapierEventType): Promise<void> {
    await this.db
      .deleteFrom('zapier_subscriptions')
      .where('tenant_id', '=', tenant_id)
      .where('event_type', '=', event_type)
      .execute();
  }

  async fireTrigger(tenant_id: string, event_type: ZapierEventType, data: Record<string, unknown>): Promise<void> {
    const subs = await this.db
      .selectFrom('zapier_subscriptions')
      .select('webhook_url')
      .where('tenant_id', '=', tenant_id)
      .where('event_type', '=', event_type)
      .execute();

    for (const sub of subs) {
      try {
        // Re-resolve immediately before the request: a hostname that was public when
        // subscribed can be re-pointed at an internal address afterwards.
        await resolveSafeOutboundHost(sub.webhook_url);
        const response = await fetch(sub.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          // Never follow a redirect — a public URL that 302s to 169.254.169.254 would
          // otherwise walk straight past the checks above.
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          // The URL is a bearer secret (anyone holding a Zapier/Make hook URL can post to
          // it), so log the tenant and event, never the target. See finding M9.
          logger.error({ tenant_id, event_type, status: response.status }, '[ZapierTrigger] POST failed');
        }
      } catch (err: unknown) {
        logger.error({ tenant_id, event_type, err }, '[ZapierTrigger] POST error');
      }
    }
  }
}
