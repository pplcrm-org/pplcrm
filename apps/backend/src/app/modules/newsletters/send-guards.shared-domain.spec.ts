import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { env } from '../../../env';
import { BaseRepository } from '../../lib/base.repo';
import { hasVerifiedSendingDomain, needsReplyToForSharedDomain } from './send-guards';

/**
 * The platform sending domain as the pre-send gate sees it. These need a real database because
 * the guard reads both the tenant row (for the slug that establishes identity) and the settings
 * rows, and the interaction between them is the whole point.
 */
describe('send guards — platform sending domain', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
  const db = (BaseRepository as any)._db;
  const SHARED = 'send.pplcrm.test';

  let tenantId: string;
  let slug: string;
  let savedDomain: string | undefined;

  const setSettings = async (entries: Record<string, unknown>): Promise<void> => {
    for (const [key, value] of Object.entries(entries)) {
      await db
        .insertInto('settings')
        .values({ tenant_id: tenantId, key, value: JSON.stringify(value) })
        .onConflict((oc: any) => oc.columns(['tenant_id', 'key']).doUpdateSet({ value: JSON.stringify(value) }))
        .execute();
    }
  };

  beforeEach(async () => {
    savedDomain = env.sendgridSharedSendingDomain;
    env.sendgridSharedSendingDomain = SHARED;

    tenantId = String(Math.floor(Math.random() * 100000000) + 10000000);
    slug = `t-${tenantId}`;
    await db.insertInto('tenants').values({ id: tenantId, name: 'Shared Domain Tenant', slug }).execute();
  });

  afterEach(async () => {
    env.sendgridSharedSendingDomain = savedDomain;
    await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('treats the tenant’s own platform address as verified, with no domain of its own', async () => {
    await setSettings({ 'communications.default_from_email': `${slug}@${SHARED}` });

    expect(await hasVerifiedSendingDomain(db, tenantId)).toBe(true);
  });

  // Without the slug comparison the shared domain would be an open relay between tenants.
  it('refuses another workspace’s address on the shared domain', async () => {
    await setSettings({ 'communications.default_from_email': `someone-else@${SHARED}` });

    expect(await hasVerifiedSendingDomain(db, tenantId)).toBe(false);
  });

  it('falls back to real domain verification when the address is not on the shared domain', async () => {
    await setSettings({
      'communications.default_from_email': 'news@vote-jane.org',
      'communications.verified_domains': [{ domain: 'vote-jane.org', status: 'verified' }],
    });
    expect(await hasVerifiedSendingDomain(db, tenantId)).toBe(true);

    await setSettings({ 'communications.verified_domains': [{ domain: 'vote-jane.org', status: 'pending' }] });
    expect(await hasVerifiedSendingDomain(db, tenantId)).toBe(false);
  });

  it('stops treating the platform address as verified when the feature is switched off', async () => {
    await setSettings({ 'communications.default_from_email': `${slug}@${SHARED}` });
    env.sendgridSharedSendingDomain = undefined;

    expect(await hasVerifiedSendingDomain(db, tenantId)).toBe(false);
  });

  describe('reply-to requirement', () => {
    // The From address is ours, so without a Reply-To a reply lands in our infrastructure
    // instead of with the organization that sent it.
    it('requires a reply-to on the shared domain', async () => {
      await setSettings({ 'communications.default_from_email': `${slug}@${SHARED}` });
      expect(await needsReplyToForSharedDomain(db, tenantId)).toBe(true);

      await setSettings({ 'communications.reply_to': 'office@riverside.example' });
      expect(await needsReplyToForSharedDomain(db, tenantId)).toBe(false);
    });

    it('does not require one when sending from the tenant’s own domain', async () => {
      await setSettings({ 'communications.default_from_email': 'news@vote-jane.org' });
      expect(await needsReplyToForSharedDomain(db, tenantId)).toBe(false);
    });
  });
});
