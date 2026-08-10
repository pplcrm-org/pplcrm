import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseRepository } from '../base.repo';
import { assertTenantMaySendTransactional, TransactionalSendBlockedError } from './transactional-send-guard';

/**
 * SECURITY REGRESSION (C5) — the Postmark transactional pipe had no anti-abuse gate at
 * all, while sending from the platform address on pplCRM's own DKIM-signed reputation.
 * A free tenant could import a large list and loop `events.addRegistration` to emit mass
 * phishing that touched none of the newsletter guard stack.
 *
 * Account/security mail stays ungated on purpose: a suspended tenant's owner still needs a
 * password reset to sign in and fix the problem.
 */
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

describe('assertTenantMaySendTransactional', () => {
  const db = (BaseRepository as never as { _db: never })._db as never as {
    insertInto: (t: string) => never;
    deleteFrom: (t: string) => never;
    updateTable: (t: string) => never;
  };
  let tenantId: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    tenantId = rand();
    await (db as never as { insertInto: (t: string) => { values: (v: unknown) => { execute: () => Promise<void> } } })
      .insertInto('tenants')
      .values({ id: tenantId, name: 'Send guard spec' })
      .execute();
  });

  afterEach(async () => {
    const d = db as never as {
      deleteFrom: (t: string) => { where: (a: string, b: string, c: unknown) => { execute: () => Promise<void> } };
    };
    await d.deleteFrom('rate_limits').where('key', 'like', `%${tenantId}%`).execute();
    await d.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  const setTenant = async (row: Record<string, unknown>): Promise<void> => {
    const u = db as never as {
      updateTable: (t: string) => {
        set: (r: unknown) => { where: (a: string, b: string, c: unknown) => { execute: () => Promise<void> } };
      };
    };
    await u.updateTable('tenants').set(row).where('id', '=', tenantId).execute();
  };

  it('allows ordinary audience-facing mail', async () => {
    await expect(assertTenantMaySendTransactional(tenantId, 'contact')).resolves.toBeUndefined();
  });

  it('withholds contact mail from a suspended tenant', async () => {
    await setTenant({ suspended_at: new Date() });
    await expect(assertTenantMaySendTransactional(tenantId, 'contact')).rejects.toThrow(TransactionalSendBlockedError);
  });

  // A pause is the tripwire response to a bounce/complaint spike; continuing to emit
  // audience mail through a second pipe would defeat it.
  it('withholds contact mail while sending is paused', async () => {
    await setTenant({ sending_paused_at: new Date() });
    await expect(assertTenantMaySendTransactional(tenantId, 'contact')).rejects.toThrow(/paused/i);
  });

  it('still delivers account mail to a suspended, paused tenant', async () => {
    await setTenant({ suspended_at: new Date(), sending_paused_at: new Date() });
    await expect(assertTenantMaySendTransactional(tenantId, 'account')).resolves.toBeUndefined();
  });

  it('lets staff mail through a pause but not a suspension', async () => {
    await setTenant({ sending_paused_at: new Date() });
    await expect(assertTenantMaySendTransactional(tenantId, 'staff')).resolves.toBeUndefined();

    await setTenant({ suspended_at: new Date() });
    await expect(assertTenantMaySendTransactional(tenantId, 'staff')).rejects.toThrow(/suspended/i);
  });

  it('caps contact mail per tenant per hour', async () => {
    // The cap is 200/hour; blow past it and the next message is withheld.
    for (let i = 0; i < 200; i++) {
      await assertTenantMaySendTransactional(tenantId, 'contact');
    }
    await expect(assertTenantMaySendTransactional(tenantId, 'contact')).rejects.toThrow(/cap/i);

    // The cap is per audience, so staff mail is unaffected by a contact-mail flood.
    await expect(assertTenantMaySendTransactional(tenantId, 'staff')).resolves.toBeUndefined();
  });

  it('never gates platform mail that carries no tenant', async () => {
    await expect(assertTenantMaySendTransactional(null, 'contact')).resolves.toBeUndefined();
  });

  // Demo workspaces gate as the top tier for FEATURES (plan-gate.ts), which reaches
  // audience-facing mail paths a free workspace never could. The seeded demo contacts are
  // reserved example.com addresses, so contact mail is withheld until the demo data is removed.
  it('withholds contact mail while the workspace is in demo mode', async () => {
    await setTenant({ demo_mode_at: new Date() });
    await expect(assertTenantMaySendTransactional(tenantId, 'contact')).rejects.toThrow(/demo/i);
    try {
      await assertTenantMaySendTransactional(tenantId, 'contact');
      expect.unreachable('the demo-mode block should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TransactionalSendBlockedError);
      expect((err as TransactionalSendBlockedError).reason).toBe('demo_mode');
    }
  });

  it('still delivers staff and account mail during the demo', async () => {
    await setTenant({ demo_mode_at: new Date() });
    await expect(assertTenantMaySendTransactional(tenantId, 'staff')).resolves.toBeUndefined();
    await expect(assertTenantMaySendTransactional(tenantId, 'account')).resolves.toBeUndefined();
  });
});
